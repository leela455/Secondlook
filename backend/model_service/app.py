import asyncio
import os
from typing import Annotated

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from model_registry import VISA_CATEGORIES, category_status, category_statuses, ready_model
from patchcore_runtime import predict_patchcore

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
SHARPNESS_BLUR_LIMIT = float(os.getenv("SHARPNESS_BLUR_LIMIT", "50"))
SHARPNESS_SCORE_TARGET = float(os.getenv("SHARPNESS_SCORE_TARGET", "140"))
EXPOSURE_DARK_LIMIT = int(os.getenv("EXPOSURE_DARK_LIMIT", "30"))
EXPOSURE_BRIGHT_LIMIT = int(os.getenv("EXPOSURE_BRIGHT_LIMIT", "225"))
EXPOSURE_CLIP_LIMIT_PERCENT = float(os.getenv("EXPOSURE_CLIP_LIMIT_PERCENT", "20"))

app = FastAPI(title="SecondLook CV quality service", version="1.0.0")


@app.get("/health")
def health():
    ready = [item["category"] for item in category_statuses() if item["ready"]]
    return {
        "status": "ok",
        "capabilities": ["sharpness", "exposure", "category_registry"] + (["patchcore_anomaly_detection"] if ready else []),
        "defect_model": "configured" if ready else "not_configured",
        "trained_categories": ready,
    }


@app.get("/categories")
def categories():
    return {"dataset": "VisA", "categories": category_statuses()}


@app.post("/predict")
async def predict(
    image: UploadFile = File(...),
    model_category: Annotated[str | None, Form()] = None,
):
    if image.content_type not in {"image/jpeg", "image/png", "image/webp"}:
        raise HTTPException(status_code=415, detail="Upload a JPG, PNG or WEBP image.")

    payload = await image.read(MAX_IMAGE_BYTES + 1)
    if not payload:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(payload) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image exceeds the 5 MB limit.")

    encoded = np.frombuffer(payload, dtype=np.uint8)
    pixels = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if pixels is None or pixels.size == 0:
        raise HTTPException(status_code=400, detail="The upload could not be decoded as an image.")
    height, width = pixels.shape[:2]
    if width < 32 or height < 32:
        raise HTTPException(status_code=400, detail="Image dimensions must be at least 32 by 32 pixels.")
    if width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(status_code=413, detail="Decoded image exceeds the 25 megapixel limit.")

    gray = cv2.cvtColor(pixels, cv2.COLOR_BGR2GRAY)
    laplacian_variance = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    mean_gray = float(gray.mean())
    median_gray = float(np.median(gray))
    underexposed_percent = float(np.mean(gray <= EXPOSURE_DARK_LIMIT) * 100)
    overexposed_percent = float(np.mean(gray >= EXPOSURE_BRIGHT_LIMIT) * 100)
    clipped_percent = underexposed_percent + overexposed_percent

    sharpness_score = min(100.0, max(0.0, laplacian_variance / SHARPNESS_SCORE_TARGET * 100))
    lighting_score = min(100.0, max(0.0, 100.0 - clipped_percent))
    sharpness_status = "blurry" if laplacian_variance < SHARPNESS_BLUR_LIMIT else "acceptable"
    if median_gray < EXPOSURE_DARK_LIMIT:
        lighting_status = "underexposed"
    elif median_gray > EXPOSURE_BRIGHT_LIMIT:
        lighting_status = "overexposed"
    elif clipped_percent >= EXPOSURE_CLIP_LIMIT_PERCENT:
        lighting_status = "exposure_clipping"
    else:
        lighting_status = "acceptable"

    quality_measurements = {
        "sharpness": {
            "value": round(laplacian_variance, 4),
            "unit": "grayscale Laplacian variance (intensity^2)",
            "score": round(sharpness_score, 1),
            "status": sharpness_status,
            "threshold": {"blur_below": SHARPNESS_BLUR_LIMIT, "score_target": SHARPNESS_SCORE_TARGET},
        },
        "lighting": {
            "mean_gray": round(mean_gray, 2),
            "median_gray": round(median_gray, 2),
            "underexposed_percent": round(underexposed_percent, 2),
            "overexposed_percent": round(overexposed_percent, 2),
            "clipped_percent": round(clipped_percent, 2),
            "unit": "8-bit grayscale intensity (0-255)",
            "score": round(lighting_score, 1),
            "status": lighting_status,
            "threshold": {
                "dark_at_or_below": EXPOSURE_DARK_LIMIT,
                "bright_at_or_above": EXPOSURE_BRIGHT_LIMIT,
                "clipping_percent": EXPOSURE_CLIP_LIMIT_PERCENT,
            },
        },
        "alignment": {
            "value": None,
            "status": "not_calculated",
            "explanation": "No reference image or component geometry was supplied.",
        },
        "visibility": {
            "value": None,
            "status": "not_calculated",
            "explanation": "No component mask or expected inspection region was supplied.",
        },
        "image": {"width": width, "height": height},
        "calibration": "Heuristic diagnostic thresholds; not validated for a specific camera or component.",
    }

    category = model_category.strip().lower() if model_category else None
    if category and category not in VISA_CATEGORIES:
        raise HTTPException(status_code=400, detail="Unsupported model category. Choose a category listed by /categories.")

    readiness = category_status(category) if category else None
    if category and readiness["ready"]:
        try:
            inference = await asyncio.wait_for(asyncio.to_thread(predict_patchcore, payload, category, ready_model(category)), timeout=12)
        except asyncio.TimeoutError as exc:
            raise HTTPException(status_code=503, detail="PatchCore inference timed out; no prediction was produced.") from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        inference["quality"] = {
            "sharpness": quality_measurements["sharpness"]["score"],
            "lighting": quality_measurements["lighting"]["score"],
            "alignment": None,
            "visibility": None,
        }
        inference["metadata"] = {"qualityMeasurements": quality_measurements}
        return inference

    reason = (
        "Choose a model category before defect inference can run."
        if not category
        else readiness["reason"]
        if not readiness["ready"]
        else "PatchCore inference is not enabled until the category runtime is installed and validated."
    )

    return {
        "qualityOnly": True,
        "modelVersion": "opencv-quality-v1",
        "modelCategory": category,
        "quality": {
            "sharpness": quality_measurements["sharpness"]["score"],
            "lighting": quality_measurements["lighting"]["score"],
            "alignment": None,
            "visibility": None,
        },
        "defect": None,
        "errors": [reason],
        "metadata": {"qualityMeasurements": quality_measurements, "anomalyModel": readiness},
    }