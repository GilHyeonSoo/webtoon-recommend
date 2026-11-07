from __future__ import annotations

import hashlib
import io
import math
import os
import tempfile
from pathlib import Path

from PIL import Image, ImageOps


def open_rgb(path: Path, expected_hash: str | None = None) -> Image.Image:
    data = path.read_bytes()
    if expected_hash and hashlib.sha256(data).hexdigest() != expected_hash:
        raise ValueError("Input changed during analysis; rerun after the download finishes")
    with Image.open(io.BytesIO(data)) as raw:
        raw.seek(0)
        image = ImageOps.exif_transpose(raw).convert("RGBA")
        image.load()
    canvas = Image.new("RGBA", image.size, "white")
    canvas.alpha_composite(image)
    return canvas.convert("RGB")


def square(image: Image.Image) -> Image.Image:
    side = max(image.size)
    canvas = Image.new("RGB", (side, side), "white")
    canvas.paste(image, ((side - image.width) // 2, (side - image.height) // 2))
    return canvas


def clip_box(box, width: int, height: int, minimum: int) -> list[int] | None:
    if len(box) != 4 or not all(math.isfinite(float(x)) for x in box):
        return None
    x1, y1 = max(0, math.floor(box[0])), max(0, math.floor(box[1]))
    x2, y2 = min(width, math.ceil(box[2])), min(height, math.ceil(box[3]))
    if x2 - x1 < minimum or y2 - y1 < minimum:
        return None
    return [x1, y1, x2, y2]


def iou(a, b) -> float:
    area = max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]))
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - area
    return area / union if union else 0.0


def crop_regions(size: tuple[int, int], faces: list[dict], persons: list[dict], config) -> list[dict]:
    width, height = size
    result = [{"kind": "original", "method": "full_image", "bbox": [0, 0, width, height], "confidence": None}]
    bodies = []
    for detection in sorted(faces, key=lambda d: d["confidence"], reverse=True)[:config.max_faces]:
        x1, y1, x2, y2 = detection["bbox"]
        fw, fh = x2 - x1, y2 - y1
        if fw <= 0 or fh <= 0:
            continue
        p = config.face_padding
        face = clip_box([x1 - p * fw, y1 - p * fh, x2 + p * fw, y2 + p * fh], width, height, config.min_crop_size)
        if face:
            result.append({"kind": "face", "method": "yolov8_face", "bbox": face, "confidence": detection["confidence"]})
        cx = (x1 + x2) / 2
        body = clip_box([cx - 1.4 * fw, y1 - 0.25 * fh, cx + 1.4 * fw, y2 + 3 * fh], width, height, config.min_crop_size)
        if body:
            bodies.append({"kind": "upper_body", "method": "estimated_from_face", "bbox": body, "confidence": detection["confidence"]})
    for detection in sorted(persons, key=lambda d: d["confidence"], reverse=True):
        x1, y1, x2, y2 = detection["bbox"]
        body = clip_box([x1, y1, x2, y1 + 0.6 * (y2 - y1)], width, height, config.min_crop_size)
        if body and not any(iou(body, d["bbox"]) > 0.5 for d in bodies):
            bodies.append({"kind": "upper_body", "method": "estimated_from_person", "bbox": body, "confidence": detection["confidence"]})
    result.extend(bodies[:config.max_bodies])
    return result


def save_crop(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, suffix=".part")
    os.close(fd)
    try:
        image.save(temporary, format="JPEG", quality=95, subsampling=0)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
