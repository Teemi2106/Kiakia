export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function firstParam(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  return single?.trim() || undefined;
}

export function pageParam(value: string | string[] | undefined): number {
  const page = Number(firstParam(value));
  return Number.isInteger(page) && page >= 1 ? page : 1;
}
