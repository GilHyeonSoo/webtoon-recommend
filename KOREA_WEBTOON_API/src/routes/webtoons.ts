import type { Response, Request } from 'express';
import { allowedQuery, integer, boolean, BadInput } from '@/security/input';
import {
  KakaoPageWebtoon,
  KakaoWebtoon,
  NaverWebtoon,
  NormalizedWebtoon,
  Provider,
} from '@/database/entity';
import { AppDataSource } from '@/database/datasource';

/**
 * @swagger
 * /webtoons:
 *   get:
 *     tags: [Webtoons]
 *     summary: 웹툰 목록 조회
 *     description: 선택적 필터를 사용하여 웹툰 목록을 조회합니다.
 *     parameters:
 *       - in: query
 *         name: keyword
 *         schema:
 *           type: string
 *         description: 웹툰 제목 및 작가 검색을 위한 키워드
 *       - in: query
 *         name: provider
 *         schema:
 *           type: string
 *           enum: [NAVER, KAKAO, KAKAO_PAGE]
 *         description: 웹툰 제공자
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: 페이지 번호 (페이지네이션)
 *       - in: query
 *         name: perPage
 *         schema:
 *           type: integer
 *           default: 30
 *           maximum: 100
 *         description: 페이지당 항목 수
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [ASC, DESC]
 *           default: ASC
 *         description: 정렬 순서
 *       - in: query
 *         name: isUpdated
 *         schema:
 *           type: boolean
 *         description: 업데이트된 웹툰 필터
 *       - in: query
 *         name: isFree
 *         schema:
 *           type: boolean
 *         description: 무료 웹툰 필터
 *       - in: query
 *         name: updateDay
 *         schema:
 *           type: string
 *           enum: [MON, TUE, WED, THU, FRI, SAT, SUN]
 *         description: 웹툰 업데이트 요일 필터
 *     responses:
 *       200:
 *         description: 웹툰 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 webtoons:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Webtoon'
 *                 total:
 *                   type: integer
 *                 isLastPage:
 *                   type: boolean
 *       400:
 *         description: 잘못된 파라미터
 *       500:
 *         description: 내부 서버 오류
 */

export const getWebtoons = async (req: Request, res: Response) => {
  try {
    allowedQuery(req.query, ['keyword', 'page', 'perPage', 'provider', 'sort', 'isUpdated', 'isFree', 'updateDay']);
    const page = integer(req.query.page, 1, 1, 1_000_000);
    const perPage = integer(req.query.perPage, 30, 1, 100);
    const { keyword, provider, updateDay } = req.query;
    const sort = req.query.sort ?? 'ASC';
    const isUpdated = boolean(req.query.isUpdated);
    const isFree = boolean(req.query.isFree);
    if (typeof sort !== 'string' || !['ASC', 'DESC'].includes(sort)) throw new BadInput('Invalid sort');
    if (provider !== undefined && (typeof provider !== 'string' || !['NAVER', 'KAKAO', 'KAKAO_PAGE'].includes(provider))) throw new BadInput('Invalid provider');
    if (keyword !== undefined && (typeof keyword !== 'string' || keyword.length > 100)) throw new BadInput('Invalid keyword');
    if (updateDay !== undefined && (typeof updateDay !== 'string' || !['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].includes(updateDay))) throw new BadInput('Invalid day');

    const WebtoonEntity = (() => {
      switch (provider) {
        case 'NAVER':
          return NaverWebtoon;
        case 'KAKAO':
          return KakaoWebtoon;
        case 'KAKAO_PAGE':
          return KakaoPageWebtoon;
        default:
          return NormalizedWebtoon;
      }
    })();

    const webtoonRepository = AppDataSource.getRepository(WebtoonEntity);

    const queryBuilder = webtoonRepository.createQueryBuilder('webtoon');

    if (keyword) {
      const normalizedKeyword = (keyword as string).replace(/\s+/g, '').toLowerCase();
      queryBuilder.andWhere(
        '(LOWER(REPLACE(webtoon.title, " ", "")) LIKE :keyword OR LOWER(REPLACE(webtoon.authors, " ", "")) LIKE :keyword)',
        { keyword: `%${normalizedKeyword}%` },
      );
    }

    if (typeof isUpdated !== 'undefined') {
      queryBuilder.andWhere('webtoon.isUpdated = :isUpdated', {
        isUpdated: isUpdated ? 1 : 0,
      });
    }

    if (typeof isFree !== 'undefined') {
      queryBuilder.andWhere('webtoon.isFree = :isFree', {
        isFree: isFree ? 1 : 0,
      });
    }

    if (updateDay) {
      queryBuilder.andWhere('webtoon.updateDays LIKE :updateDay', {
        updateDay: `%${updateDay}%`,
      });
    }

    const [webtoons, total] = await queryBuilder
      .take(+perPage)
      .skip((+page - 1) * +perPage)
      .orderBy('webtoon.title', sort as 'ASC' | 'DESC')
      .getManyAndCount();

    const isLastPage = page * perPage >= total;

    return res.json({ webtoons, total, isLastPage });
  } catch (err) {
    return res.status(err instanceof BadInput ? 400 : 500).json({ message: err instanceof BadInput ? 'Invalid query' : 'Internal server error' });
  }
};
