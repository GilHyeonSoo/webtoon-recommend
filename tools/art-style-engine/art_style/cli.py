from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import sys
from pathlib import Path

from .config import load_config
from .inputs import discover
from .storage import output_lock


def print_json(value):
    print(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), flush=True)


def parser():
    p = argparse.ArgumentParser(description="Windows local webtoon art-style analysis: YOLOv8-face + DINOv2 + WD-14 + UMAP/HDBSCAN")
    commands = p.add_subparsers(dest="command", required=True)
    for command in ("scan", "prepare", "doctor", "analyze", "cluster", "similar"):
        sub = commands.add_parser(command)
        sub.add_argument("--config", help="Config JSON path; relative data/model paths are resolved from the repository root")
        sub.add_argument("--input", dest="input_dir")
        sub.add_argument("--output", dest="output_dir")
        sub.add_argument("--models", dest="model_dir")
        sub.add_argument("--debug", action="store_true", help="Show a traceback on failure")
        if command in {"scan", "analyze", "cluster"}:
            sub.add_argument("--limit", type=int, help="Limit the number of works (not images)")
            sub.add_argument("--work-id", action="append", help="Select an ID or provider/ID; may be repeated")
        if command in {"doctor", "analyze"}:
            sub.add_argument("--device", choices=("auto", "cuda", "cpu"))
        if command == "analyze":
            sub.add_argument("--batch-size", type=int)
            sub.add_argument("--fp32", action="store_true", help="Disable FP16")
            sub.add_argument("--force", action="store_true", help="Recompute selected works, including crops")
            sub.add_argument("--skip-clustering", action="store_true", help="Extract and save work JSON only")
        if command == "prepare":
            sub.add_argument("--face-weights", type=Path, help="Optional custom Ultralytics-compatible YOLOv8-face .pt")
        if command == "similar":
            sub.add_argument("work_id", help="Work ID or full provider/ID key")
    return p


def doctor(config):
    packages = {}
    for name in ("torch", "torchvision", "timm", "transformers", "ultralytics", "numpy", "Pillow", "umap-learn", "hdbscan", "scikit-learn"):
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    info = {"python": sys.version, "packages": packages,
            "input": str(config.path("input_dir")), "output": str(config.path("output_dir")),
            "models": str(config.path("model_dir")), "requested_batch_size": config.batch_size}
    if packages["torch"]:
        from .models import Runtime
        runtime = Runtime(config)
        info["runtime"] = runtime.info
        if runtime.device.startswith("cuda"):
            # Check kernels as well as driver discovery before downloading large model weights.
            import torch
            from torchvision.ops import nms
            with torch.inference_mode():
                probe = torch.ones((16, 16), dtype=torch.float16, device=runtime.device)
                result = probe @ probe
                nms(torch.tensor([[0.0, 0.0, 10.0, 10.0]], device=runtime.device),
                    torch.tensor([0.9], device=runtime.device), 0.5)
                torch.cuda.synchronize()
                if not torch.isfinite(result).all().item():
                    raise ValueError("CUDA inference check returned invalid values")
            info["runtime"]["cuda_kernel_check"] = "passed"
            del probe, result
            runtime.clear()
    else:
        info["runtime"] = {"error": "PyTorch is not installed. Run scripts/setup-art-engine-windows.ps1"}
    print_json(info)
    return 0 if all(packages.values()) else 1


def main(argv=None) -> int:
    # Model setup downloads weights only. All analysis commands read local assets and never upload images.
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    args = parser().parse_args(argv)
    try:
        overrides = {k: getattr(args, k, None) for k in ("input_dir", "output_dir", "model_dir", "device", "batch_size")}
        if getattr(args, "fp32", False):
            overrides["fp16"] = False
        config = load_config(args.config, overrides)
        if args.command == "doctor":
            return doctor(config)
        if args.command == "prepare":
            from .models import prepare_models
            with output_lock(config.path("model_dir")):
                manifest = prepare_models(config.path("model_dir"), args.face_weights)
            print_json({"prepared": str(config.path("model_dir")), "files": list(manifest["files"])})
            return 0
        if args.command == "similar":
            from .indexing import similar
            print_json(similar(config, args.work_id))
            return 0
        works = discover(config.path("input_dir"))
        discovered_count = len(works)
        if args.work_id:
            wanted = set(args.work_id)
            found = {value for w in works for value in (w.key, w.work_id) if value in wanted}
            if wanted - found:
                raise ValueError(f"Unknown work IDs: {sorted(wanted - found)}")
            works = [w for w in works if w.key in wanted or w.work_id in wanted]
        if args.limit is not None:
            if args.limit < 1:
                raise ValueError("--limit must be positive")
            works = works[:args.limit]
        if args.command == "scan":
            providers = {}
            for work in works:
                provider = work.provider or "DIRECT"
                providers[provider] = providers.get(provider, 0) + 1
            print_json({"input": str(config.path("input_dir")), "discovered_works": discovered_count,
                        "selected_works": len(works), "images": sum(len(w.files) for w in works), "providers": providers,
                        "sample": [{"key": w.key, "work_id": w.work_id, "images": len(w.files)} for w in works[:10]]})
            return 0
        if not works:
            raise ValueError("No images were found in work-ID folders")
        with output_lock(config.path("output_dir")):
            if args.command == "analyze":
                from .pipeline import analyze
                result = analyze(config, works, args.force, args.skip_clustering)
                print_json(result)
                return 2 if result["state"] == "completed_with_errors" else 0
            from .indexing import build_index
            result = build_index(config, works)
            print_json(result)
            return 2 if result["excluded_works"] or result["partial_works"] else 0
    except KeyboardInterrupt:
        print("Cancelled. Saved work JSON will be reused on the next run.", file=sys.stderr)
        return 130
    except Exception as exc:
        if args.debug:
            raise
        print(f"ERROR: {exc}", file=sys.stderr)
        if isinstance(exc, ImportError):
            print("Install engine dependencies with scripts/setup-art-engine-windows.ps1", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
