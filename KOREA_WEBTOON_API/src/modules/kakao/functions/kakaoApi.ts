import { outboundSafety } from '@/security/context';
import axios from 'axios';
import axiosRetry from 'axios-retry';

const kakaoApi = axios.create({
  baseURL: 'https://gateway-kw.kakao.com',
  timeout: 30_000,
});

outboundSafety(kakaoApi);

axiosRetry(kakaoApi, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 3_000,
  onRetry: (retry, _, config) => {
    console.error(`🚧 [KAKAO] ${config.url} - retry: ${retry}`);
  },
});

export enum KAKAO_PLACEMENT {
  COMPLETE = 'timetable_completed',
  MON = 'timetable_mon',
  TUE = 'timetable_tue',
  WED = 'timetable_wed',
  THU = 'timetable_thu',
  FRI = 'timetable_fri',
  SAT = 'timetable_sat',
  SUN = 'timetable_sun',
}

interface KakaoWebtoonCard {
  content: {
    id: number;
    /**
     * @description 실제 웹툰 페이지 URL에 쓰임
     * @example "내일도-출근"
     */
    seoId: string;
    title: string;
    badges: {
      /**
       * @description 'WAIT_FOR_FREE'는 티켓정보를 확인해야함
       */
      title: 'FREE_PUBLISHING' | 'WAIT_FOR_FREE_PLUS' | 'up' | 'WAIT_FOR_FREE';
      type: 'INFO' | 'UP';
    }[];
    adult: boolean;
    authors: {
      name: string;
      type: 'AUTHOR' | 'ILLUSTRATOR' | 'PUBLISHER';
    }[];

    featuredCharacterImageA: string;
    featuredCharacterImageB: string;
    backgroundImage: string;
  };
}

export interface GetWebtoonListByPlacementResponse {
  data: [
    {
      cardGroups: [
        {
          cards: KakaoWebtoonCard[];
        },
      ];
    },
  ];
}

export const getWebtoonListByPlacement = (placement: KAKAO_PLACEMENT) => {
  console.info(`⌛️ [KAKAO] placement: ${placement} - 웹툰 리스트 정보 요청`);
  return kakaoApi.get<GetWebtoonListByPlacementResponse>(
    `/section/v2/timetables/days?placement=${placement}`,
  );
};

interface TicketData {
  data: {
    //! 없는 경우가 웹툰 하나 정도 있었음 (id: 3574), 유료 결제만 가능한 웹툰인듯
    waitForFree?: {
      /**
       * @example "PT72H" - 72시간
       */
      interval: string;
    };
  };
}

export const getTicketInfo = (id: number) => {
  console.info(`⌛️ [KAKAO] id: ${id} - 티켓 정보 요청`);
  return kakaoApi.get<TicketData>(
    `/ticket/v1/views/ticket-charged-summary?contentId=${id}&limit=30`,
    {
      headers: {
        //! 해당 헤더가 없으면 403 에러 발생
        'Accept-Language': 'ko',
      },
    },
  );
};
