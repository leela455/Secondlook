import asyncio
import hashlib
import json
import tempfile
import unittest
from io import BytesIO
from pathlib import Path

import cv2
import numpy as np
from fastapi import HTTPException, UploadFile

from app import health, predict
from model_registry import VISA_CATEGORIES, category_status, category_statuses
from patchcore_runtime import normalize_prediction


class ImageQualityTests(unittest.TestCase):
    def make_upload(self, image):
        ok, encoded = cv2.imencode(".png", image)
        self.assertTrue(ok)
        return UploadFile(
            filename="part.png",
            file=BytesIO(encoded.tobytes()),
            headers={"content-type": "image/png"},
        )

    def test_measures_image_pixels_without_inventing_geometry_or_prediction(self):
        image = np.zeros((128, 160, 3), dtype=np.uint8)
        cv2.rectangle(image, (20, 20), (140, 108), (180, 180, 180), 3)
        cv2.putText(image, "PART", (42, 75), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)

        result = asyncio.run(predict(self.make_upload(image)))

        self.assertTrue(result["qualityOnly"])
        self.assertIsNone(result["defect"])
        self.assertIsNotNone(result["quality"]["sharpness"])
        self.assertIsNotNone(result["quality"]["lighting"])
        self.assertIsNone(result["quality"]["alignment"])
        self.assertIsNone(result["quality"]["visibility"])
        self.assertGreaterEqual(result["metadata"]["qualityMeasurements"]["sharpness"]["value"], 0)
        self.assertEqual(result["metadata"]["qualityMeasurements"]["image"], {"width": 160, "height": 128})
        self.assertIn("Choose a model category", result["errors"][0])

    def test_rejects_invalid_image_bytes(self):
        upload = UploadFile(
            filename="invalid.png",
            file=BytesIO(b"not an image"),
            headers={"content-type": "image/png"},
        )
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(predict(upload))
        self.assertEqual(raised.exception.status_code, 400)

    def test_health_discloses_missing_defect_model(self):
        self.assertEqual(health()["defect_model"], "not_configured")

    def test_patchcore_prediction_uses_raw_score_and_prediction_mask_for_localization(self):
        class Prediction:
            pred_score = np.array([0.71], dtype=np.float32)
            pred_mask = np.array([[[0, 0, 0], [0, 1, 1], [0, 1, 1]]], dtype=np.uint8)

        model = {
            "modelVersion": "patchcore-pcb1-v1",
            "anomalyThreshold": 0.5,
            "uncertainMargin": 0.05,
            "scoreSemantics": "PatchCore nearest-neighbor anomaly score; not a probability.",
            "validation": {"dataset": "VisA", "evaluatedAt": "2026-10-25"},
        }
        result = normalize_prediction([Prediction()], "pcb1", model)
        self.assertEqual(result["task"], "patchcore_anomaly_detection")
        self.assertAlmostEqual(result["anomaly"]["score"], 0.71, places=6)
        self.assertEqual(result["anomaly"]["decision"], "anomalous")
        self.assertEqual(result["anomaly"]["localization"], {"x": 1 / 3, "y": 1 / 3, "w": 2 / 3, "h": 2 / 3})

    def test_patchcore_score_close_to_calibrated_threshold_is_uncertain(self):
        class Prediction:
            pred_score = 0.51
            pred_mask = None

        model = {"modelVersion": "v1", "anomalyThreshold": 0.5, "uncertainMargin": 0.03,
                 "scoreSemantics": "raw score", "validation": {"dataset": "VisA", "evaluatedAt": "2026-10-25"}}
        self.assertEqual(normalize_prediction(Prediction(), "pcb1", model)["anomaly"]["decision"], "uncertain")

    def test_registry_lists_known_categories_as_untrained(self):
        result = category_statuses()
        self.assertEqual(len(result), 12)
        self.assertEqual({item["category"] for item in result}, set(VISA_CATEGORIES))
        self.assertTrue(all(not item["ready"] for item in result))

    def test_unsupported_category_is_not_ready(self):
        self.assertFalse(category_status("unknown")["ready"])

    def test_missing_checkpoint_and_unvalidated_model_are_not_ready(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "manifest.json"
            manifest.write_text(json.dumps({"schemaVersion": 1, "models": {
                "pcb1": {
                    "checkpoint": "pcb1/model.ckpt",
                    "checkpointSha256": "0" * 64,
                    "modelVersion": "prototype-1",
                    "modelConfig": {"backbone": "resnet18", "layers": ["layer2", "layer3"], "pre_trained": True},
                    "modelConfig": {"backbone": "resnet18", "layers": ["layer2", "layer3"], "pre_trained": True},
                    "scoreSemantics": "PatchCore nearest-neighbor anomaly score; not a probability.",
                    "anomalyThreshold": 0.42,
                    "status": "validated",
                    "runtimeVerified": True,
                    "validation": {"dataset": "VisA", "category": "pcb1", "evaluatedAt": "2026-10-25"},
                },
            }}), encoding="utf-8")
            status = category_status("pcb1", manifest, root)
            self.assertFalse(status["ready"])
            self.assertIn("missing", status["reason"])

            checkpoint = root / "pcb1" / "model.ckpt"
            checkpoint.parent.mkdir()
            checkpoint.write_bytes(b"test checkpoint fixture")
            status = category_status("pcb1", manifest, root)
            self.assertFalse(status["ready"])
            self.assertIn("SHA-256", status["reason"])
            manifest_data = json.loads(manifest.read_text(encoding="utf-8"))
            manifest_data["models"]["pcb1"]["checkpointSha256"] = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
            manifest.write_text(json.dumps(manifest_data), encoding="utf-8")
            status = category_status("pcb1", manifest, root)
            self.assertFalse(status["ready"])
            self.assertIn("runtime", status["reason"])

    def test_prediction_rejects_unknown_category_and_keeps_untrained_category_quality_only(self):
        image = np.zeros((64, 64, 3), dtype=np.uint8)
        result = asyncio.run(predict(self.make_upload(image), "pcb1"))
        self.assertEqual(result["modelCategory"], "pcb1")
        self.assertIsNone(result["defect"])
        self.assertIn("No trained model", result["errors"][0])
        with self.assertRaises(HTTPException) as raised:
            asyncio.run(predict(self.make_upload(image), "unknown"))
        self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()