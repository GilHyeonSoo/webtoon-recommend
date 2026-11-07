from __future__ import annotations

import hashlib
import json
import math
from dataclasses import asdict, dataclass, fields
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


@dataclass(frozen=True)
class Config:
    input_dir: str = "이미지"
    output_dir: str = "작화분석결과"
    model_dir: str = ".art-models"
    device: str = "auto"
    fp16: bool = True
    batch_size: int = 32
    work_window: int = 8
    cpu_threads: int = 6
    detection_size: int = 640
    face_confidence: float = 0.25
    person_confidence: float = 0.35
    max_faces: int = 4
    max_bodies: int = 4
    min_crop_size: int = 24
    face_padding: float = 0.15
    person_detection: bool = True
    original_weight: float = 0.2
    face_weight: float = 0.5
    upper_body_weight: float = 0.3
    dino_weight: float = 0.85
    tag_weight: float = 0.15
    general_threshold: float = 0.35
    character_threshold: float = 0.75
    umap_neighbors: int = 30
    umap_components: int = 10
    umap_min_dist: float = 0.0
    min_cluster_size: int = 15
    min_samples: int = 5
    neighbors: int = 10
    seed: int = 42

    def path(self, name: str) -> Path:
        p = Path(getattr(self, name)).expanduser()
        return (p if p.is_absolute() else ROOT / p).resolve()

    def validate(self) -> Config:
        for name in ("input_dir", "output_dir", "model_dir", "device"):
            if not isinstance(getattr(self, name), str) or not getattr(self, name):
                raise ValueError(f"{name} must be a nonempty string")
        if self.device not in {"auto", "cuda", "cpu"}:
            raise ValueError("device must be auto, cuda or cpu")
        for name in ("fp16", "person_detection"):
            if type(getattr(self, name)) is not bool:
                raise ValueError(f"{name} must be a boolean")
        for name, low, high in (
            ("batch_size", 1, 256), ("work_window", 1, 32), ("cpu_threads", 1, 64),
            ("detection_size", 64, 2048), ("max_faces", 1, 16), ("max_bodies", 1, 16),
            ("min_crop_size", 8, 512), ("umap_neighbors", 2, 200),
            ("umap_components", 2, 100), ("min_cluster_size", 2, 10000),
            ("min_samples", 1, 10000), ("neighbors", 1, 100), ("seed", 0, 2147483647),
        ):
            value = getattr(self, name)
            if type(value) is not int or not low <= value <= high:
                raise ValueError(f"{name} must be an integer in [{low}, {high}]")
        for name in ("face_confidence", "person_confidence", "face_padding", "original_weight",
                     "face_weight", "upper_body_weight", "dino_weight", "tag_weight",
                     "general_threshold", "character_threshold", "umap_min_dist"):
            value = getattr(self, name)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError(f"{name} must be a finite number in [0, 1]")
        if self.original_weight <= 0:
            raise ValueError("original_weight must be positive for detection fallback")
        if self.dino_weight + self.tag_weight <= 0:
            raise ValueError("dino_weight + tag_weight must be positive")
        src, dst, models = (self.path(k) for k in ("input_dir", "output_dir", "model_dir"))
        for a, b in ((src, dst), (src, models), (dst, models)):
            if a == b or a in b.parents or b in a.parents:
                raise ValueError("input_dir, output_dir and model_dir must not overlap")
        return self

    def feature_options(self) -> dict:
        runtime_only = {"input_dir", "output_dir", "model_dir", "device", "batch_size", "work_window", "cpu_threads",
                        "umap_neighbors", "umap_components", "umap_min_dist", "min_cluster_size",
                        "min_samples", "neighbors", "seed", "dino_weight", "tag_weight"}
        return {k: v for k, v in asdict(self).items() if k not in runtime_only}


def digest(value: object) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def load_config(filename: str | None, overrides: dict) -> Config:
    values = {}
    if filename:
        values = json.loads(Path(filename).read_text(encoding="utf-8-sig"))
        if not isinstance(values, dict):
            raise ValueError("Config JSON must be an object")
        unknown = set(values) - {f.name for f in fields(Config)}
        if unknown:
            raise ValueError(f"Unknown config keys: {sorted(unknown)}")
    values.update({k: v for k, v in overrides.items() if v is not None})
    return Config(**values).validate()
