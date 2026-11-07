from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from art_style.config import Config, digest, load_config
from art_style.images import clip_box, crop_regions, open_rgb
from art_style.indexing import build_index, cluster_vectors, fused_vectors, nearest, similar
from art_style.inputs import discover, snapshot
from art_style.models import adaptive_batches
from art_style.pipeline import analyze, build_plan, fingerprint, pool_features
from art_style.storage import atomic_json, output_lock, read_json


class FakeRuntime:
    def __init__(self, config):
        self.info = {"device": "cpu", "precision": "fp32", "torch": "test"}

    def clear(self):
        pass


class FakeDetector:
    calls = 0

    def __init__(self, config, runtime):
        type(self).calls += 1

    def detect(self, image):
        return [], []

    def close(self):
        pass


class FakeExtractor:
    calls = 0
    general_indices = [0, 1]
    smallest_batch = {"dino": 32, "wd14": 32}

    def __init__(self, config, runtime):
        type(self).calls += 1

    def extract(self, images):
        data = np.asarray([np.asarray(im).mean(axis=(0, 1)) + 1 for im in images], dtype=np.float32)
        data /= np.linalg.norm(data, axis=1, keepdims=True)
        tags = np.asarray([[0.2, 0.8]] * len(images), dtype=np.float32)
        return data, tags

    def visible_tags(self, probabilities):
        return {"general": [{"name": "test", "score": float(probabilities[1])}], "character": [], "rating": []}

    def close(self):
        pass


class TempCase(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.input = self.root / "이미지"
        self.input.mkdir()
        self.config = Config(input_dir=str(self.input), output_dir=str(self.root / "결과"), model_dir=str(self.root / "모델"))

    def tearDown(self):
        self.temp.cleanup()

    def image(self, relative="NAVER/naver_1/01.png", color="red"):
        path = self.input / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (80, 100), color).save(path)
        return path


class DiscoveryTests(TempCase):
    def test_platform_and_direct_work_folders_and_ignore_parts(self):
        self.image("NAVER/same.id/01.png")
        self.image("KAKAO/same.id/01.png")
        self.image("직접작품/02.PNG")
        (self.input / "NAVER/same.id/02.jpg.part").write_bytes(b"not committed")
        works = discover(self.input)
        self.assertEqual(len(works), 3)
        self.assertEqual(sum(len(w.files) for w in works), 3)
        self.assertEqual(len({str(w.result_path(self.root)) for w in works}), 3)
        self.assertTrue(str(works[0].result_path(self.root)).endswith("same.id.json"))

    def test_loose_root_image_rejected(self):
        self.image("loose.png")
        with self.assertRaisesRegex(ValueError, "work-ID"):
            discover(self.input)

    def test_fingerprint_detects_same_size_rewrite(self):
        p = self.image()
        work = discover(self.input)[0]
        before = snapshot(work, self.input)
        stat = p.stat()
        data = bytearray(p.read_bytes())
        data[-1] ^= 1
        p.write_bytes(data)
        os.utime(p, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        after = snapshot(work, self.input)
        self.assertNotEqual(fingerprint(before, "x"), fingerprint(after, "x"))


class ConfigStorageTests(TempCase):
    def test_config_validation_and_windows_bom(self):
        for bad in ({"batch_size": True}, {"batch_size": 0}, {"tag_weight": float("nan")}, {"original_weight": 0}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                replace(self.config, **bad).validate()
        with self.assertRaisesRegex(ValueError, "overlap"):
            replace(self.config, output_dir=str(self.input / "results")).validate()
        p = self.root / "config.json"
        p.write_text(json.dumps({"batch_size": 16}), encoding="utf-8-sig")
        self.assertEqual(load_config(str(p), {}).batch_size, 16)

    def test_atomic_json_and_exclusive_lock_cleanup(self):
        p = self.root / "결과/test.json"
        atomic_json(p, {"작품": "테스트"})
        self.assertEqual(read_json(p), {"작품": "테스트"})
        with self.assertRaises(ValueError):
            atomic_json(p, {"bad": float("nan")})
        self.assertEqual(read_json(p), {"작품": "테스트"})
        with output_lock(p.parent):
            with self.assertRaisesRegex(RuntimeError, "locked"):
                with output_lock(p.parent):
                    pass
        self.assertFalse((p.parent / ".analysis.lock").exists())
        self.assertFalse(list(p.parent.glob("*.part")))


class ImagePoolingTests(TempCase):
    def test_transparent_image_is_composited_on_white(self):
        p = self.input / "rgba.png"
        image = Image.new("RGBA", (2, 2), (0, 0, 0, 0))
        image.putpixel((0, 0), (255, 0, 0, 255))
        image.save(p)
        actual = open_rgb(p)
        self.assertEqual(actual.getpixel((1, 1)), (255, 255, 255))
        self.assertEqual(actual.getpixel((0, 0)), (255, 0, 0))

    def test_crop_clamps_and_marks_body_estimates(self):
        regions = crop_regions((100, 120), [{"bbox": [0, 0, 40, 40], "confidence": 0.9}], [], self.config)
        self.assertEqual(regions[0]["kind"], "original")
        self.assertIn("estimated_from_face", [r["method"] for r in regions])
        for r in regions:
            self.assertTrue(0 <= r["bbox"][0] < r["bbox"][2] <= 100)
            self.assertTrue(0 <= r["bbox"][1] < r["bbox"][3] <= 120)
        self.assertIsNone(clip_box([0, float("nan"), 100, 100], 100, 100, 24))

    def test_original_fallback_and_duplicate_sources_and_corrupt_image(self):
        first = self.image()
        self.image("NAVER/naver_1/corrupt.jpg").write_bytes(b"corrupt")
        (first.parent / "duplicate.png").write_bytes(first.read_bytes())
        work = discover(self.input)[0]
        plan = build_plan(work, snapshot(work, self.input), "signature", self.config, FakeDetector(self.config, None))
        self.assertEqual(plan["status"], "partial")
        self.assertEqual(len(plan["samples"]), 1)
        self.assertEqual(plan["samples"][0]["kind"], "original")
        self.assertEqual(sum(r["status"] == "duplicate" for r in plan["images"]), 1)
        self.assertEqual(len(plan["errors"]), 1)

    def test_pool_kind_weights_do_not_depend_on_face_count(self):
        dino = np.array([[1, 0], [0, 1], [0, 1]], dtype=np.float32)
        tags = np.array([[1, 0], [0, 1], [0, 1]], dtype=np.float32)
        samples = [{"kind": k} for k in ("original", "face", "face")]
        result = pool_features(samples, dino, tags, self.config)
        expected = np.array([0.2, 0.5]) / np.linalg.norm([0.2, 0.5])
        np.testing.assert_allclose(result["dino"], expected, rtol=1e-6)
        np.testing.assert_allclose(result["wd14_general"], [2 / 7, 5 / 7], rtol=1e-6)


class AdaptiveBatchTests(unittest.TestCase):
    def test_oom_retries_same_items_in_order(self):
        class OOM(RuntimeError):
            pass

        class Cuda:
            OutOfMemoryError = OOM

        class Torch:
            cuda = Cuda

        class Runtime:
            torch, device = Torch, "cuda:0"
            clears = 0

            def clear(self):
                self.clears += 1

        runtime = Runtime()

        def operation(items):
            if len(items) > 2:
                raise OOM("CUDA out of memory")
            return [i * 2 for i in items]

        result, effective = adaptive_batches(list(range(9)), operation, 8, runtime, "test")
        self.assertEqual(result, [i * 2 for i in range(9)])
        self.assertEqual(effective, 2)
        self.assertEqual(runtime.clears, 2)
        with self.assertRaisesRegex(RuntimeError, "shape"):
            adaptive_batches([0], lambda items: (_ for _ in ()).throw(RuntimeError("shape error")), 4, runtime, "test")


class PipelineTests(TempCase):
    def run_fake(self, skip_clustering=True, force=False):
        with patch("art_style.models.verify_models", return_value=({"sources": {"test": "fixture"}}, "test-model")), \
             patch("art_style.models.labels", return_value=[{"name": "a", "category": 0}, {"name": "b", "category": 0}]), \
             patch("art_style.models.Runtime", FakeRuntime), patch("art_style.models.Detector", FakeDetector), \
             patch("art_style.models.Extractor", FakeExtractor):
            return analyze(self.config, discover(self.input), force, skip_clustering)

    def test_resume_reuses_features_and_new_source_invalidates_index(self):
        self.image()
        self.image("KAKAO/kakao_2/01.png", "blue")
        first = self.run_fake(skip_clustering=False)
        self.assertEqual(first["analyzed"], 2)
        self.assertEqual(first["index"]["indexed_works"], 2)
        self.assertEqual(first["index"]["clusters"], 0)
        self.assertEqual(first["index"]["noise_works"], 2)
        lookup = similar(self.config, "naver_1")
        self.assertEqual(lookup["neighbors"][0]["work_id"], "kakao_2")
        calls = (FakeDetector.calls, FakeExtractor.calls)
        second = self.run_fake()
        self.assertEqual(second["reused"], 2)
        self.assertEqual((FakeDetector.calls, FakeExtractor.calls), calls)
        self.image("NAVER/naver_1/new.png", "green")
        third = self.run_fake()
        self.assertEqual(third["analyzed"], 1)
        self.assertEqual(third["reused"], 1)
        with self.assertRaisesRegex(ValueError, "stale"):
            similar(self.config, "naver_1")
        work = [w for w in discover(self.input) if w.work_id == "naver_1"][0]
        result = read_json(work.result_path(self.config.path("output_dir")))
        self.assertEqual(result["feature_digest"], digest(result["pooled"]))
        self.assertEqual(len(result["sources"]), 2)

    def test_interruption_records_failure_and_reuses_crop_plan(self):
        self.image()
        with patch.object(FakeExtractor, "extract", side_effect=RuntimeError("inference failed")):
            with self.assertRaisesRegex(RuntimeError, "inference failed"):
                self.run_fake()
        self.assertEqual(read_json(self.config.path("output_dir") / "run.json")["state"], "failed")
        calls = FakeDetector.calls
        result = self.run_fake()
        self.assertEqual(result["analyzed"], 1)
        self.assertEqual(FakeDetector.calls, calls)

    def test_corrupt_source_is_partial_and_is_retried(self):
        self.image()
        bad = self.input / "NAVER/naver_1/bad.jpg"
        bad.write_bytes(b"not an image")
        result = self.run_fake()
        self.assertEqual(result["state"], "completed_with_errors")
        self.assertEqual(result["partial"], 1)
        Image.new("RGB", (80, 100), "blue").save(bad)
        result = self.run_fake()
        self.assertEqual(result["analyzed"], 1)
        self.assertEqual(result["state"], "completed")

    def test_new_file_during_run_excludes_older_features_from_index(self):
        self.image()
        self.image("KAKAO/kakao_2/01.png", "blue")
        selected = discover(self.input)
        self.run_fake()
        self.image("NAVER/naver_1/new.png", "green")
        summary = build_index(self.config, selected)
        self.assertEqual(summary["indexed_works"], 1)
        self.assertEqual(summary["excluded_works"], 1)
        index = read_json(self.config.path("output_dir") / "index.json")
        self.assertEqual(index["excluded"][0]["reason"], "input_changed_rerun_analyze")

    def test_corrupt_feature_cache_is_recomputed_from_saved_crops(self):
        self.image()
        self.run_fake()
        work = discover(self.input)[0]
        path = work.result_path(self.config.path("output_dir"))
        result = read_json(path)
        result["pooled"]["dino"][0] = 999
        atomic_json(path, result)
        before = FakeDetector.calls
        summary = self.run_fake()
        self.assertEqual(summary["analyzed"], 1)
        self.assertEqual(FakeDetector.calls, before)


class ClusteringTests(unittest.TestCase):
    def test_small_input_and_zero_tag_vector(self):
        config = Config()
        records = [{"pooled": {"dino": [1, 0], "wd14_general": [0, 0]}}]
        matrix = fused_vectors(records, config)
        self.assertTrue(np.isfinite(matrix).all())
        self.assertAlmostEqual(float(np.linalg.norm(matrix)), 1.0)
        labels, probs, coords, meta = cluster_vectors(matrix, config)
        self.assertEqual(meta["state"], "insufficient_samples")
        self.assertIsNone(coords)
        self.assertEqual(labels.tolist(), [-1])
        self.assertEqual(nearest(matrix, config), [[]])

    def test_real_umap_hdbscan_separated_groups_and_neighbors(self):
        rng = np.random.default_rng(42)
        centers = np.eye(3, 12, dtype=np.float32)
        matrix = np.concatenate([center + rng.normal(0, 0.02, (25, 12)) for center in centers]).astype(np.float32)
        matrix /= np.linalg.norm(matrix, axis=1, keepdims=True)
        config = Config(umap_neighbors=10, min_cluster_size=8, min_samples=3, neighbors=3)
        labels, probabilities, coordinates, meta = cluster_vectors(matrix, config)
        self.assertEqual(meta["state"], "completed")
        self.assertEqual(coordinates.shape, (75, 10))
        self.assertGreaterEqual(len(set(labels) - {-1}), 3)
        self.assertTrue(np.isfinite(probabilities).all())
        neighbors = nearest(matrix, config)
        self.assertTrue(all(i != j for i, row in enumerate(neighbors) for j, _ in row))
        self.assertTrue(all(i // 25 == j // 25 for i, row in enumerate(neighbors) for j, _ in row))


if __name__ == "__main__":
    unittest.main()
