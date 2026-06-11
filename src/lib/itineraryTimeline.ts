import {
  TEMPORAL_KIND,
  civilDayKeyInZone,
  resolveEventTimezone,
} from '@/lib/eventTemporal';
import type { ItineraryEventRow } from '@/lib/itineraryConstants';
import { ITINERARY_LIMITS } from '@/lib/itineraryConstants';

export interface TimelineLayoutEvent {
  event: ItineraryEventRow;
  column: number;
  totalColumns: number;
  topPercent: number;
  heightPercent: number;
  hidden: boolean;
}

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 22;

export function isTimedItineraryEvent(event: ItineraryEventRow): boolean {
  return event.temporalKind === TEMPORAL_KIND.TIMED;
}

export function partitionItineraryEvents(events: ItineraryEventRow[]) {
  const allDay = events.filter((e) => !isTimedItineraryEvent(e));
  const timed = events.filter(isTimedItineraryEvent);
  return { allDay, timed };
}

function eventRangeMs(event: ItineraryEventRow) {
  return {
    start: new Date(event.start).getTime(),
    end: new Date(event.end).getTime(),
  };
}

/** Assign overlap columns and vertical position for timed events on one day. */
export function layoutTimedEvents(
  events: ItineraryEventRow[],
  dayStartMs?: number
): TimelineLayoutEvent[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  const dayStart =
    dayStartMs ??
    (() => {
      const d = new Date(sorted[0].start);
      d.setHours(DAY_START_HOUR, 0, 0, 0);
      return d.getTime();
    })();

  const dayEnd = (() => {
    const d = new Date(sorted[0].start);
    d.setHours(DAY_END_HOUR, 0, 0, 0);
    return d.getTime();
  })();

  const dayDuration = Math.max(dayEnd - dayStart, 1);

  const columnEnds: number[] = [];
  const placements: { event: ItineraryEventRow; column: number }[] = [];

  for (const event of sorted) {
    const { start, end } = eventRangeMs(event);
    let column = 0;
    while (column < columnEnds.length && columnEnds[column] > start) {
      column++;
    }
    if (column === columnEnds.length) {
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }
    placements.push({ event, column });
  }

  const maxColumns = Math.max(...placements.map((p) => p.column), 0) + 1;
  const visibleCap = ITINERARY_LIMITS.MAX_VISIBLE_OVERLAP_COLUMNS;

  return placements.map(({ event, column }) => {
    const { start, end } = eventRangeMs(event);
    const topPercent = ((start - dayStart) / dayDuration) * 100;
    const heightPercent = Math.max(
      ((end - start) / dayDuration) * 100,
      (ITINERARY_LIMITS.MIN_EVENT_BLOCK_HEIGHT_PX / 400) * 100
    );

    return {
      event,
      column,
      totalColumns: maxColumns,
      topPercent: Math.max(0, Math.min(topPercent, 100)),
      heightPercent: Math.min(heightPercent, 100 - topPercent),
      hidden: column >= visibleCap,
    };
  });
}

export function groupEventsByDay(
  events: ItineraryEventRow[],
  displayTimezone: string
): { dayKey: string; events: ItineraryEventRow[] }[] {
  const groups: { dayKey: string; events: ItineraryEventRow[] }[] = [];
  const sorted = [...events].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );

  for (const event of sorted) {
    const zone = resolveEventTimezone(event, displayTimezone);
    const dayKey = civilDayKeyInZone(new Date(event.start), zone);
    const last = groups[groups.length - 1];
    if (last && last.dayKey === dayKey) {
      last.events.push(event);
    } else {
      groups.push({ dayKey, events: [event] });
    }
  }
  return groups;
}
