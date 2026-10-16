export type Trait =
  | 'romance' | 'action' | 'mystery' | 'horror' | 'daily' | 'comedy' | 'warm'
  | 'tragic' | 'realistic' | 'fantasy' | 'hybrid' | 'growth' | 'overpowered'
  | 'strategy' | 'ordinary' | 'regression' | 'rebirth' | 'revenge' | 'teamwork'
  | 'school' | 'work' | 'family' | 'hobby' | 'leveling' | 'martial' | 'survival'
  | 'twist' | 'complexLove' | 'friendsLove' | 'firstLove' | 'rivalsLove'
  | 'reunion' | 'protect' | 'ambition' | 'slow' | 'gentle' | 'investigator'
  | 'victim' | 'secret'

export interface AnswerOption {
  id: string
  label: string
  traits: readonly Trait[]
}

export type AnswerOptions =
  | readonly [AnswerOption, AnswerOption]
  | readonly [AnswerOption, AnswerOption, AnswerOption]
  | readonly [AnswerOption, AnswerOption, AnswerOption, AnswerOption]

export interface Question {
  id: string
  title: string
  options: AnswerOptions
  weight: number
}

export interface AnswerRecord {
  questionId: string
  answerId: string
}

const answer = (id: string, label: string, ...traits: Trait[]): AnswerOption => ({ id, label, traits })

export const questions = {
  mood: {
    id: 'mood', title: '오늘 어떤 이야기에 빠지고 싶나요?', weight: 3,
    options: [
      answer('romance', '설레는', 'romance'),
      answer('power', '통쾌한', 'action', 'growth', 'revenge'),
      answer('tension', '긴장되는', 'mystery', 'horror', 'survival'),
      answer('calm', '편안한', 'warm', 'daily', 'gentle'),
    ],
  },
  world: {
    id: 'world', title: '어떤 세계로 떠나볼까요?', weight: 2,
    options: [
      answer('real', '현실', 'realistic', 'daily'),
      answer('fantasy', '판타지', 'fantasy'),
      answer('hybrid', '현실 속 판타지', 'hybrid'),
    ],
  },
  focus: {
    id: 'focus', title: '이야기에서 가장 보고 싶은 것은 무엇인가요?', weight: 4,
    options: [
      answer('romance', '사랑·관계', 'romance'),
      answer('growth', '도전·성장', 'growth', 'action'),
      answer('mystery', '사건·비밀', 'mystery', 'survival'),
      answer('daily', '일상·공감', 'daily', 'warm'),
    ],
  },
  hero: {
    id: 'hero', title: '어떤 주인공에게 끌리나요?', weight: 3,
    options: [
      answer('growth', '성장하는', 'growth'),
      answer('power', '압도적인', 'overpowered'),
      answer('strategy', '영리한', 'strategy'),
      answer('ordinary', '평범한', 'ordinary'),
    ],
  },
  romanceStyle: {
    id: 'romanceStyle', title: '어떤 사랑 이야기가 좋나요?', weight: 2,
    options: [
      answer('sweet', '달콤한', 'romance', 'warm'),
      answer('complex', '복잡한', 'complexLove'),
      answer('tragic', '애틋한', 'tragic'),
    ],
  },
  romanceOrigin: {
    id: 'romanceOrigin', title: '어떤 관계에서 시작하면 좋겠나요?', weight: 2,
    options: [
      answer('friends', '친구 → 연인', 'friendsLove'),
      answer('first', '첫 만남', 'firstLove'),
      answer('rivals', '미움 → 사랑', 'rivalsLove'),
      answer('reunion', '재회', 'reunion'),
    ],
  },
  romanceBackdrop: {
    id: 'romanceBackdrop', title: '연애 말고 어떤 이야기가 함께 있으면 좋겠나요?', weight: 2,
    options: [
      answer('school', '학교', 'school'),
      answer('work', '직장', 'work'),
      answer('fantasy', '판타지', 'fantasy'),
      answer('love', '연애만', 'romance'),
    ],
  },
  romanceConflict: {
    id: 'romanceConflict', title: '갈등이 많은 연애도 괜찮나요?', weight: 2,
    options: [answer('complex', '괜찮아요', 'complexLove'), answer('gentle', '편안한 관계', 'gentle', 'warm')],
  },
  growthMethod: {
    id: 'growthMethod', title: '주인공은 어떻게 강해지면 좋겠나요?', weight: 2,
    options: [
      answer('effort', '노력·훈련', 'growth'),
      answer('power', '특별한 능력', 'overpowered', 'fantasy'),
      answer('strategy', '지식·전략', 'strategy'),
      answer('team', '동료·협력', 'teamwork'),
    ],
  },
  secondChance: {
    id: 'secondChance', title: '새로운 기회가 주어진다면 어떤 이야기가 좋나요?', weight: 2,
    options: [
      answer('regression', '과거로', 'regression'),
      answer('rebirth', '다른 세계로', 'rebirth', 'fantasy'),
      answer('present', '지금의 삶에서', 'growth', 'realistic'),
    ],
  },
  goal: {
    id: 'goal', title: '어떤 목표를 향해 나아가면 좋겠나요?', weight: 2,
    options: [
      answer('top', '정상', 'ambition', 'growth'),
      answer('protect', '보호', 'protect'),
      answer('revenge', '복수', 'revenge'),
      answer('survive', '생존', 'survival'),
    ],
  },
  battle: {
    id: 'battle', title: '어떤 대결이 가장 끌리나요?', weight: 2,
    options: [
      answer('magic', '초능력·마법', 'fantasy', 'leveling'),
      answer('martial', '무공·검술', 'martial'),
      answer('fight', '현실 격투', 'action', 'realistic'),
      answer('strategy', '두뇌 싸움', 'strategy'),
    ],
  },
  tensionType: {
    id: 'tensionType', title: '어떤 긴장감을 원하시나요?', weight: 3,
    options: [
      answer('detective', '추리', 'mystery'),
      answer('survival', '생존', 'survival'),
      answer('strategy', '심리전', 'strategy', 'mystery'),
      answer('horror', '초자연 공포', 'horror'),
    ],
  },
  horror: {
    id: 'horror', title: '무서운 장면도 괜찮나요?', weight: 2,
    options: [answer('allow', '괜찮아요', 'horror'), answer('avoid', '피할래요')],
  },
  mysteryLead: {
    id: 'mysteryLead', title: '어떤 인물이 이야기를 이끌면 좋겠나요?', weight: 2,
    options: [
      answer('investigator', '진실을 찾는', 'investigator'),
      answer('victim', '휘말린', 'victim', 'ordinary'),
      answer('secret', '비밀을 숨긴', 'secret'),
    ],
  },
  reveal: {
    id: 'reveal', title: '진실은 어떻게 밝혀지면 좋겠나요?', weight: 2,
    options: [answer('clues', '차근차근', 'mystery'), answer('twist', '뜻밖의 반전', 'twist'), answer('psychology', '심리전', 'strategy')],
  },
  dailySetting: {
    id: 'dailySetting', title: '어떤 일상을 만나고 싶나요?', weight: 2,
    options: [
      answer('school', '학교·친구', 'school'),
      answer('work', '직장·사회', 'work', 'realistic'),
      answer('family', '가족·생활', 'family', 'daily'),
      answer('hobby', '취미', 'hobby'),
    ],
  },
  dailyFeeling: {
    id: 'dailyFeeling', title: '읽고 나서 어떤 기분이면 좋겠나요?', weight: 3,
    options: [answer('laugh', '웃음', 'comedy'), answer('warm', '위로', 'warm', 'gentle'), answer('think', '깊은 생각', 'realistic')],
  },
  dailyIntensity: {
    id: 'dailyIntensity', title: '현실의 고민을 얼마나 다루면 좋겠나요?', weight: 2,
    options: [answer('light', '가볍게', 'gentle', 'comedy'), answer('deep', '깊이 있게', 'realistic')],
  },
  completion: {
    id: 'completion', title: '이야기의 끝을 기다릴 수 있나요?', weight: 0,
    options: [answer('complete', '완결작'), answer('ongoing', '연재작'), answer('any', '상관없음')],
  },
  access: {
    id: 'access', title: '무료 이용은 얼마나 중요한가요?', weight: 0,
    options: [answer('free', '무료 우선'), answer('wait', '기다리면 무료'), answer('any', '유료도 가능')],
  },
  platform: {
    id: 'platform', title: '어디서 웹툰을 만나볼까요?', weight: 0,
    options: [answer('NAVER', '네이버웹툰'), answer('KAKAO', '카카오웹툰'), answer('KAKAO_PAGE', '카카오페이지'), answer('any', '어디든')],
  },
} satisfies Record<string, Question>

export type QuestionId = keyof typeof questions

const branchPaths: Record<string, readonly QuestionId[]> = {
  romance: ['romanceStyle', 'romanceOrigin', 'romanceBackdrop', 'romanceConflict'],
  growth: ['hero', 'growthMethod', 'secondChance', 'goal', 'battle'],
  mystery: ['tensionType', 'horror', 'mysteryLead', 'reveal'],
  daily: ['dailySetting', 'dailyFeeling', 'dailyIntensity'],
}

export function getQuestionPath(answers: readonly AnswerRecord[]): readonly QuestionId[] {
  const focus = answers.find((record) => record.questionId === 'focus')?.answerId
  return ['mood', 'world', 'focus', ...(focus ? branchPaths[focus] ?? [] : []), 'completion', 'access', 'platform']
}

export function getCurrentQuestion(answers: readonly AnswerRecord[]): Question | null {
  const id = getQuestionPath(answers)[answers.length]
  return id ? questions[id] : null
}

export function appendAnswer(answers: readonly AnswerRecord[], questionId: string, answerId: string): AnswerRecord[] {
  const current = getCurrentQuestion(answers)
  if (!current || current.id !== questionId || !current.options.some((option) => option.id === answerId)) return [...answers]
  return [...answers, { questionId, answerId }]
}
