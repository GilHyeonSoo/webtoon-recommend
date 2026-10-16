export class BadInput extends Error {}
export function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new BadInput('Invalid integer');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new BadInput('Integer out of range');
  return number;
}
export function boolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadInput('Invalid boolean');
}
export function allowedQuery(query: Record<string, unknown>, keys: string[]) {
  if (Object.keys(query).some((key) => !keys.includes(key))) throw new BadInput('Unsupported parameter');
}
