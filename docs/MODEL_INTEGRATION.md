# Connecting a real defect-detection model

## Current capabilities

The default provider is a **demo provider**. It produces repeatable mock scores from image bytes; it does not inspect pixels and must not be described as inference. The Python/FastAPI service does perform OpenCV image-quality measurements:

* Sharpness: raw grayscale Laplacian variance plus an uncalibrated 0-100 diagnostic score.
* Exposure: mean/median 8-bit grayscale values, under/overexposed pixel percentages, clipping percentage, plus a diagnostic score.
* Alignment and visibility: unavailable without reference geometry, masks, or an expected component region.

These measurements are not validated for any production camera, component, or inspection line. A quality-only result has no defect prediction and cannot pass; the existing decision workflow routes it to human review.

The service exposes `GET /categories` for the VisA category identifiers and accepts `model_category` in the existing multipart `/predict` request. Node uses the separate `modelCategory` field; it is not the workflow `inspectionType`. Model category is stored on the inspection and every immutable attempt. The checked-in `model_manifest.json` contains no model entries, so all categories report unavailable. The model service will remain quality-only until a real runtime and validated category checkpoint are configured.

## PatchCore selection and score meaning

The intended prototype is per-category PatchCore, not a generic image classifier. PatchCore builds a memory bank from normal training images and compares image patches to that bank. It produces a raw nearest-neighbor anomaly score and anomaly map. The score is **not a probability or confidence**. Per-category thresholds and an uncertainty margin must be calibrated on held-out data; localization is only returned when taken from the model-produced mask.

The implementation accepts a distinct anomaly response with model version, category, score, threshold, decision, score semantics, optional mask-derived localization, and category validation metadata. Scores near the threshold go to human review. Missing/unvalidated model metadata, inadequate image quality, inference failures, or absent predictions cannot pass. Anomaly detections always require human sign-off. Human pass approval checks stored category, threshold, decision, validation, model identity, and adequate evidence.

## Dataset license gate

VisA is hosted by [Amazon Science SPot-Diff](https://github.com/amazon-science/spot-diff). Its repository `LICENSE-DATASET` states CC BY 4.0, but Anomalib 2.7's `VisaDataset` source docstring states CC BY-NC-SA 4.0. That latter license prohibits commercial use. Commercial use is possible for SecondLook, so **do not download or train on VisA until the dataset provider confirms in writing which license governs the images and confirms the intended use is permitted**. This is a project gate, not legal advice. SPot-Diff code is Apache-2.0. The Anomalib library is Apache-2.0. Verify the license terms of pretrained backbone weights separately. MVTec AD is not a fallback for commercial use because its published CC BY-NC-SA 4.0 terms are non-commercial.

The project owner approved a VisA prototype but has not selected a category. PCB1 is a possible starting category, not a configured model. A VisA benchmark model would not be validated for SecondLook's actual manufactured parts or camera setup.

## Environment and current blocker

Verified preflight on this Windows machine:

* Python 3.12.10; FastAPI and OpenCV are installed in `.venv-model`.
* PyTorch, torchvision, Anomalib, and timm are not installed.
* NVIDIA GeForce RTX 3050 Laptop GPU, 4 GB VRAM; system RAM 15.7 GB.
* C: had about 263.8 GB free. PyPI, GitHub, and the VisA S3 archive URL responded to HEAD requests.
* The VisA archive is about 1.93 GB. No training dataset or model checkpoint is present in the workspace.

The optional `.venv-patchcore` environment is pinned to Anomalib 2.7.0 with its CPU extra. Anomalib 2.7 requires Python 3.10+ and PyTorch 2.10+. Its requirements include the existing FastAPI service dependencies.

No model dependencies or data have been downloaded for this implementation. A CPU-first Anomalib profile is proposed; actual CPU runtime and memory still need measurement. The 4 GB GPU is constrained, and the service currently uses CPU. No model is trained, thresholded, or enabled.

## Install and train a single category

Only continue after the data-license gate is resolved and a single category is selected. From the repository root in PowerShell:

```powershell
py -3.12 -m venv .venv-patchcore
.\.venv-patchcore\Scripts\python.exe -m pip install --upgrade pip
.\.venv-patchcore\Scripts\python.exe -m pip install -r backend\model_service\requirements-patchcore.txt
```

The optional environment is pinned to Anomalib 2.7.0 with its CPU extra. Anomalib 2.7 requires Python 3.10+ and PyTorch 2.10+. The VisA archive is provided by SPot-Diff at https://amazon-visual-anomaly.s3.us-west-2.amazonaws.com/VisA_20220922.tar; do not fetch it before rights are confirmed. Follow the upstream repository's 1-class split preparation tool, then train only on the selected category's normal images:

```powershell
python .\utils\prepare_data.py --split-type 1cls --data-folder <VisA-extracted-root> --save-folder <VisA-prepared-root> --split-file .\split_csv\1cls.csv

.\.venv-patchcore\Scripts\python.exe backend\model_service\train_patchcore.py --dataset-root <VisA-prepared-root>\1cls --category pcb1 --output-dir backend\model_service\models --confirm-dataset-rights
```

The training script uses Anomalib's `VisaDataset`, PatchCore with ResNet-18 `layer2`/`layer3`, CPU, batch size 1, and a 1% coreset. The `--confirm-dataset-rights` flag is mandatory. The script writes a checkpoint and SHA-256 but does not mark it inference-ready. Training must be evaluated on held-out normal/anomalous images and masks. Document image AUROC and pixel localization metrics, choose a category-specific threshold and uncertainty margin from a stated validation policy, then verify inference through the running service. Do not interpret an anomaly score as probability.

To mark a model ready, add its entry to `model_manifest.json` only after validation. It must include the category, model version, checkpoint path and matching SHA-256, validated status, runtime verification, supported model configuration, calibrated threshold, uncertainty margin, score semantics, and category-specific dataset/evaluation date. Checkpoint files remain under the ignored local `models/` directory and must not be committed. Missing or mismatched data leaves the category unavailable.

The current `backend/model_service/patchcore_runtime.py` runs inference on CPU with `Engine.predict(..., data_path=<decoded upload>, ckpt_path=<checkpoint>)`. It expects PatchCore's `pred_score` and `pred_mask`; the localization box is derived from that mask. The service bounds inference to 12 seconds. Any runtime exception or timeout returns a failure, never a synthetic result. Benchmark CPU latency before operational decisions. A CUDA configuration requires a separate PyTorch/CUDA setup, a tested GPU runtime path, and measured VRAM/runtime on this 4 GB GPU.

## Start services

The OpenCV/FastAPI quality service can run without model dependencies. If port 8000 is already occupied, use an unused port such as 8001:

```powershell
.\.venv-model\Scripts\python.exe -m pip install -r backend\model_service\requirements.txt
.\.venv-model\Scripts\python.exe -m uvicorn app:app --app-dir backend\model_service --host 127.0.0.1 --port 8000
```

In `backend/.env`, set `INSPECTION_PROVIDER=http`, `MODEL_API_URL=http://127.0.0.1:8001/predict` (or the port selected above), and `MODEL_API_TIMEOUT_MS=15000`; restart Node. `GET /health` reports `defect_model: not_configured` until a category is ready. `GET /categories` returns readiness by category.

## HTTP prediction contract

For a future trained PatchCore category, the HTTP service response must follow this shape; example measurements are illustrative, not real model outputs:

```json
{
  "task": "patchcore_anomaly_detection",
  "modelVersion": "patchcore-pcb1-v1",
  "modelCategory": "pcb1",
  "quality": { "sharpness": 91, "lighting": 93, "alignment": null, "visibility": null },
  "anomaly": {
    "score": 0.73,
    "threshold": 0.50,
    "decision": "anomalous",
    "scoreSemantics": "PatchCore nearest-neighbor anomaly score; not a probability.",
    "localization": { "x": 0.2, "y": 0.25, "w": 0.3, "h": 0.2 },
    "validation": { "category": "pcb1", "status": "validated", "dataset": "VisA", "evaluatedAt": "2026-10-25" }
  },
  "metadata": {}
}
```

The service validates image MIME, encoded image decoding, minimum 32x32 dimensions, at most 5 MB uploaded bytes, at most 25 megapixels decoded, category allow-list, checkpoint path containment/hash, runtime availability, and result structure. It never fabricates localization. Raw quality metrics stay separate from model outputs. Alignment and visibility remain unavailable without geometry/reference evidence.

## Verification requirements

1. Run `backend/model_service` tests and all backend Jest tests.
2. Test a valid trained checkpoint with held-out images; record score distributions, image AUROC, pixel localization metrics, selected threshold, and CPU runtime.
3. Exercise Node-to-FastAPI with a real image and selected category.
4. Verify unsupported categories, missing/corrupt checkpoints, invalid images, malformed model results, and timeouts cannot pass.
5. Verify recaptures preserve all earlier attempts; reviewer pass actions require a validated normal result and adequate quality; anomaly results always require sign-off.
6. Evaluate any candidate checkpoint on representative real SecondLook parts/cameras before deployment. VisA category validation is not real-line validation.
