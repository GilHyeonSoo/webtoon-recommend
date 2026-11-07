from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .storage import file_hash

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff"}


@dataclass(frozen=True)
class Work:
    key: str
    work_id: str
    provider: str | None
    files: tuple[Path, ...]

    def result_path(self, output: Path, stage: str = "works") -> Path:
        # Keep the provider component so identical IDs on different platforms never collide.
        return output / stage / (self.key + ".json")


def discover(root: Path) -> list[Work]:
    root = root.resolve()
    if not root.is_dir():
        raise ValueError(f"Image directory does not exist: {root}")
    works = []
    for dirname, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if not d.startswith(".") and not (Path(dirname) / d).is_symlink())
        folder = Path(dirname)
        files = tuple(sorted((folder / name for name in names
                              if not name.startswith(".") and Path(name).suffix.lower() in EXTENSIONS
                              and (folder / name).is_file() and not (folder / name).is_symlink()), key=lambda p: p.name))
        if not files:
            continue
        if folder == root:
            raise ValueError("Images must be inside a work-ID folder, not directly inside input_dir")
        rel = folder.relative_to(root)
        works.append(Work(rel.as_posix(), folder.name, rel.parts[0] if len(rel.parts) > 1 else None, files))
    return sorted(works, key=lambda w: w.key)


def snapshot(work: Work, root: Path) -> list[dict]:
    root = root.resolve()
    records = []
    for path in work.files:
        record = {"path": path.relative_to(root).as_posix()}
        try:
            record.update(sha256=file_hash(path), bytes=path.stat().st_size)
        except OSError as exc:
            record["error"] = str(exc)
        records.append(record)
    return records
