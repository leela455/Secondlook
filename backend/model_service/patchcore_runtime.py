import math
import tempfile
from pathlib import Path

import cv2
import numpy as np


def _to_numpy(value):
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        value = value.numpy()
    return np.asarray(value)


def _field(prediction, key):
    if isinstance(prediction, dict):
        return prediction.get(key)
    return getattr(prediction, key, None)


def _first_prediction(result):
    if result is None:
        raise RuntimeError("PatchCore returned no predictions.")
    if isinstance(result, (list, tuple)):
        if not result:
            raise RuntimeError("PatchCore returned an empty prediction list.")
        return result[0]
    return result


def _localization(prediction):
    mask = _field(prediction, "pred_mask")
    if mask is None:
        return None
    values = np.squeeze(_to_numpy(mask))
    if values.ndim != 2 or not np.isfinite(values).all():
        return None
    binary = (values > 0).astype(np.uint8)
    if not binary.any():
        return None
    points = cv2.findNonZero(binary)
    x, y, width, height = cv2.boundingRect(points)
    return {
        "x": x / values.shape[1],
        "y": y / values.shape[0],
        "w": width / values.shape[1],
        "h": height / values.shape[0],
    }


def normalize_prediction(predictions, category, model):
    prediction = _first_prediction(predictions)
    raw_score = _field(prediction, "pred_score")
    if raw_score is None:
        raise RuntimeError("PatchCore prediction is missing pred_score.")
    score_values = _to_numpy(raw_score).reshape(-1)
    if score_values.size != 1:
        raise RuntimeError("PatchCore returned an unexpected number of image scores.")
    score = float(score_values[0])
    threshold = float(model["anomalyThreshold"])
    margin = float(model["uncertainMargin"])
    if not math.isfinite(score) or not math.isfinite(threshold) or not math.isfinite(margin) or threshold <= 0 or margin < 0:
        raise RuntimeError("PatchCore returned a non-finite score or invalid calibration threshold.")

    delta = score - threshold
    if abs(delta) <= margin:
        decision = "uncertain"
    else:
        decision = "anomalous" if delta > 0 else "normal"
    return {
        "task": "patchcore_anomaly_detection",
        "modelVersion": model["modelVersion"],
        "modelCategory": category,
        "anomaly": {
            "score": score,
            "threshold": threshold,
            "decision": decision,
            "scoreSemantics": model["scoreSemantics"],
            "localization": _localization(prediction),
            "validation": {"category": category, "status": "validated", **model["validation"]},
        },
    }


def predict_patchcore(image_bytes, category, model):
    try:
        from anomalib.engine import Engine
        from anomalib.models import Patchcore
    except ImportError as exc:
        raise RuntimeError("PatchCore runtime is unavailable; install the pinned anomalib requirements.") from exc

    checkpoint = Path(model["checkpointPath"])
    if not checkpoint.is_file():
        raise RuntimeError("Registered PatchCore checkpoint is missing.")

    try:
        patchcore = Patchcore(**model["modelConfig"])
        engine = Engine(accelerator="cpu", devices=1, logger=False)
        with tempfile.TemporaryDirectory(prefix="secondlook-patchcore-") as temp_dir:
            image_path = Path(temp_dir) / "evidence.png"
            image_path.write_bytes(image_bytes)
            predictions = engine.predict(
                model=patchcore,
                data_path=str(image_path),
                ckpt_path=str(checkpoint),
                return_predictions=True,
            )
        return normalize_prediction(predictions, category, model)
    except Exception as exc:
        raise RuntimeError("PatchCore inference failed; no defect prediction was produced.") from exc