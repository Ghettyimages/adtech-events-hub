import { DateTime } from 'luxon';
import { extractStrictDates } from './extractor/dateExtractor';

type ScheduleRow = { title: string; start: string; end: string; timezone?: string };
type HubDateRange = { start: string; end: string };
export type GroundedScheduleDates = {
  start: string; end: string; timezone?: string; temporalKind: 'ALL_DAY' | 'TIMED'; evidence: string;
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function titlePattern(title: string): RegExp {
  const body = title.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'giu');
}

/** Dates come from the pasted source section, never a model clock or current year. */
export function groundScheduleDates(
  row: ScheduleRow, rawText: string, allTitles: string[], defaultTimezone: string,
  hub?: HubDateRange
): GroundedScheduleDates | null {
  if (row.title.trim().length < 3) return null;
  const positions = [...rawText.matchAll(titlePattern(row.title))];
  if (positions.length !== 1) return null;
  const start = positions[0].index!;
  let end = rawText.length;
  for (const title of allTitles) {
    if (title === row.title || title.trim().length < 3) continue;
    for (const match of rawText.matchAll(titlePattern(title))) {
      if (match.index! > start) end = Math.min(end, match.index!);
    }
  }
  const lineStart = rawText.lastIndexOf('\n', start - 1) + 1;
  const lineEndIndex = rawText.indexOf('\n', start);
  const titleLine = rawText.slice(lineStart, lineEndIndex < 0 ? rawText.length : lineEndIndex);
  let section = rawText.slice(lineStart, end);
  if (/\b(?:dates?|times?|schedule)\s*(?:(?:is|are)\s*|:\s*)?(?:tbd|tba|to be (?:announced|confirmed))\b/i.test(section)) return null;
  const previousLines = rawText.slice(0, start).split(/\r?\n/).reverse();
  const previousNonempty = previousLines.find((line) => line.trim());
  const rangeLine = /^\s*\d{1,2}(?::\d{2})?\s*[ap]m\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*[ap]m(?:\s*\([A-Za-z_/]+\))?\s*$/i;
  if (previousNonempty && rangeLine.test(previousNonempty)) section = `${previousNonempty}\n${section}`;
  let strict = extractStrictDates(`<p>${escapeHtml(section)}</p>`);
  if (strict.date_status !== 'confirmed') {
    // Agenda day headers may precede the session. Use only the nearest date
    // header, not another session's clock range or an unrelated global year.
    for (const line of previousLines) {
      const date = extractStrictDates(`<p>${escapeHtml(line)}</p>`);
      if (date.date_status !== 'confirmed' || !date.start || date.start.includes('T')) continue;
      const normalized = (value: string) => value.toLowerCase().replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g, '').replace(/[^a-z0-9]/g, '');
      if (!date.evidence || normalized(line) !== normalized(date.evidence)) continue;
      section = `${line}\n${section}`;
      strict = extractStrictDates(`<p>${escapeHtml(section)}</p>`);
      break;
    }
  }
  if (strict.date_status !== 'confirmed' || !strict.start || !strict.end) return null;
  const timed = strict.start.includes('T') && strict.end.includes('T');
  if (timed) {
    const followingNonempty = rawText.slice(lineEndIndex < 0 ? rawText.length : lineEndIndex).split(/\r?\n/).find((line) => line.trim());
    const rangeInLine = /\b\d{1,2}(?::\d{2})?\s*[ap]m\s*(?:-|–|—|to)\s*\d{1,2}(?::\d{2})?\s*[ap]m\b/i;
    if (![titleLine, previousNonempty || '', followingNonempty || ''].some((line) => rangeInLine.test(line))) return null;
  }
  // A partial/unsupported clock expression is unresolved, not an all-day event.
  if (!timed && /\b(?:\d{1,2}(?::\d{2})?\s*[ap]m|\d{1,2}:\d{2})\b/i.test(section)) return null;
  const startDate = strict.start.slice(0, 10);
  const endDate = strict.end.slice(0, 10);
  if (hub && (startDate < hub.start || endDate > hub.end)) return null;
  const zone = defaultTimezone.trim();
  if (timed && !DateTime.now().setZone(zone).isValid) return null;
  return {
    start: strict.start, end: strict.end, timezone: timed ? zone : undefined,
    temporalKind: timed ? 'TIMED' : 'ALL_DAY', evidence: strict.evidence || section.trim(),
  };
}
