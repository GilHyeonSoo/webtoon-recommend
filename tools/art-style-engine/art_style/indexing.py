from __future__ import annotations

from .config import Config, digest
from .storage import atomic_json, now, read_json


def fused_vectors(records: list[dict], config: Config):
    import numpy as np

    dino = np.asarray([r["pooled"]["dino"] for r in records], dtype=np.float32)
    tags = np.asarray([r["pooled"]["wd14_general"] for r in records], dtype=np.float32)
    if dino.ndim != 2 or tags.ndim != 2 or not dino.shape[1] or not tags.shape[1]:
        raise ValueError("Invalid pooled vector dimensions")
    if not np.isfinite(dino).all() or not np.isfinite(tags).all():
        raise ValueError("Pooled vectors contain NaN or infinity")
    dn = np.linalg.norm(dino, axis=1, keepdims=True)
    if np.any(dn < 1e-12):
        raise ValueError("A work has an empty DINOv2 vector")
    dino /= dn
    tags /= np.maximum(np.linalg.norm(tags, axis=1, keepdims=True), 1e-12)
    total = config.dino_weight + config.tag_weight
    matrix = np.concatenate([dino * (config.dino_weight / total) ** 0.5,
                             tags * (config.tag_weight / total) ** 0.5], axis=1)
    matrix /= np.maximum(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12)
    return matrix


def cluster_vectors(matrix, config: Config):
    import numpy as np

    n = len(matrix)
    labels, probabilities, coordinates = np.full(n, -1, dtype=int), np.zeros(n), None
    settings = {"requested_components": config.umap_components, "requested_neighbors": config.umap_neighbors,
                "min_cluster_size": config.min_cluster_size, "min_samples": config.min_samples,
                "seed": config.seed, "metric": "cosine"}
    if n < 3:
        return labels, probabilities, coordinates, {**settings, "state": "insufficient_samples"}
    if np.allclose(matrix, matrix[0], atol=1e-7):
        return labels, probabilities, coordinates, {**settings, "state": "insufficient_feature_variation"}
    import umap

    components = min(config.umap_components, max(2, n - 2))
    neighbors = min(config.umap_neighbors, n - 1)
    print(f"UMAP: {n} works, {matrix.shape[1]} -> {components} dimensions", flush=True)
    reducer = umap.UMAP(n_neighbors=neighbors, n_components=components, metric="cosine", min_dist=config.umap_min_dist,
                        random_state=config.seed, n_jobs=1, low_memory=True, init="random")
    coordinates = reducer.fit_transform(matrix)
    if not np.isfinite(coordinates).all():
        raise ValueError("UMAP produced non-finite coordinates")
    settings.update(effective_components=components, effective_neighbors=neighbors)
    if n < config.min_cluster_size:
        return labels, probabilities, coordinates, {**settings, "state": "insufficient_samples_for_hdbscan"}
    import hdbscan

    min_samples = min(config.min_samples, n - 1)
    model = hdbscan.HDBSCAN(min_cluster_size=config.min_cluster_size, min_samples=min_samples,
                           metric="euclidean", cluster_selection_method="eom", core_dist_n_jobs=config.cpu_threads)
    labels = model.fit_predict(coordinates)
    probabilities = np.nan_to_num(model.probabilities_, nan=0.0, posinf=0.0, neginf=0.0)
    return labels, probabilities, coordinates, {**settings, "effective_min_samples": min_samples, "state": "completed"}


def nearest(matrix, config: Config):
    import numpy as np
    from sklearn import config_context
    from sklearn.neighbors import NearestNeighbors

    n = len(matrix)
    if n == 1:
        return [[]]
    result = []
    # Query in blocks: never allocate an N x N JSON/distance matrix for 10,000 works.
    with config_context(working_memory=256):
        model = NearestNeighbors(n_neighbors=min(config.neighbors + 1, n), metric="cosine",
                                 algorithm="brute", n_jobs=config.cpu_threads).fit(matrix)
        for start in range(0, n, 128):
            distances, indices = model.kneighbors(matrix[start:start + 128])
            for offset, (ds, ids) in enumerate(zip(distances, indices)):
                result.append([(int(j), float(np.clip(1 - distance, -1, 1)))
                               for distance, j in zip(ds, ids) if j != start + offset][:config.neighbors])
    return result


def build_index(config: Config, works) -> dict:
    from .inputs import discover, snapshot
    from .pipeline import fingerprint

    output = config.path("output_dir")
    records, paths, excluded = [], [], []
    fresh = {work.key: work for work in discover(config.path("input_dir"))}
    for work in works:
        path = work.result_path(output)
        try:
            record = read_json(path)
        except FileNotFoundError:
            excluded.append({"key": work.key, "reason": "not_analyzed"})
            continue
        if record.get("status") not in {"complete", "partial"} or not record.get("pooled"):
            excluded.append({"key": work.key, "reason": record.get("status", "invalid")})
            continue
        # Changes made by the concurrent crawler must not reuse results for an older input snapshot.
        current = fresh.get(work.key)
        if current is None or fingerprint(snapshot(current, config.path("input_dir")), record["feature_signature"]) != record["fingerprint"]:
            excluded.append({"key": work.key, "reason": "input_changed_rerun_analyze"})
            continue
        if record.get("feature_digest") != digest(record["pooled"]):
            raise ValueError(f"Feature JSON integrity check failed: {path}")
        records.append(record)
        paths.append(path.relative_to(output).as_posix())
    if not records:
        raise ValueError("No analyzed works available for indexing. Run analyze first (or --skip-clustering for a crop-only failure report).")
    signatures = {r["feature_signature"] for r in records}
    if len(signatures) != 1:
        raise ValueError("Mixed model/feature configurations. Run analyze for the full dataset before clustering.")
    matrix = fused_vectors(records, config)
    labels, probabilities, coordinates, clustering = cluster_vectors(matrix, config)
    neighbors = nearest(matrix, config)
    revision_path = output / "features.json"
    revision = read_json(revision_path)["revision"] if revision_path.exists() else None
    items, groups = {}, {}
    for i, record in enumerate(records):
        key, label = record["key"], int(labels[i])
        items[key] = {"work_id": record["work_id"], "provider": record["provider"], "file": paths[i],
                      "feature_digest": record["feature_digest"], "status": record["status"],
                      "cluster": label, "membership_probability": round(float(probabilities[i]), 6),
                      "umap": coordinates[i].tolist() if coordinates is not None else None,
                      "neighbors": [{"key": records[j]["key"], "work_id": records[j]["work_id"],
                                     "cosine_similarity": round(score, 6)} for j, score in neighbors[i]]}
        groups.setdefault(str(label), []).append(key)
    summary = {"indexed_works": len(records), "partial_works": sum(r["status"] == "partial" for r in records),
               "excluded_works": len(excluded), "clusters": len(set(labels) - {-1}),
               "noise_works": int(sum(labels == -1))}
    document = {"schema_version": 1, "created_at": now(), "features_revision": revision,
                "feature_signature": records[0]["feature_signature"],
                "dataset_digest": digest([(r["key"], r["feature_digest"]) for r in records]),
                "fusion": {"dino_weight": config.dino_weight, "tag_weight": config.tag_weight,
                           "dimensions": matrix.shape[1], "tag_categories": [0]},
                "clustering": clustering, "summary": summary, "excluded": excluded, "items": items, "groups": groups}
    atomic_json(output / "index.json", document)
    print(f"Index: {summary}", flush=True)
    return summary


def similar(config: Config, work_id: str):
    output = config.path("output_dir")
    index = read_json(output / "index.json")
    revision_path = output / "features.json"
    revision = read_json(revision_path)["revision"] if revision_path.exists() else None
    if index["features_revision"] != revision:
        raise ValueError("Index is stale after feature changes. Run cluster (or analyze) first.")
    matches = [key for key, item in index["items"].items() if key == work_id or item["work_id"] == work_id]
    if len(matches) != 1:
        raise ValueError("Work ID not found or ambiguous. Use the full key, e.g. KAKAO/kakao_2695.")
    key = matches[0]
    return {"key": key, **index["items"][key]}
