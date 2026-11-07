import { readFileSync } from 'node:fs';

/**
 * Art-style embeddings exported by scripts/export-art-style.py from the local art engine.
 * Vectors are unit length; cosine is a plain dot product.
 */
export type ArtStyleIndex = {
  dimensions: number;
  /** Median cosine of random pairs: maps to art score 0. */
  baseline: number;
  /** Cosine above which two works are labelled as having a similar art style. */
  similarThreshold: number;
  vectors: Map<string, Float32Array>;
};

// Works from both src/lib (development) and dist/lib (built server).
export const artStyleFile = new URL('../../data/art-style.json', import.meta.url);

const MAX_ITEMS = 50_000;

export function parseArtStyle(data: unknown): ArtStyleIndex {
  const fail = (reason: string): never => { throw new Error(`Invalid art-style data: ${reason}`); };
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('not an object');
  const root = data as Record<string, unknown>;
  if (root.schemaVersion !== 1) fail('unsupported schemaVersion');
  const dimensions = root.dimensions;
  if (typeof dimensions !== 'number' || !Number.isInteger(dimensions) || dimensions < 2 || dimensions > 1024) return fail('dimensions');
  const calibration = root.calibration as Record<string, unknown> | undefined;
  const baseline = calibration?.baseline;
  const similarThreshold = calibration?.similarThreshold;
  if (typeof baseline !== 'number' || typeof similarThreshold !== 'number' || !Number.isFinite(baseline) || !Number.isFinite(similarThreshold)
    || baseline < -1 || !(baseline < similarThreshold) || similarThreshold >= 1) return fail('calibration');
  const items = root.items;
  if (!items || typeof items !== 'object' || Array.isArray(items)) return fail('items');
  const entries = Object.entries(items as Record<string, unknown>);
  if (entries.length > MAX_ITEMS) fail('too many items');

  const vectors = new Map<string, Float32Array>();
  for (const [id, entry] of entries) {
    if (!id || id.length > 200) fail('item id');
    const raw = (entry as { v?: unknown } | null)?.v;
    if (!Array.isArray(raw) || raw.length !== dimensions) fail(`vector length for ${id}`);
    const vector = new Float32Array(dimensions);
    let norm = 0;
    for (let i = 0; i < dimensions; i++) {
      const value = (raw as unknown[])[i];
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(`vector value for ${id}`);
      vector[i] = value as number;
      norm += (value as number) ** 2;
    }
    if (norm < 1e-12) fail(`zero vector for ${id}`);
    // Re-normalise: the export rounds to 4 decimals.
    const scale = 1 / Math.sqrt(norm);
    for (let i = 0; i < dimensions; i++) vector[i] *= scale;
    vectors.set(id, vector);
  }
  return { dimensions, baseline, similarThreshold, vectors };
}

/** Returns undefined when the file is absent, so recommendations fall back to text-only signals. */
export function loadArtStyle(file: URL = artStyleFile): ArtStyleIndex | undefined {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return parseArtStyle(JSON.parse(text));
}

export function dot(a: Float32Array, b: Float32Array) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** Maps a raw cosine to [0, 1]: 0 at the random-pair median, 1 for identical style. */
export const artScore = (art: ArtStyleIndex, cosine: number) =>
  Math.min(1, Math.max(0, (cosine - art.baseline) / (1 - art.baseline)));

export type ArtMatch = { score: number; similar: boolean };

/**
 * Scores a candidate against each selected work separately and averages, so every pick counts
 * equally (averaging vectors first would blur distinct styles into a generic one).
 * Returns undefined when the candidate or none of the seeds has art data.
 */
export function matchArt(art: ArtStyleIndex, seeds: readonly Float32Array[], candidateId: string): ArtMatch | undefined {
  const candidate = art.vectors.get(candidateId);
  if (!candidate || !seeds.length) return undefined;
  let total = 0;
  let similar = false;
  for (const seed of seeds) {
    const cosine = dot(seed, candidate);
    total += artScore(art, cosine);
    if (cosine >= art.similarThreshold) similar = true;
  }
  return { score: total / seeds.length, similar };
}
