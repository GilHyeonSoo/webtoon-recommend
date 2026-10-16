/** Trait keywords aligned with Frontend quiz vocabulary for cross-tag matching. */
export const tasteVocabulary: Record<string, readonly string[]> = {
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
  growth: ['성장', '레벨업', '노력형', '성장물'],
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
};

export const normalizeLoose = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ko').replace(/[\s#·/_-]/gu, '');

const traitMatchers = Object.entries(tasteVocabulary).flatMap(([trait, words]) =>
  words.map((word) => ({ trait, needle: normalizeLoose(word) })).filter((entry) => entry.needle.length >= 2),
);

export function tasteTraitsInText(value: string): string[] {
  const haystack = normalizeLoose(value);
  if (!haystack) return [];
  const found = new Set<string>();
  for (const { trait, needle } of traitMatchers) {
    if (haystack.includes(needle)) found.add(trait);
  }
  return [...found];
}
