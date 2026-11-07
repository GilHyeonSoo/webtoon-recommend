#!/usr/bin/env python3
"""Export a compact art-style embedding per catalog work for the recommendation backend.

Reads the art engine's results (index.json + works/*.json), rebuilds the same fused
DINOv2 + WD-14 vector the engine clusters on, reduces it with an uncentered truncated
SVD (preserves the engine's cosine neighbours better than mean-centred PCA), and writes
Backend/data/art-style.json keyed by catalog ID. Run with the art engine venv:

  <venv>\\Scripts\\python.exe scripts\\export-art-style.py [--results DIR] [--dims 128]

The file also stores a calibration: `baseline` (median similarity of random pairs) and
`similarThreshold` (99th percentile of random-pair similarity). The backend maps a
cosine to (cos - baseline) / (1 - baseline) and labels pairs above the threshold.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "art-style-engine"))

from art_style.indexing import fused_vectors  # noqa: E402  (same fusion as clustering)


def default_results() -> Path:
    env = os.environ.get("ART_OUTPUT_DIR")
    return Path(env) if env else ROOT / "작화분석결과"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--results", type=Path, default=default_results(), help="Art engine output folder")
    p.add_argument("--catalog", type=Path, default=ROOT / "Backend" / "data" / "webtoons.json")
    p.add_argument("--out", type=Path, default=ROOT / "Backend" / "data" / "art-style.json")
    p.add_argument("--dims", type=int, default=128, help="SVD dimensions (8-256)")
    args = p.parse_args()
    if not 8 <= args.dims <= 256:
        raise SystemExit("--dims must be in [8, 256]")

    import numpy as np
    from sklearn.decomposition import TruncatedSVD

    results = args.results.resolve()
    index = json.loads((results / "index.json").read_text(encoding="utf-8"))
    features = json.loads((results / "features.json").read_text(encoding="utf-8"))
    if index.get("features_revision") != features.get("revision"):
        raise SystemExit("index.json is stale (features changed after clustering). Run the `cluster` command first.")

    catalog = json.loads(args.catalog.read_text(encoding="utf-8-sig"))
    catalog_ids = {item["id"] for item in catalog}

    by_id: dict[str, dict] = {}
    for key, item in index["items"].items():
        work_id = item["work_id"]
        if work_id in by_id:
            raise SystemExit(f"Duplicate work_id across providers: {work_id}")
        by_id[work_id] = {"key": key, **item}

    ids = sorted(catalog_ids & by_id.keys())
    missing = sorted(catalog_ids - by_id.keys())
    if not ids:
        raise SystemExit("No catalog IDs found in the art index")

    records = []
    for work_id in ids:
        record = json.loads((results / by_id[work_id]["file"]).read_text(encoding="utf-8"))
        if record.get("feature_signature") != index["feature_signature"]:
            raise SystemExit(f"{work_id}: feature signature differs from index.json")
        records.append(record)

    fusion = SimpleNamespace(dino_weight=index["fusion"]["dino_weight"], tag_weight=index["fusion"]["tag_weight"])
    full = fused_vectors(records, fusion)  # (n, 8490), L2-normalized

    dims = min(args.dims, len(ids) - 1, full.shape[1])
    svd = TruncatedSVD(n_components=dims, random_state=42)
    reduced = svd.fit_transform(full)
    reduced /= np.maximum(np.linalg.norm(reduced, axis=1, keepdims=True), 1e-12)

    # Fidelity: how many of each work's top-10 neighbours (original space) survive the reduction.
    rng = np.random.default_rng(42)
    sample = rng.choice(len(ids), size=min(500, len(ids)), replace=False)
    full_sim = full[sample] @ full.T
    red_sim = reduced[sample] @ reduced.T
    for row, i in enumerate(sample):
        full_sim[row, i] = red_sim[row, i] = -np.inf
    k = 10
    top_full = np.argpartition(-full_sim, k, axis=1)[:, :k]
    top_red = np.argpartition(-red_sim, k, axis=1)[:, :k]
    recall = float(np.mean([len(set(a) & set(b)) / k for a, b in zip(top_full, top_red)]))

    # Similarity scale in the exported space: neighbours vs random pairs, used to calibrate backend reasons.
    neighbour_sims = np.take_along_axis(red_sim, top_red, axis=1).ravel()
    random_pairs = rng.integers(0, len(ids), size=(20000, 2))
    random_pairs = random_pairs[random_pairs[:, 0] != random_pairs[:, 1]]
    random_sims = np.einsum("ij,ij->i", reduced[random_pairs[:, 0]], reduced[random_pairs[:, 1]])
    baseline = float(np.percentile(random_sims, 50))
    # Only label pairs closer than 99% of random pairs; neighbour percentiles overlap random ones too much.
    similar_threshold = float(np.percentile(random_sims, 99))
    if not baseline < similar_threshold < 1:
        raise SystemExit(f"Unexpected similarity scale: baseline={baseline:.3f}, threshold={similar_threshold:.3f}")

    out = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": {
            "featureSignature": index["feature_signature"],
            "featuresRevision": index["features_revision"],
            "fusion": index["fusion"],
        },
        "dimensions": dims,
        "calibration": {"baseline": round(baseline, 4), "similarThreshold": round(similar_threshold, 4)},
        "items": {
            work_id: {
                "v": [round(float(x), 4) for x in reduced[i]],
                "cluster": int(by_id[work_id]["cluster"]),
            }
            for i, work_id in enumerate(ids)
        },
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    tmp = args.out.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(args.out)

    pct = lambda a, q: round(float(np.percentile(a, q)), 3)  # noqa: E731
    print(json.dumps({
        "written": str(args.out), "bytes": args.out.stat().st_size,
        "works": len(ids), "catalog_missing_art": len(missing), "missing_sample": missing[:5],
        "dimensions": dims, "explained_variance": round(float(svd.explained_variance_ratio_.sum()), 3),
        "top10_neighbour_recall": round(recall, 3),
        "neighbour_similarity_p10_p50_p90": [pct(neighbour_sims, q) for q in (10, 50, 90)],
        "random_similarity_p50_p90_p99": [pct(random_sims, q) for q in (50, 90, 99)],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
