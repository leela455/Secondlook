import argparse
import hashlib
import json
from pathlib import Path

from model_registry import VISA_CATEGORIES


def main():
    parser = argparse.ArgumentParser(description="Train a CPU PatchCore category checkpoint from prepared VisA data.")
    parser.add_argument("--dataset-root", required=True, type=Path, help="Prepared VisA 1-class root containing <category>/train/good.")
    parser.add_argument("--category", required=True, choices=VISA_CATEGORIES)
    parser.add_argument("--output-dir", type=Path, default=Path("models"))
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--confirm-dataset-rights", action="store_true", help="Confirm the VisA license discrepancy is resolved and this use is permitted.")
    args = parser.parse_args()

    if not args.confirm_dataset_rights:
        parser.error("Resolve VisA dataset licensing and pass --confirm-dataset-rights before training.")
    if args.batch_size != 1:
        parser.error("The initial Windows CPU profile supports batch size 1 only.")

    try:
        from anomalib.data import AnomalibDataModule
        from anomalib.data.datasets import VisaDataset
        from anomalib.engine import Engine
        from anomalib.models import Patchcore
    except ImportError as exc:
        raise SystemExit("PatchCore dependencies are missing. Install requirements-patchcore.txt in an isolated venv.") from exc

    class VisaCategoryDataModule(AnomalibDataModule):
        def __init__(self):
            super().__init__(
                train_batch_size=1,
                eval_batch_size=1,
                num_workers=0,
                val_split_mode="from_test",
                val_split_ratio=0.5,
                test_split_mode="from_dir",
                seed=42,
            )
            self.category = args.category

        def _setup(self, _stage=None):
            self.train_data = VisaDataset(root=args.dataset_root, category=args.category, split="train")
            self.test_data = VisaDataset(root=args.dataset_root, category=args.category, split="test")

    datamodule = VisaCategoryDataModule()
    datamodule.setup("fit")
    if len(datamodule.train_data) == 0 or len(datamodule.test_data) == 0:
        raise SystemExit(f"Normal training and held-out test images are required for {args.category}.")

    model = Patchcore(
        backbone="resnet18",
        layers=["layer2", "layer3"],
        pre_trained=True,
        coreset_sampling_ratio=0.01,
        precision="float32",
    )
    output_dir = args.output_dir.resolve() / args.category
    output_dir.mkdir(parents=True, exist_ok=True)
    engine = Engine(default_root_dir=str(output_dir / "training"), accelerator="cpu", devices=1, logger=False)
    engine.fit(model=model, datamodule=datamodule)

    checkpoint_path = engine.best_model_path
    if not checkpoint_path:
        raise SystemExit("Anomalib completed without producing a best checkpoint; refusing to register a model.")
    destination = output_dir / "patchcore.ckpt"
    if Path(checkpoint_path).resolve() != destination.resolve():
        destination.write_bytes(Path(checkpoint_path).read_bytes())
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    metrics = engine.test(model=model, datamodule=datamodule, ckpt_path=str(destination))
    (output_dir / "evaluation.json").write_text(json.dumps({"category": args.category, "dataset": "VisA", "metrics": metrics}, default=str, indent=2), encoding="utf-8")
    print(f"Training completed for {args.category} using normal-only VisA data.")
    print(f"Checkpoint: {destination}")
    print(f"Checkpoint SHA-256: {digest}")
    print(f"Held-out test metrics: {metrics}")
    print("Validation used a label-aware subset of the official test split; final test metrics use the disjoint remainder.")
    print("This checkpoint is NOT calibrated or inference-ready. Set an operating threshold using an explicit policy and verify inference before manifest registration.")


if __name__ == "__main__":
    main()