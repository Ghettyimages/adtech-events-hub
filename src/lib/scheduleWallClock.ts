import { DEFAULT_TIMED_ZONE } from '@/lib/eventTemporal';

/**
 * Schedule-import only: if LLM emitted Z/offset ISO, strip the offset and keep
 * the wall-clock digits as a naive local string so normalize interprets them in
 * the selected IANA zone (does not change parseTimedToUtc globally).
 */
export function sanitizeScheduleWallClock(
  value: string,
  _zone: string = DEFAULT_TIMED_ZONE
): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  // Keep digit wall-clock; drop trailing Z or ±HH:MM so TIMED normalize uses zone.
  const withoutZ = trimmed.replace(/Z$/i, '');
  const withoutOffset = withoutZ.replace(/[+-]\d{2}:\d{2}$/, '');
  return withoutOffset;
}
