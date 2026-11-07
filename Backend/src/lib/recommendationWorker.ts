import { parentPort, workerData } from 'node:worker_threads';
import { createRecommendationIndex } from './similarity.js';
import { loadArtStyle, type ArtStyleIndex } from './artStyle.js';
import type { WebtoonDto } from './mapWebtoon.js';
import type { RecommendationPreferences } from './preferences.js';

const catalog = workerData as WebtoonDto[];
const byId = new Map(catalog.map((item) => [item.id, item]));
let art: ArtStyleIndex | undefined;
try {
  art = loadArtStyle();
} catch (error) {
  // A bad art export must not take recommendations down; fall back to text-only signals.
  console.error('Art-style data ignored:', (error as Error).message);
}
const recommend = createRecommendationIndex(catalog, art);
parentPort!.on('message', (task: { id: number; ids: string[]; limit: number; preferences?: RecommendationPreferences; excludeIds: string[]; cancel: SharedArrayBuffer }) => {
  try {
    const selected = task.ids.map((id) => byId.get(id)!);
    if (selected.some((item) => !item)) throw new Error('Unknown selection');
    const flag = new Int32Array(task.cancel);
    parentPort!.postMessage({ id: task.id, result: recommend(selected, task.limit, task.preferences, task.excludeIds, () => Atomics.load(flag, 0) !== 0) });
  } catch { parentPort!.postMessage({ id: task.id, error: true }); }
});
parentPort!.postMessage({ ready: true });
