import { DateTime } from 'luxon';

type EditionEvent = { title: string; start?: string | Date | null; timezone?: string | null };

export function sourceDateYear(start?: string | Date | null, timezone?: string | null): string | null {
  if (!start) return null;
  if (typeof start === 'string') return start.match(/^(\d{4})-\d{2}-\d{2}/)?.[1] || null;
  if (!Number.isFinite(start.getTime())) return null;
  const date = DateTime.fromJSDate(start, { zone: timezone || 'utc' });
  return date.isValid ? String(date.year) : null;
}

/** A reused URL or source ID is not sufficient to prove the same annual edition. */
export function editionsCompatible(previous: EditionEvent, next: EditionEvent): boolean {
  const priorYears = previous.title.match(/\b(?:19|20)\d{2}\b/g) || [];
  const nextYears = next.title.match(/\b(?:19|20)\d{2}\b/g) || [];
  if (priorYears.length && nextYears.length && priorYears.join(',') !== nextYears.join(',')) return false;
  const previousYear = sourceDateYear(previous.start, previous.timezone);
  const nextYear = sourceDateYear(next.start, next.timezone);
  // Moving an event across years may be legitimate, but requires identity review.
  return Boolean(previousYear && nextYear && previousYear === nextYear);
}
