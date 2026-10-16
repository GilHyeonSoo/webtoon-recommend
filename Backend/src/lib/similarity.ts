import type { RecommendationPreferences } from './preferences.js';
import { passesPreferenceFilters, preferenceReasons } from './preferences.js';
import { tasteTraitsInText } from './tasteVocabulary.js';
import type { WebtoonDto } from './mapWebtoon.js';

const genreNames: Record<string, string> = {
  pure: '로맨스', romance: '로맨스', action: '액션', daily: '일상', thrill: '스릴러', thriller: '스릴러',
  drama: '드라마', fantasy: '판타지', comic: '개그', comedy: '개그', sports: '스포츠', historical: '시대극',
  sensibility: '감성', horror: '공포', school: '학원', martial: '무협', mystery: '미스터리',
};
export const normalizeText = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ko').replace(/[^\p{L}\p{N}]/gu, '');
export const genreLabel = (value: string) => genreNames[value.toLowerCase()] ?? value;
const genreVocabulary = [...new Set(Object.values(genreNames))];

const CHANNEL_WEIGHTS = {
  genre: 0.38,
  tag: 0.30,
  synopsis: 0.17,
  title: 0.10,
  author: 0.05,
} as const;

const genres = (item: WebtoonDto) => [...new Set([
  ...item.genres, ...(item.primaryGenre && item.primaryGenre !== 'unknown' ? [item.primaryGenre] : []),
  ...genreVocabulary.filter((genre) => item.tags.some((tag) => normalizeText(tag).includes(genre))),
].map(genreLabel).map(normalizeText).filter(Boolean))];

const tags = (item: WebtoonDto) => {
  const result = new Set<string>();
  for (const raw of item.tags) {
    const normalized = normalizeText(raw);
    if (normalized) result.add(normalized);
    for (const trait of tasteTraitsInText(raw)) result.add(`trait:${trait}`);
  }
  for (const trait of tasteTraitsInText(item.synopsis ?? '')) result.add(`trait:${trait}`);
  return [...result];
};

type Vector = Map<string, number>;
type ChannelVectors = Record<keyof typeof CHANNEL_WEIGHTS, Vector>;

function synopsisTokens(synopsis: string | null): string[] {
  return (synopsis ?? '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

function featureGenre(item: WebtoonDto): Vector {
  const result: Vector = new Map();
  for (const genre of genres(item)) result.set(`g:${genre}`, 3);
  return result;
}

function featureTag(item: WebtoonDto): Vector {
  const result: Vector = new Map();
  for (const tag of tags(item)) result.set(`t:${tag}`, 2);
  return result;
}

function featureSynopsis(item: WebtoonDto): Vector {
  const result: Vector = new Map();
  for (const word of synopsisTokens(item.synopsis)) {
    result.set(`u:${word}`, Math.min(2, (result.get(`u:${word}`) ?? 0) + 1));
    for (let i = 0; i < word.length - 1; i++) {
      const key = `s:${word.slice(i, i + 2)}`;
      result.set(key, Math.min(1.2, (result.get(key) ?? 0) + 0.6));
    }
  }
  return result;
}

function featureTitle(item: WebtoonDto): Vector {
  const result: Vector = new Map();
  for (const word of synopsisTokens(item.title)) {
    result.set(`w:${word}`, Math.min(2.5, (result.get(`w:${word}`) ?? 0) + 1.2));
  }
  return result;
}

function featureAuthor(item: WebtoonDto): Vector {
  const result: Vector = new Map();
  for (const author of item.authors) {
    const key = normalizeText(author);
    if (key) result.set(`a:${key}`, 3);
  }
  return result;
}

function channelFeatures(item: WebtoonDto): ChannelVectors {
  return {
    genre: featureGenre(item),
    tag: featureTag(item),
    synopsis: featureSynopsis(item),
    title: featureTitle(item),
    author: featureAuthor(item),
  };
}

function unit(vector: Vector): Vector {
  const length = Math.hypot(...vector.values());
  return length ? new Map([...vector].map(([key, value]) => [key, value / length])) : new Map();
}

function applyIdf(raw: Vector[], catalogLength: number): Vector[] {
  const frequencies = new Map<string, number>();
  for (const vector of raw) for (const key of vector.keys()) frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  return raw.map((vector) => unit(new Map([...vector].map(([key, value]) => [
    key,
    value * (Math.log((catalogLength + 1) / ((frequencies.get(key) ?? 0) + 1)) + 1),
  ]))));
}

function cosine(a: Vector, b: Vector) {
  let score = 0;
  for (const [key, value] of a) score += value * (b.get(key) ?? 0);
  return Math.min(1, Math.max(0, score));
}

function buildProfile(selected: WebtoonDto[], vectors: Map<string, ChannelVectors>, channel: keyof typeof CHANNEL_WEIGHTS): Vector {
  const profile: Vector = new Map();
  for (const item of selected) {
    const vector = vectors.get(item.id)?.[channel] ?? new Map();
    for (const [key, value] of vector) profile.set(key, (profile.get(key) ?? 0) + value / selected.length);
  }
  return unit(profile);
}

function fusedSimilarity(
  profiles: Record<keyof typeof CHANNEL_WEIGHTS, Vector>,
  candidate: ChannelVectors,
): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const [channel, weight] of Object.entries(CHANNEL_WEIGHTS) as [keyof typeof CHANNEL_WEIGHTS, number][]) {
    const profile = profiles[channel];
    if (!profile.size || !candidate[channel].size) continue;
    weighted += weight * cosine(profile, candidate[channel]);
    totalWeight += weight;
  }
  return totalWeight ? Math.min(1, weighted / totalWeight) : 0;
}

export type SimilarRecommendation = { webtoon: WebtoonDto; similarity: number; reasons: string[] };

export function createRecommendationIndex(catalog: WebtoonDto[]) {
  const rawChannels = catalog.map(channelFeatures);
  const channelKeys = Object.keys(CHANNEL_WEIGHTS) as (keyof typeof CHANNEL_WEIGHTS)[];
  const vectors = new Map<string, ChannelVectors>();
  for (const channel of channelKeys) {
    const channelRaw = rawChannels.map((channels) => channels[channel]);
    const weighted = applyIdf(channelRaw, catalog.length);
    catalog.forEach((item, i) => {
      const existing = vectors.get(item.id) ?? {
        genre: new Map(), tag: new Map(), synopsis: new Map(), title: new Map(), author: new Map(),
      };
      existing[channel] = weighted[i];
      vectors.set(item.id, existing);
    });
  }

  const metadata = new Map(catalog.map((item) => [item.id, { genres: genres(item), tags: tags(item) }]));
  return (selected: WebtoonDto[], limit = 10, preferences?: RecommendationPreferences, excludeIds: readonly string[] = [], shouldAbort: () => boolean = () => false): SimilarRecommendation[] => {
  if (shouldAbort()) throw new Error('Recommendation canceled');
  const profiles = Object.fromEntries(channelKeys.map((channel) => [channel, buildProfile(selected, vectors, channel)])) as Record<keyof typeof CHANNEL_WEIGHTS, Vector>;
  const selectedIds = new Set(selected.map((item) => item.id));
  const excludedIds = new Set(excludeIds);
  const selectedGenres = new Set(selected.flatMap((item) => metadata.get(item.id)!.genres));
  const selectedTags = new Set(selected.flatMap((item) => metadata.get(item.id)!.tags));

  return catalog.filter((item) => !selectedIds.has(item.id) && !excludedIds.has(item.id) && passesPreferenceFilters(item, preferences)).map((webtoon) => {
    if (shouldAbort()) throw new Error('Recommendation canceled');
    const candidate = vectors.get(webtoon.id)!;
    const reasons: string[] = [];
    const sharedGenres = metadata.get(webtoon.id)!.genres.filter((value) => selectedGenres.has(value));
    const sharedTags = metadata.get(webtoon.id)!.tags.filter((value) => selectedTags.has(value) && !value.startsWith('trait:'));
    if (sharedGenres.length) reasons.push(`${sharedGenres.slice(0, 2).join(' · ')} 장르가 닮았어요`);
    if (sharedTags.length) reasons.push(`${sharedTags.slice(0, 2).join(' · ')} 취향이 겹쳐요`);
    const profileSynopsis = profiles.synopsis;
    if ([...candidate.synopsis.keys()].some((key) => profileSynopsis.has(key))) reasons.push('줄거리에 비슷한 표현이 있어요');
    const baseSimilarity = fusedSimilarity(profiles, candidate);
    if (!baseSimilarity) reasons.push('일치하는 취향 정보가 부족해 함께 둘러볼 작품으로 제안해요');
    const prefReasons = preferenceReasons(webtoon, preferences);
    return { webtoon, similarity: baseSimilarity, reasons: [...prefReasons, ...reasons].slice(0, 3) };
  }).sort((a, b) => b.similarity - a.similarity || a.webtoon.title.trim().localeCompare(b.webtoon.title.trim(), 'ko') || a.webtoon.id.localeCompare(b.webtoon.id)).slice(0, limit);
  };
}

// CLI/test convenience; production workers retain their index for the catalog lifetime.
export function recommendSimilar(catalog: WebtoonDto[], selected: WebtoonDto[], limit = 10, preferences?: RecommendationPreferences, excludeIds: readonly string[] = []) {
  return createRecommendationIndex(catalog)(selected, limit, preferences, excludeIds);
}
