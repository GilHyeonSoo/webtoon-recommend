from __future__ import annotations

import json
import uuid
from dataclasses import asdict
from pathlib import Path

from .config import Config, digest
from .inputs import Work, snapshot
from .storage import atomic_json, file_hash, now, read_json

FEATURE_VERSION = 1


def cached_json(path: Path) -> dict | None:
    try:
        return read_json(path)
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def fingerprint(sources: list[dict], signature: str) -> str:
    return digest({"sources": sources, "feature_signature": signature})


def reusable_result(result: dict | None, expected: str, output: Path) -> bool:
    if not result or result.get("fingerprint") != expected or result.get("status") != "complete" or not result.get("pooled"):
        return False
    try:
        return (result["feature_digest"] == digest(result["pooled"]) and bool(result["samples"])
                and all((output / s["crop"]).is_file() for s in result["samples"]))
    except (KeyError, TypeError, ValueError):
        return False


def build_plan(work: Work, sources: list[dict], signature: str, config: Config, detector) -> dict:
    from .images import crop_regions, open_rgb, save_crop

    output, root = config.path("output_dir"), config.path("input_dir")
    plan = {"schema_version": 1, "key": work.key, "work_id": work.work_id, "provider": work.provider,
            "fingerprint": fingerprint(sources, signature), "feature_signature": signature,
            "sources": sources, "images": [], "samples": [], "errors": []}
    seen = {}
    for source in sources:
        record = {"source": source["path"], "sha256": source.get("sha256")}
        plan["images"].append(record)
        if "error" in source:
            record.update(status="failed", error=source["error"])
            plan["errors"].append({"source": source["path"], "error": source["error"]})
            continue
        if source["sha256"] in seen:
            record.update(status="duplicate", duplicate_of=seen[source["sha256"]])
            continue
        try:
            image = open_rgb(root / source["path"], source["sha256"])
        except (OSError, ValueError) as exc:
            record.update(status="failed", error=str(exc))
            plan["errors"].append({"source": source["path"], "error": str(exc)})
            continue
        # Model/runtime failures must stop the run, rather than masquerading as "no face".
        faces, persons = detector.detect(image)
        regions = crop_regions(image.size, faces, persons, config)
        record.update(status="ready", width=image.width, height=image.height,
                      face_count=len(faces), person_count=len(persons), samples=[])
        new_samples = []
        for i, region in enumerate(regions):
            sample_id = f"{source['sha256'][:24]}-{i:02d}-{region['kind']}"
            # Include the feature signature so reconfigured crops never overwrite an older run's files.
            rel = Path("crops") / work.key / signature[:12] / f"{sample_id}.jpg"
            save_crop(image.crop(region["bbox"]), output / rel)
            sample = {"id": sample_id, "source": source["path"], **region,
                      "crop": rel.as_posix(), "crop_sha256": file_hash(output / rel)}
            new_samples.append(sample)
            record["samples"].append(sample_id)
        plan["samples"].extend(new_samples)
        seen[source["sha256"]] = source["path"]
    plan["status"] = "complete" if not plan["errors"] else "partial" if plan["samples"] else "failed"
    atomic_json(work.result_path(output, "plans"), plan)
    return plan


def reusable_plan(plan: dict | None, expected: str, output: Path) -> bool:
    if not plan or plan.get("fingerprint") != expected or plan.get("status") != "complete":
        return False
    try:
        return bool(plan["samples"]) and all(file_hash(output / s["crop"]) == s["crop_sha256"] for s in plan["samples"])
    except (OSError, KeyError, TypeError):
        return False


def pool_features(samples: list[dict], dino, general, config: Config):
    import numpy as np

    weights = {"original": config.original_weight, "face": config.face_weight, "upper_body": config.upper_body_weight}
    groups, dino_sum, tag_sum, total = {}, np.zeros(dino.shape[1], dtype=np.float32), np.zeros(general.shape[1], dtype=np.float32), 0.0
    for kind, weight in weights.items():
        indices = [i for i, sample in enumerate(samples) if sample["kind"] == kind]
        if not indices or weight == 0:
            continue
        # Average within a kind first. A crowded cover must not gain extra weight just by having more faces.
        d = dino[indices].mean(axis=0)
        d /= max(float(np.linalg.norm(d)), 1e-12)
        t = general[indices].mean(axis=0)
        dino_sum += weight * d
        tag_sum += weight * t
        total += weight
        groups[kind] = {"samples": len(indices), "weight": weight}
    if total <= 0:
        raise ValueError("No usable weighted samples")
    norm = float(np.linalg.norm(dino_sum))
    if norm <= 1e-12:
        raise ValueError("Empty pooled DINOv2 vector")
    dino_sum /= norm
    tag_sum /= total
    for group in groups.values():
        group["effective_weight"] = group["weight"] / total
    return {"dino": dino_sum.tolist(), "wd14_general": tag_sum.tolist(), "groups": groups}


def finish_work(plan: dict, dino, probabilities, extractor, config: Config, runtime_info: dict) -> dict:
    samples = [{**sample, "dino": dino[i].tolist(), "tags": extractor.visible_tags(probabilities[i])}
               for i, sample in enumerate(plan["samples"])]
    pooled = pool_features(samples, dino, probabilities[:, extractor.general_indices], config)
    return {**plan, "analyzed_at": now(), "runtime": runtime_info, "samples": samples,
            "pooled": pooled, "feature_digest": digest(pooled)}


def analyze(config: Config, works: list[Work], force: bool = False, skip_clustering: bool = False):
    from .images import open_rgb
    from .models import Detector, Extractor, Runtime, labels, verify_models

    output = config.path("output_dir")
    manifest, model_signature = verify_models(config.path("model_dir"))
    runtime = Runtime(config)
    signature = digest({"feature_version": FEATURE_VERSION, "models": model_signature,
                        "config": config.feature_options(), "precision": runtime.info["precision"]})
    label_data = labels(config.path("model_dir"))
    vocabulary = {"schema_version": 1, "model_signature": model_signature,
                  "general": [label["name"] for label in label_data if label["category"] == 0]}
    vocabulary_path = f"vocabularies/{model_signature}.json"
    run = {"schema_version": 1, "run_id": uuid.uuid4().hex, "started_at": now(), "state": "running",
           "config": asdict(config), "runtime": runtime.info, "feature_signature": signature,
           "models": manifest["sources"], "selected_works": len(works), "reused": 0,
           "analyzed": 0, "partial": 0, "failed": 0, "images": sum(len(w.files) for w in works)}

    def save_run():
        run["updated_at"] = now()
        atomic_json(output / "run.json", run)

    detector = extractor = None
    try:
        save_run()
        pending = []
        for work in works:
            sources = snapshot(work, config.path("input_dir"))
            fp = fingerprint(sources, signature)
            existing = cached_json(work.result_path(output))
            if not force and reusable_result(existing, fp, output):
                run["reused"] += 1
            else:
                pending.append((work, sources, fp))
        if pending:
            # Invalidate the old index before changing a single work; interrupted runs cannot serve stale neighbors.
            atomic_json(output / "features.json", {"revision": uuid.uuid4().hex, "updated_at": now()})
        atomic_json(output / "vocabulary.json", vocabulary)
        atomic_json(output / vocabulary_path, vocabulary)
        print(f"Works: {len(works)}; reuse: {run['reused']}; pending: {len(pending)}; {runtime.info}", flush=True)
        plans = []
        for number, (work, sources, fp) in enumerate(pending, 1):
            plan = cached_json(work.result_path(output, "plans")) if not force else None
            if not reusable_plan(plan, fp, output):
                if detector is None:
                    detector = Detector(config, runtime)
                plan = build_plan(work, sources, signature, config, detector)
            plan["vocabulary"] = vocabulary_path
            plans.append((work, plan))
            print(f"Crop {number}/{len(pending)}: {work.key} ({len(plan['samples'])} views, {plan['status']})", flush=True)
        if detector:
            detector.close()
            detector = None
        valid = [(work, plan) for work, plan in plans if plan["samples"]]
        for work, plan in plans:
            if not plan["samples"]:
                atomic_json(work.result_path(output), {**plan, "analyzed_at": now(), "pooled": None})
                run["failed"] += 1
        if valid:
            extractor = Extractor(config, runtime)
            for start in range(0, len(valid), config.work_window):
                window = valid[start:start + config.work_window]
                samples = [sample for _, plan in window for sample in plan["samples"]]
                images = [open_rgb(output / sample["crop"], sample["crop_sha256"]) for sample in samples]
                dino, probabilities = extractor.extract(images)
                offset = 0
                for work, plan in window:
                    count = len(plan["samples"])
                    result = finish_work(plan, dino[offset:offset + count], probabilities[offset:offset + count], extractor, config, runtime.info)
                    atomic_json(work.result_path(output), result)
                    offset += count
                    run["analyzed"] += 1
                    if result["status"] == "partial":
                        run["partial"] += 1
                    print(f"Analyze {run['analyzed']}/{len(valid)}: {work.key}", flush=True)
                run["effective_batch_size"] = extractor.smallest_batch
                save_run()
                del images, dino, probabilities
            extractor.close()
            extractor = None
        if not skip_clustering:
            from .indexing import build_index
            run["index"] = build_index(config, works)
        index_errors = run.get("index", {}).get("excluded_works", 0)
        run["state"] = "completed_with_errors" if run["partial"] or run["failed"] or index_errors else "completed"
        save_run()
        return run
    except BaseException as exc:
        run["state"] = "cancelled" if isinstance(exc, KeyboardInterrupt) else "failed"
        run["error"] = str(exc) or type(exc).__name__
        save_run()
        raise
    finally:
        if detector:
            detector.close()
        if extractor:
            extractor.close()
