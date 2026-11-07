from __future__ import annotations

import csv
import gc
import os
import shutil
import urllib.request
from pathlib import Path

from .config import Config, digest
from .storage import atomic_json, file_hash, now, read_json

DINO_REPO = "facebook/dinov2-small"
DINO_REVISION = "ed25f3a31f01632728cabb09d1542f84ab7b0056"
WD_REPO = "SmilingWolf/wd-swinv2-tagger-v3"
WD_REVISION = "627aef95638667ddcaa3ac8ae625e88ea5b02f51"
FACE_URL = "https://github.com/lindevs/yolov8-face/releases/download/1.0.1/yolov8n-face-lindevs.pt"
FACE_SHA256 = "b038ca653b503453a94f6e12d76feca6840b2a97d7a1322b4498c5e922f29832"
PERSON_URL = "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt"
PERSON_SHA256 = "f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c47ccfc83b36"
REQUIRED = ("dino/config.json", "dino/preprocessor_config.json", "dino/model.safetensors",
            "wd14/config.json", "wd14/model.safetensors", "wd14/selected_tags.csv", "face.pt", "person.pt")


def prepare_models(folder: Path, custom_face: Path | None = None) -> dict:
    from huggingface_hub import hf_hub_download

    folder.mkdir(parents=True, exist_ok=True)
    for subdir, repo, revision, names in (
        ("dino", DINO_REPO, DINO_REVISION, ("config.json", "preprocessor_config.json", "model.safetensors")),
        ("wd14", WD_REPO, WD_REVISION, ("config.json", "model.safetensors", "selected_tags.csv")),
    ):
        for name in names:
            print(f"Download/cache: {repo}/{name}", flush=True)
            hf_hub_download(repo_id=repo, revision=revision, filename=name, local_dir=str(folder / subdir))
    for name, url in (("face.pt", FACE_URL), ("person.pt", PERSON_URL)):
        path = folder / name
        if name == "face.pt" and custom_face:
            if custom_face.resolve() != path.resolve():
                shutil.copyfile(custom_face, path)
            continue
        expected_hash = FACE_SHA256 if name == "face.pt" else PERSON_SHA256
        if path.exists() and file_hash(path) == expected_hash:
            continue
        temp = path.with_suffix(".part")
        print(f"Download: {url}", flush=True)
        try:
            with urllib.request.urlopen(url, timeout=120) as response, temp.open("wb") as f:
                shutil.copyfileobj(response, f)
            if file_hash(temp) != expected_hash:
                raise ValueError(f"YOLO download checksum mismatch: {name}")
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)
    manifest = {
        "schema_version": 1, "prepared_at": now(),
        "sources": {"dino": {"repo": DINO_REPO, "revision": DINO_REVISION},
                    "wd14": {"repo": WD_REPO, "revision": WD_REVISION},
                    "face": str(custom_face.resolve()) if custom_face else FACE_URL, "person": PERSON_URL},
        "files": {name: file_hash(folder / name) for name in REQUIRED},
    }
    atomic_json(folder / "models.json", manifest)
    return manifest


def verify_models(folder: Path) -> tuple[dict, str]:
    try:
        manifest = read_json(folder / "models.json")
        for name in REQUIRED:
            if file_hash(folder / name) != manifest["files"][name]:
                raise ValueError(f"Model checksum mismatch: {name}")
    except (FileNotFoundError, KeyError) as exc:
        raise ValueError("Models are missing/incomplete. Run the prepare command first.") from exc
    return manifest, digest({"files": manifest["files"], "sources": manifest["sources"]})


def labels(folder: Path) -> list[dict]:
    with (folder / "wd14" / "selected_tags.csv").open(encoding="utf-8-sig", newline="") as f:
        return [{"name": row["name"], "category": int(row["category"])} for row in csv.DictReader(f)]


class Runtime:
    def __init__(self, config: Config):
        import torch

        self.torch = torch
        if config.device == "cuda" and not torch.cuda.is_available():
            raise ValueError("CUDA is unavailable. Check the NVIDIA driver and CUDA PyTorch installation.")
        self.device = "cuda:0" if config.device != "cpu" and torch.cuda.is_available() else "cpu"
        self.fp16 = config.fp16 and self.device.startswith("cuda")
        torch.set_num_threads(config.cpu_threads)
        self.info = {"device": self.device, "precision": "fp16" if self.fp16 else "fp32", "torch": torch.__version__}
        if self.device.startswith("cuda"):
            props = torch.cuda.get_device_properties(0)
            self.info.update(gpu=props.name, vram_bytes=props.total_memory, cuda=torch.version.cuda)

    def clear(self):
        gc.collect()
        if self.device.startswith("cuda"):
            self.torch.cuda.empty_cache()


class Detector:
    def __init__(self, config: Config, runtime: Runtime):
        settings_dir = config.path("model_dir") / "ultralytics"
        settings_dir.mkdir(parents=True, exist_ok=True)
        os.environ["YOLO_CONFIG_DIR"] = str(settings_dir)
        os.environ["YOLO_AUTOINSTALL"] = "false"
        os.environ["YOLO_OFFLINE"] = "true"
        from ultralytics import YOLO, settings

        settings.update({"sync": False})

        self.config, self.runtime = config, runtime
        self.face = YOLO(str(config.path("model_dir") / "face.pt"), task="detect")
        self.person = YOLO(str(config.path("model_dir") / "person.pt"), task="detect") if config.person_detection else None

    def _predict(self, model, image, confidence):
        # PIL input is RGB; passing an RGB numpy array would be interpreted as BGR by YOLO.
        results = model.predict(source=image, imgsz=self.config.detection_size,
                                conf=confidence, classes=[0], max_det=32,
                                device=self.runtime.device, half=self.runtime.fp16,
                                save=False, verbose=False)
        boxes = results[0].boxes
        return [{"bbox": box.tolist(), "confidence": float(score)}
                for box, score in zip(boxes.xyxy.cpu(), boxes.conf.cpu())] if boxes is not None else []

    def detect(self, image):
        try:
            return self._predict(self.face, image, self.config.face_confidence), (
                self._predict(self.person, image, self.config.person_confidence) if self.person else [])
        except RuntimeError as exc:
            if "out of memory" in str(exc).lower():
                raise RuntimeError("Detector CUDA memory exhausted. Close GPU apps or reduce detection_size.") from exc
            raise

    def close(self):
        self.face = self.person = None
        self.runtime.clear()


def adaptive_batches(items, operation, batch_size: int, runtime: Runtime, name: str):
    """Retry exactly the same uncommitted batch after a CUDA OOM, preserving item order."""
    position, size, smallest = 0, batch_size, batch_size
    outputs = []
    while position < len(items):
        failed = False
        try:
            result = operation(items[position:position + size])
        except RuntimeError as exc:
            is_oom = isinstance(exc, runtime.torch.cuda.OutOfMemoryError) or "cuda out of memory" in str(exc).lower()
            if not is_oom or not runtime.device.startswith("cuda") or size == 1:
                raise
            failed = True
        if failed:
            runtime.clear()
            size = max(1, size // 2)
            smallest = min(smallest, size)
            print(f"{name}: GPU memory retry, batch {size}", flush=True)
            continue
        outputs.extend(result)
        position += min(size, len(items) - position)
    return outputs, smallest


class Extractor:
    def __init__(self, config: Config, runtime: Runtime):
        import timm
        from safetensors.torch import load_file
        from transformers import AutoImageProcessor, Dinov2Model

        self.config, self.runtime = config, runtime
        folder = config.path("model_dir")
        self.processor = AutoImageProcessor.from_pretrained(str(folder / "dino"), local_files_only=True, use_fast=False)
        self.dino = Dinov2Model.from_pretrained(str(folder / "dino"), local_files_only=True,
                                              use_safetensors=True, attn_implementation="eager").eval().to(runtime.device)
        wd = read_json(folder / "wd14" / "config.json")
        self.wd = timm.create_model(wd["architecture"], pretrained=False,
                                   num_classes=wd["num_classes"], global_pool=wd["global_pool"],
                                   **wd["model_args"])
        self.wd.load_state_dict(load_file(str(folder / "wd14" / "model.safetensors")), strict=True)
        self.wd.eval().to(runtime.device)
        self.wd_size = wd["pretrained_cfg"]["input_size"][-1]
        self.wd_mean = wd["pretrained_cfg"]["mean"]
        self.wd_std = wd["pretrained_cfg"]["std"]
        self.label_data = labels(folder)
        if len(self.label_data) != wd["num_classes"]:
            raise ValueError("WD-14 vocabulary does not match its model")
        self.general_indices = [i for i, label in enumerate(self.label_data) if label["category"] == 0]
        self.dino_batch = self.wd_batch = config.batch_size
        self.smallest_batch = {"dino": config.batch_size, "wd14": config.batch_size}

    def _dino_batch(self, images):
        import torch
        from .images import square

        inputs = self.processor(images=[square(im) for im in images], return_tensors="pt")
        inputs = {key: value.to(self.runtime.device) for key, value in inputs.items()}
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.float16, enabled=self.runtime.fp16):
            result = self.dino(**inputs).last_hidden_state[:, 0]
        result = torch.nn.functional.normalize(result.float(), dim=1)
        return result.cpu().numpy()

    def _wd_batch(self, images):
        import torch
        from PIL import Image
        from torchvision.transforms.functional import normalize, to_tensor
        from .images import square

        inputs = torch.stack([normalize(to_tensor(square(im).resize((self.wd_size, self.wd_size), Image.Resampling.BICUBIC)),
                                        self.wd_mean, self.wd_std) for im in images])
        # WD's timm weights require normalized BGR, unlike DINO's RGB preprocessing.
        inputs = inputs[:, [2, 1, 0]].to(self.runtime.device)
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.float16, enabled=self.runtime.fp16):
            result = self.wd(inputs)
        return result.float().sigmoid().cpu().numpy()

    def extract(self, images):
        import numpy as np

        dino, self.dino_batch = adaptive_batches(images, self._dino_batch, self.dino_batch, self.runtime, "DINOv2")
        tags, self.wd_batch = adaptive_batches(images, self._wd_batch, self.wd_batch, self.runtime, "WD-14")
        self.smallest_batch = {"dino": self.dino_batch, "wd14": self.wd_batch}
        dino, tags = np.asarray(dino, dtype=np.float32), np.asarray(tags, dtype=np.float32)
        if not np.isfinite(dino).all() or not np.isfinite(tags).all():
            raise ValueError("Model produced non-finite features; rerun with --fp32")
        return dino, tags

    def visible_tags(self, probabilities) -> dict:
        result = {"general": [], "character": [], "rating": []}
        for label, score in zip(self.label_data, probabilities):
            category = label["category"]
            group = {0: "general", 4: "character", 9: "rating"}.get(category)
            threshold = self.config.general_threshold if category == 0 else self.config.character_threshold
            if group and (category == 9 or score >= threshold):
                result[group].append({"name": label["name"], "score": round(float(score), 6)})
        for group in result.values():
            group.sort(key=lambda t: (-t["score"], t["name"]))
        return result

    def close(self):
        self.dino = self.wd = None
        self.runtime.clear()
