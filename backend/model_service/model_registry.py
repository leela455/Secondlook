import json
import hashlib
import importlib.util
import math
import os
from pathlib import Path

VISA_CATEGORIES = (
    "pcb1",
    "pcb2",
    "pcb3",
    "pcb4",
    "capsules",
    "candle",
    "macaroni1",
    "macaroni2",
    "cashew",
    "chewinggum",
    "fryum",
    "pipe_fryum",
)

MODEL_ROOT = Path(os.getenv("MODEL_ARTIFACT_DIR", Path(__file__).parent / "models")).resolve()
MANIFEST_PATH = Path(os.getenv("MODEL_MANIFEST_PATH", Path(__file__).parent / "model_manifest.json")).resolve()
SCORE_SEMANTICS = "PatchCore nearest-neighbor anomaly score; not a probability."


class ManifestError(ValueError):
    pass


def read_manifest(path=None):
    try:
        manifest = json.loads(Path(path or MANIFEST_PATH).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"schemaVersion": 1, "models": {}}
    except (OSError, json.JSONDecodeError) as exc:
        raise ManifestError("Model manifest is unreadable or invalid JSON.") from exc

    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1 or not isinstance(manifest.get("models"), dict):
        raise ManifestError("Model manifest must contain schemaVersion 1 and a models object.")
    return manifest


def _sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def category_status(category, manifest_path=None, model_root=None):
    if category not in VISA_CATEGORIES:
        return {"category": category, "ready": False, "reason": "Unsupported VisA category."}

    try:
        manifest = read_manifest(manifest_path)
    except ManifestError:
        return {"category": category, "ready": False, "reason": "Model manifest is invalid."}

    model = manifest["models"].get(category)
    if not isinstance(model, dict):
        return {"category": category, "ready": False, "reason": "No trained model is registered for this category."}

    checkpoint_name = model.get("checkpoint")
    if not isinstance(checkpoint_name, str) or not checkpoint_name:
        return {"category": category, "ready": False, "reason": "No checkpoint is registered for this category."}

    artifact_root = Path(model_root or MODEL_ROOT).resolve()
    checkpoint = (artifact_root / checkpoint_name).resolve()
    if artifact_root not in checkpoint.parents:
        return {"category": category, "ready": False, "reason": "Checkpoint path is outside the model artifact directory."}
    if not checkpoint.is_file():
        return {"category": category, "ready": False, "reason": "Registered model checkpoint is missing."}

    expected_hash = model.get("checkpointSha256")
    if not isinstance(expected_hash, str) or len(expected_hash) != 64:
        return {"category": category, "ready": False, "reason": "Checkpoint SHA-256 is missing from model manifest."}
    actual_hash = _sha256_file(checkpoint)
    if actual_hash != expected_hash.lower():
        return {"category": category, "ready": False, "reason": "Checkpoint SHA-256 does not match the model manifest."}

    if importlib.util.find_spec("anomalib") is None:
        return {"category": category, "ready": False, "reason": "PatchCore runtime dependencies are not installed."}

    threshold = model.get("anomalyThreshold")
    uncertain_margin = model.get("uncertainMargin")
    model_config = model.get("modelConfig")
    version = model.get("modelVersion")
    validation = model.get("validation")
    if (
        model.get("status") != "validated"
        or not isinstance(version, str)
        or not version.strip()
        or not isinstance(threshold, (int, float))
        or isinstance(threshold, bool)
        or not math.isfinite(threshold)
        or threshold <= 0
        or not isinstance(uncertain_margin, (int, float))
        or isinstance(uncertain_margin, bool)
        or not math.isfinite(uncertain_margin)
        or uncertain_margin < 0
        or not isinstance(model_config, dict)
        or model_config.get("backbone") not in {"resnet18", "wide_resnet50_2"}
        or model_config.get("layers") != ["layer2", "layer3"]
        or not set(model_config).issubset({"backbone", "layers", "pre_trained", "coreset_sampling_ratio", "num_neighbors", "precision"})
        or not isinstance(validation, dict)
        or validation.get("category") != category
        or not validation.get("dataset")
        or not validation.get("evaluatedAt")
        or model.get("runtimeVerified") is not True
        or model.get("scoreSemantics") != SCORE_SEMANTICS
    ):
        return {"category": category, "ready": False, "reason": "Model is not validated with category-specific threshold metadata."}

    return {
        "category": category,
        "ready": True,
        "modelVersion": version,
        "modelId": model.get("modelId", "patchcore"),
        "anomalyThreshold": float(threshold),
        "uncertainMargin": float(uncertain_margin),
        "scoreSemantics": model["scoreSemantics"],
        "validation": {"category": category, "status": "validated", **validation},
    }


def ready_model(category, manifest_path=None, model_root=None):
    status = category_status(category, manifest_path, model_root)
    if not status["ready"]:
        return None
    manifest = read_manifest(manifest_path)
    entry = manifest["models"][category]
    root = Path(model_root or MODEL_ROOT).resolve()
    return {**status, "checkpointPath": str((root / entry["checkpoint"]).resolve()), "modelConfig": entry["modelConfig"]}


def category_statuses(manifest_path=None, model_root=None):
    return [category_status(category, manifest_path, model_root) for category in VISA_CATEGORIES]