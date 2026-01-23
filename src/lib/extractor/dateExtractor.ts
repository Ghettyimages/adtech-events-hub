/**
 * Strict date extraction from HTML
 * Looks for structured data, meta tags, and visible date patterns
 */

import * as cheerio from 'cheerio';
import { parse, isValid } from 'date-fns';

export type StrictDateStatus = 'confirmed' | 'tbd';

export type StrictDateResult = {
  start?: string; // ISO date string
  end?: string; // ISO date string
  date_status: StrictDateStatus;
  evidence?: string;
  evidence_context?: string;
};

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const MONTH_PATTERN = new RegExp(
  `\\b(${MONTH_NAMES.map((m) => `${m.slice(0, 3)}(?:${m.slice(3)})?`).join('|')})\\b`,
  'i'
);

const DATE_PATTERN = new RegExp(
  `\\b(${MONTH_NAMES.map((m) => `${m.slice(0, 3)}(?:${m.slice(3)})?`).join('|')})\\s+(\\d{1,2})(?:\\s*(?:-|–|to)\\s*(\\d{1,2}))?(?:\\s*\\([^)]+\\))?(?:,\\s*(\\d{4}))?`,
  'gi'
);

// Cross-month date range pattern: "Month Day - Month Day, Year" or "Month Day, Year - Month Day, Year"
// Captures: startMonth, startDay, startYear?, endMonth, endDay, endYear?
const CROSS_MONTH_DATE_PATTERN = new RegExp(
  `\\b(${MONTH_NAMES.map((m) => `${m.slice(0, 3)}(?:${m.slice(3)})?`).join('|')})\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?\\s*(?:-|–|to)\\s*(${MONTH_NAMES.map((m) => `${m.slice(0, 3)}(?:${m.slice(3)})?`).join('|')})\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?`,
  'gi'
);

const DEBUG = process.env.DEBUG_EXTRACTOR === '1';

const logDebug = (...args: any[]) => {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.debug('[strict-date]', ...args);
  }
};

const sanitizeEvidence = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 160);

/**
 * Normalize a date to date-only format (YYYY-MM-DD) if it's a date-only value
 * This allows normalization to properly detect all-day events
 */
const normalizeDateToDateOnly = (dateString: string): string => {
  const date = new Date(dateString);
  
  // Check if the date string is date-only (YYYY-MM-DD format)
  // or if the time component is midnight (00:00:00)
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateString) || 
                     /^\d{4}-\d{2}-\d{2}T00:00:00/.test(dateString);
  
  if (isDateOnly || (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0)) {
    // Return date-only format (YYYY-MM-DD) for all-day events
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // Preserve existing time as ISO string
  return date.toISOString();
};

const parseDateMatch = (
  match: RegExpExecArray,
  fallbackYear?: number
): { startIso: string; endIso: string; evidence: string } | null => {
  const monthName = match[1];
  const startDay = parseInt(match[2], 10);
  const endDay = match[3] ? parseInt(match[3], 10) : startDay;
  const yearPart = match[4] ? parseInt(match[4], 10) : fallbackYear;

  if (!monthName || Number.isNaN(startDay) || Number.isNaN(endDay) || !yearPart) {
    return null;
  }

  const monthMatch = monthName.toLowerCase().match(MONTH_PATTERN);
  if (!monthMatch) return null;

  const monthIndex = MONTH_NAMES.findIndex((month) => month.startsWith(monthMatch[0].toLowerCase()));
  if (monthIndex === -1) return null;

  // Return date-only format (YYYY-MM-DD) for all-day events
  // This allows normalization to properly detect and handle all-day events
  const startYear = String(yearPart);
  const startMonth = String(monthIndex + 1).padStart(2, '0');
  const startDayStr = String(startDay).padStart(2, '0');
  const endDayStr = String(endDay).padStart(2, '0');

  const startIso = `${startYear}-${startMonth}-${startDayStr}`;
  const endIso = `${startYear}-${startMonth}-${endDayStr}`;

  // Validate dates
  const startDate = new Date(startIso);
  const endDate = new Date(endIso);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  const evidence = match[0].replace(/\s+/g, ' ').trim();

  return {
    startIso,
    endIso,
    evidence,
  };
};

/**
 * Parse cross-month date ranges like "October 29 - November 2, 2025"
 */
const parseCrossMonthDateMatch = (
  match: RegExpExecArray,
  fallbackYear?: number
): { startIso: string; endIso: string; evidence: string } | null => {
  const startMonthName = match[1];
  const startDay = parseInt(match[2], 10);
  const startYearPart = match[3] ? parseInt(match[3], 10) : undefined;
  const endMonthName = match[4];
  const endDay = parseInt(match[5], 10);
  const endYearPart = match[6] ? parseInt(match[6], 10) : undefined;

  // Determine years - use explicit years if provided, otherwise fallback
  const startYear = startYearPart ?? endYearPart ?? fallbackYear;
  let endYear = endYearPart ?? startYearPart ?? fallbackYear;

  if (!startMonthName || !endMonthName || !startYear || Number.isNaN(startDay) || Number.isNaN(endDay)) {
    return null;
  }

  // Get month indices
  const startMonthMatch = startMonthName.toLowerCase().match(MONTH_PATTERN);
  const endMonthMatch = endMonthName.toLowerCase().match(MONTH_PATTERN);
  if (!startMonthMatch || !endMonthMatch) return null;

  const startMonthIndex = MONTH_NAMES.findIndex((m) => m.startsWith(startMonthMatch[0].toLowerCase()));
  const endMonthIndex = MONTH_NAMES.findIndex((m) => m.startsWith(endMonthMatch[0].toLowerCase()));

  if (startMonthIndex === -1 || endMonthIndex === -1) {
    return null;
  }

  // Handle year rollover (e.g., December 28 - January 3)
  if (endMonthIndex < startMonthIndex && !endYearPart) {
    endYear = (startYear ?? fallbackYear ?? new Date().getFullYear()) + 1;
  }

  if (!endYear) {
    return null;
  }

  const startIso = `${startYear}-${String(startMonthIndex + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
  const endIso = `${endYear}-${String(endMonthIndex + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

  // Validate dates
  const startDate = new Date(startIso);
  const endDate = new Date(endIso);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  // Ensure end is after start
  if (endDate < startDate) {
    return null;
  }

  const evidence = match[0].replace(/\s+/g, ' ').trim();

  return {
    startIso,
    endIso,
    evidence,
  };
};

const fromJsonLd = (html: string): StrictDateResult | null => {
  const $ = cheerio.load(html);
  const scripts = $('script[type="application/ld+json"]');

  for (let i = 0; i < scripts.length; i += 1) {
    const script = scripts.eq(i).text();
    try {
      const json = JSON.parse(script);
      const items = Array.isArray(json) ? json : [json];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const type = item['@type'];
        if (!type) continue;
        const types = Array.isArray(type) ? type : [type];
        if (!types.includes('Event')) continue;

        const startDate = item.startDate || item.start;
        const endDate = item.endDate || item.end;

        if (startDate) {
          try {
            const start = normalizeDateToDateOnly(startDate);
            const end = endDate ? normalizeDateToDateOnly(endDate) : start;

            // Validate that we got a valid date string
            const startDateObj = new Date(start);
            if (!isNaN(startDateObj.getTime())) {
              logDebug('JSON-LD dates found', { start, end });
              return {
                start,
                end,
                date_status: 'confirmed',
                evidence: sanitizeEvidence(`${startDate}${endDate ? ` to ${endDate}` : ''}`),
                evidence_context: 'json-ld',
              };
            }
          } catch (error) {
            logDebug('Failed to parse JSON-LD dates', error);
          }
        }
      }
    } catch (error) {
      logDebug('Failed to parse JSON-LD for dates', error);
    }
  }
  return null;
};

const fromMetaTags = (html: string): StrictDateResult | null => {
  const $ = cheerio.load(html);
  const selectors = [
    'meta[property="event:start_time"]',
    'meta[name="event:start_time"]',
    'meta[property="event:end_time"]',
    'meta[name="event:end_time"]',
    'meta[itemprop="startDate"]',
    'meta[itemprop="endDate"]',
  ];

  let startDate: string | null = null;
  let endDate: string | null = null;

  for (const selector of selectors) {
    const node = $(selector).first();
    if (!node || node.length === 0) continue;
    const content = node.attr('content')?.trim();
    if (!content) continue;

    if (selector.includes('start')) {
      startDate = content;
    } else if (selector.includes('end')) {
      endDate = content;
    }
  }

  if (startDate) {
    try {
      const start = normalizeDateToDateOnly(startDate);
      const end = endDate ? normalizeDateToDateOnly(endDate) : start;

      // Validate that we got a valid date string
      const startDateObj = new Date(start);
      if (!isNaN(startDateObj.getTime())) {
        logDebug('Meta tag dates found', { start, end });
        return {
          start,
          end,
          date_status: 'confirmed',
          evidence: sanitizeEvidence(`${startDate}${endDate ? ` to ${endDate}` : ''}`),
          evidence_context: 'meta-tags',
        };
      }
    } catch (error) {
      logDebug('Failed to parse meta tag dates', error);
    }
  }

  return null;
};

const fromVisibleText = (html: string): StrictDateResult | null => {
  const $ = cheerio.load(html);
  const bodyText = $('body').text();

  // Try to find current year from context
  const currentYear = new Date().getFullYear();
  const yearMatch = bodyText.match(/\b(20\d{2})\b/);
  const fallbackYear = yearMatch ? parseInt(yearMatch[1], 10) : currentYear;

  // Try cross-month date patterns FIRST (e.g., "October 29 - November 2, 2025")
  CROSS_MONTH_DATE_PATTERN.lastIndex = 0;
  const crossMonthMatches: Array<{ match: RegExpExecArray; index: number }> = [];
  let crossExec: RegExpExecArray | null;

  while ((crossExec = CROSS_MONTH_DATE_PATTERN.exec(bodyText)) !== null) {
    crossMonthMatches.push({ match: crossExec, index: crossExec.index });
  }

  // Try to parse cross-month date matches first
  for (const { match } of crossMonthMatches) {
    const parsed = parseCrossMonthDateMatch(match, fallbackYear);
    if (parsed) {
      logDebug('Cross-month visible text date found', { start: parsed.startIso, end: parsed.endIso });
      return {
        start: parsed.startIso,
        end: parsed.endIso,
        date_status: 'confirmed',
        evidence: parsed.evidence,
        evidence_context: 'visible-text',
      };
    }
  }

  // Fallback to single-month date patterns
  DATE_PATTERN.lastIndex = 0;
  const matches: Array<{ match: RegExpExecArray; index: number }> = [];
  let exec: RegExpExecArray | null;

  while ((exec = DATE_PATTERN.exec(bodyText)) !== null) {
    matches.push({ match: exec, index: exec.index });
  }

  if (matches.length === 0) {
    return null;
  }

  // Try to parse the first valid date match
  for (const { match } of matches) {
    const parsed = parseDateMatch(match, fallbackYear);
    if (parsed) {
      logDebug('Visible text date found', { start: parsed.startIso, end: parsed.endIso });
      return {
        start: parsed.startIso,
        end: parsed.endIso,
        date_status: 'confirmed',
        evidence: parsed.evidence,
        evidence_context: 'visible-text',
      };
    }
  }

  return null;
};

/**
 * Extract dates from HTML using structured data, meta tags, and visible text
 * @param html - The HTML content to extract dates from
 * @returns StrictDateResult with extracted dates or TBD status
 */
export function extractStrictDates(html: string): StrictDateResult {
  logDebug('Starting strict date extraction');

  // Try JSON-LD first (most reliable)
  const jsonLd = fromJsonLd(html);
  if (jsonLd) {
    logDebug('Dates from JSON-LD');
    return jsonLd;
  }

  // Try meta tags
  const meta = fromMetaTags(html);
  if (meta) {
    logDebug('Dates from meta tags');
    return meta;
  }

  // Try visible text
  const visible = fromVisibleText(html);
  if (visible) {
    logDebug('Dates from visible text');
    return visible;
  }

  logDebug('No date evidence found, marking TBD');
  return {
    date_status: 'tbd',
  };
}

