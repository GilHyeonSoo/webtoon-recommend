import { questions } from './questions.ts'
import type { AnswerRecord, QuestionId, Trait } from './questions.ts'

export type Provider = 'NAVER' | 'KAKAO' | 'KAKAO_PAGE'
export const normalizeCatalogWebtoon = (
  raw: Partial<Webtoon> & Pick<Webtoon, 'id' | 'title' | 'provider' | 'url'>,
): Webtoon => ({
  id: raw.id,
  title: raw.title,
  provider: raw.provider,
  authors: raw.authors ?? [],
  thumbnail: raw.thumbnail ?? [],
  url: raw.url,
  isEnd: raw.isEnd ?? false,
  isFree: raw.isFree ?? true,
  freeWaitHour: raw.freeWaitHour ?? null,
  ageGrade: raw.ageGrade ?? 0,
  synopsis: raw.synopsis ?? null,
  genres: raw.genres ?? [],
  tags: raw.tags ?? [],
  averageRating: raw.averageRating ?? null,
  primaryGenre: raw.primaryGenre ?? 'unknown',
  totalEpisodeCount: raw.totalEpisodeCount ?? null,
  isOnHiatus: raw.isOnHiatus ?? null,
  popularityCount: raw.popularityCount ?? null,
})

export interface Webtoon {
  id: string
  title: string
  provider: Provider
  authors: string[]
  thumbnail: string[]
  url: string
  isEnd: boolean
  isFree: boolean
  freeWaitHour: number | null
  ageGrade: number
  synopsis: string | null
  genres: string[]
  tags: string[]
  averageRating: number | null
  primaryGenre: string
  totalEpisodeCount: number | null
  isOnHiatus: boolean | null
  popularityCount: number | null
}
export interface Recommendation {
  webtoon: Webtoon
  score: number
  tasteScore: number
  reasons: string[]
  hasMetadata: boolean
}

const vocabulary: Record<Trait, readonly string[]> = {
  romance: ['pure', '로맨스', '로판', '설레는', '궁중로맨스'],
  action: ['action', '액션', '격투', '통쾌', '사이다', '역동적인'],
  mystery: ['thrill', '스릴러', '미스터리', '미스테리', '추리', '심령'],
  horror: ['공포', '등골오싹', '호러', '심령'],
  daily: ['daily', '일상', '공감'],
  comedy: ['comic', '개그', '코미디', '웃기는', '발랄한', '헛웃음'],
  warm: ['따뜻', '힐링', '감동', '무해한'],
  tragic: ['슬픈', '애틋', '눈물', '이별'],
  realistic: ['하이퍼리얼리즘', '현실', '자본주의', '직장'],
  fantasy: ['fantasy', '판타지', '로판', '마법', '마녀', '초능력'],
  hybrid: ['현대판타지', '학원판타지', '헌터', '각성'],
  growth: ['성장', '레벨업', '노력형'],
  overpowered: ['먼치킨', '압도적', '천재'],
  strategy: ['두뇌', '계략', '전략', '심리전'],
  ordinary: ['평범', '소시민'],
  regression: ['회귀', '과거로돌아', '시간을되돌'],
  rebirth: ['환생', '빙의', '이세계', '새로운삶'],
  revenge: ['복수', '참교육'],
  teamwork: ['동료', '팀워크', '협력'],
  school: ['학원물', '학원액션', '학원판타지', '학교', '학창', '소꿉친구'],
  work: ['직장', '회사', '오피스', '알바'],
  family: ['가족', '엄마', '아빠', '부모', '육아'],
  hobby: ['취미', '요리', '스포츠', '음악'],
  leveling: ['레벨업', '던전', '몬스터', '헌터'],
  martial: ['무협', '무공', '문파', '검술'],
  survival: ['서바이벌', '생존', '살인게임', '재난'],
  twist: ['반전'],
  complexLove: ['삼각관계', '고자극로맨스', '불륜', '치정'],
  friendsLove: ['소꿉친구', '친구에서연인'],
  firstLove: ['첫사랑', '첫만남', '첫눈에'],
  rivalsLove: ['혐관', '앙숙', '라이벌로맨스'],
  reunion: ['재회', '다시만난'],
  protect: ['지키기', '지키려', '보호'],
  ambition: ['성공', '슈퍼스타', '정상에'],
  slow: ['잔잔', '섬세한감정'],
  gentle: ['무해한', '힐링', '가벼운', '따뜻한'],
  investigator: ['수사', '탐정', '진실을찾', '비밀을밝히'],
  victim: ['휘말', '사건에말려'],
  secret: ['비밀을숨', '정체를숨'],
}

const normalize = (value: string) => value.toLowerCase().replace(/[\s#·/_-]/g, '')
interface Evidence { confidence: number; description: string }
const genreLabels: Record<string, string> = {
  pure: '로맨스', action: '액션', daily: '일상', thrill: '스릴러',
  drama: '드라마', fantasy: '판타지', comic: '개그',
}

function findEvidence(webtoon: Webtoon, trait: Trait): Evidence | null {
  const words = vocabulary[trait].map(normalize)
  const genre = webtoon.genres.find((value) => words.some((word) => normalize(value).includes(word)))
  if (genre) return { confidence: 1, description: `‘${genreLabels[genre] ?? genre}’ 장르` }
  const tag = webtoon.tags.find((value) => words.some((word) => normalize(value).includes(word)))
  if (tag) return { confidence: 1, description: `‘${tag.replace(/^#/, '')}’ 태그` }
  const synopsis = normalize(webtoon.synopsis ?? '')
  const word = words.find((value) => synopsis.includes(value))
  return word ? { confidence: 0.5, description: `줄거리의 ‘${word}’ 단서` } : null
}

export function rankWebtoons(catalog: readonly Webtoon[], answers: readonly AnswerRecord[], limit = 3): Recommendation[] {
  const choice = (id: string) => answers.find((record) => record.questionId === id)?.answerId
  const provider = choice('platform')
  const completion = choice('completion')
  const access = choice('access')
  const avoidHorror = choice('horror') === 'avoid'

  return catalog
    .filter((webtoon) => (!provider || provider === 'any' || webtoon.provider === provider)
      && (completion !== 'complete' || webtoon.isEnd)
      && (completion !== 'ongoing' || !webtoon.isEnd)
      // Missing metadata remains unknown, rather than being inferred as horror.
      && (!avoidHorror || !findEvidence(webtoon, 'horror')))
    .map((webtoon): Recommendation => {
      let tasteScore = 0
      const reasons: string[] = []
      const seenEvidence = new Set<string>()
      for (const record of answers) {
        const question = questions[record.questionId as QuestionId]
        if (!question) continue
        const option = question.options.find((item) => item.id === record.answerId)
        const evidence = option?.traits
          .map((trait) => findEvidence(webtoon, trait))
          .filter((item): item is Evidence => item !== null)
          .sort((a, b) => b.confidence - a.confidence)[0]
        if (!evidence || !option) continue
        tasteScore += question.weight * evidence.confidence
        if (!seenEvidence.has(evidence.description)) {
          reasons.push(`${option.label} — ${evidence.description}`)
          seenEvidence.add(evidence.description)
        }
      }
      let accessScore = 0
      if (access === 'free' && webtoon.isFree) accessScore = webtoon.freeWaitHour === null ? 3 : 1
      if (access === 'wait' && webtoon.isFree) accessScore = 3
      return {
        webtoon, score: tasteScore + accessScore, tasteScore,
        reasons: reasons.slice(0, 3),
        hasMetadata: Boolean(webtoon.synopsis || webtoon.genres.length || webtoon.tags.length),
      }
    })
    .sort((a, b) => b.score - a.score || b.tasteScore - a.tasteScore || a.webtoon.id.localeCompare(b.webtoon.id))
    .slice(0, Math.max(0, limit))
}

export const providerLabels: Record<Provider, string> = {
  NAVER: '네이버웹툰', KAKAO: '카카오웹툰', KAKAO_PAGE: '카카오페이지',
}
