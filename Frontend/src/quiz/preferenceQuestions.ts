export type PlatformAnswer = 'naver' | 'kakao' | 'any'
export type CompletionAnswer = 'complete' | 'ongoing' | 'any'

export type PreferenceAnswers = {
  platform: PlatformAnswer
  completion: CompletionAnswer
}

export const preferenceQuestions: readonly {
  id: keyof PreferenceAnswers
  title: string
  options: readonly { id: PreferenceAnswers[keyof PreferenceAnswers]; label: string }[]
}[] = [
  {
    id: 'platform',
    title: '어디에서 보는 작품이 좋으세요?',
    options: [
      { id: 'naver', label: '네O버' },
      { id: 'kakao', label: '카O오' },
      { id: 'any', label: '상관없음' },
    ],
  },
  {
    id: 'completion',
    title: '완결/연재 중 어떤 것이 좋으세요?',
    options: [
      { id: 'complete', label: '완결' },
      { id: 'ongoing', label: '연재' },
      { id: 'any', label: '상관없음' },
    ],
  },
]
