export * from './routes';

/** Documentation URL only. Runtime routes never make HTTP self-calls. */
export const DOMAIN = process.env.WEBTOON_API_PUBLIC_URL ?? '/';
