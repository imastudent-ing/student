import { addDays as dfAddDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

export const DATE_FORMAT = 'yyyy-MM-dd';

/** 端末のローカル日付を YYYY-MM-DD で返す */
export function todayStr(d: Date = new Date()): string {
  return format(d, DATE_FORMAT);
}

/** YYYY-MM-DD 文字列に日数を加算する */
export function addDaysStr(date: string, days: number): string {
  return format(dfAddDays(parseISO(date), days), DATE_FORMAT);
}

/** a - b の日数差 */
export function diffDays(a: string, b: string): number {
  return differenceInCalendarDays(parseISO(a), parseISO(b));
}

/** 期限が到来しているか（null は期限なし） */
export function isDue(dueDate: string | null, today: string): boolean {
  return dueDate !== null && dueDate <= today;
}

/** 期限を過ぎているか */
export function isOverdue(dueDate: string | null, today: string): boolean {
  return dueDate !== null && dueDate < today;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** YYYY-MM-DD を「8月23日」形式で表示する */
export function formatDateJa(date: string | null): string {
  if (!date) return '-';
  const d = parseISO(date);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
