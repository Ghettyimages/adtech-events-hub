/**
 * Event extraction agent
 * Tries LLM structured extraction first, falls back to Cheerio + LLM normalization
 */

import { llmText } from '../llm';
import { ExtractedEvent } from './schema';
import fetch from 'node-fetch';
import { parse, isValid } from 'date-fns';
import * as cheerio from 'cheerio';
import { extractFromHtml } from './extractFromHtml';
import { extractStrictDates } from './dateExtractor';
import { extractStrictLocation } from './locationExtractor';
import { getRenderedHTML } from '../render';

const MAX_HTML_LENGTH = 150000; // Truncate HTML while keeping majority of page content

type AgentRawEvent = {
  title: string;
  dates?: {
    start: string | null;
    end: string | null;
  };
  location: string | null;
  link: string | null;
  source: string | null;
  description?: string | null;
};

const systemPrompt = `You are an expert agent for extracting event details from websites. 

Mission: Read and understand the entire page (and any expanded content) to accurately extract events. Do not assume labels; confirm what each element actually represents on the page (e.g., title vs. link text, display date vs. schedule detail). Expand all relevant content first. 

Crawl & Expand: Load the page and wait for all content to render. Click buttons/links such as “Load more,” “Show more,” “Next,” or pagination controls until no new events appear. Do not open any event detail pages unless absolutely necessary when a listing card shows partial info and a “Learn more/Details” link is present. Most info should be on the URL given. If you are returning the event link as null, use the event detail page URL instead. Resolve all relative links to absolute URLs. 

Identify Event Records: An event is a single occurrence or multi-day happening with its own title and dates. Ignore ads, newsletter signups, generic category pages, venue promos, or sponsor modules. For recurring calendars, extract each distinct dated occurrence if dates differ meaningfully; otherwise, extract the primary event with its full date range. 

Field Definitions (confirm before extracting): Title — The event’s proper name, not the venue, organizer, or category label. Dates (Start and End) — The actual event dates, not posting dates, sales periods, or booking windows. Location (City, State abbreviation) — The physical event city and USPS two-letter state code (e.g., “Austin, TX”). If only city appears, set the state to null. If virtual/online only, set location to null. Link to event page — The canonical event detail URL (prefer the event’s dedicated page over listing hubs). Source — The site the event was found on: extract the core URL between https://www. and .com and capitalize appropriately (e.g., https://www.mediapost.com/events/2026/ → "MediaPost"). If the URL does not start with https://www., derive the registrable domain (e.g., events.mediapost.com → "MediaPost"). 

Normalization Rules: Dates output in the format Mon DD, YYYY (e.g., Oct 29, 2025). If only one date appears, use it for both start and end. If month/day appear without year, infer from page context; if ambiguous, set the year from the nearest explicit reference on the page; if still ambiguous, set null. Location: output as a single string "City, ST" or null. Derive USPS state from full name when needed (e.g., “California” → “CA”). Do not invent cities/states. Links: absolute HTTPS URLs only. Text: trim whitespace; remove tracking query params when clearly nonessential (e.g., utm_*, fbclid). 

Disambiguation Checks (before returning any result): For each candidate event, ask yourself: Is this really the event title (not a venue or category tag)? Are these the event dates (not deadlines, door times, or sales windows)? Is this the event page (not a category, search result, or sponsor link)? Did I fully expand lazy-loaded sections and pagination? Only include the event if all answers are confidently yes. 

Deduplication: Consider duplicates when Title + Start Date + City match; keep the most complete record. 

Output: Return a JSON array where each item is exactly this shape and order:

[ { "title": "Event Title", 

"dates": { "start": "Oct 29, 2025", "end": "Oct 29, 2025" }, 

"location": "City, ST", 

"link": "https://example.com/event-page", 

"source": "MediaPost", 

"description": "Two to three sentences summarizing what the event is, who it is for or which topics it covers, and format (e.g. conference, summit, webinar). Copy or paraphrase only from the page; use null if not clearly present." } ]

Description (no hallucination): Provide 2–3 sentences only when the page clearly states or implies them. Copy or paraphrase from visible text or meta. Do not invent speakers, agenda, or sponsors. Prefer: what the event is, who it’s for or topics, and format. Use null when not confidently available. No markdown or bullets.

CRITICAL - Multi-Day Events: Many industry events span multiple days, sometimes across different months. Always capture the FULL date range:
- Single day: { "start": "Oct 29, 2025", "end": "Oct 29, 2025" }
- Multi-day same month: { "start": "Oct 29, 2025", "end": "Oct 31, 2025" }
- Multi-day across months: { "start": "Oct 29, 2025", "end": "Nov 2, 2025" }
- Year-spanning: { "start": "Dec 28, 2025", "end": "Jan 3, 2026" }
Look for date ranges like "October 29-31", "Oct 29 - Nov 2", "October 29 to November 2", etc.

Output Rules: Use null for any field you cannot confirm after expansion and careful reading. Do not include extra fields, notes, or commentary. Do not return partial pages; finish all “Load more”/pagination first. Do not fabricate or infer beyond what the page supports. 

Error Handling: If the page lists events but none meet the confirmation checks, return an empty array []. If the site blocks expansion or detail pages cannot be opened, extract only what can be verified and set unverifiable fields to null.`;

const parseDateToISO = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const parsed = parse(value, 'MMM dd, yyyy', new Date());
  if (!isValid(parsed)) return undefined;
  // Return date-only format (YYYY-MM-DD) for all-day events
  // This allows normalization to properly detect and handle all-day events
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const deriveSourceName = (finalUrl: string, provided?: string | null): string | undefined => {
  const candidate = provided?.trim();
  if (candidate) {
    if (candidate.length <= 3) {
      return candidate.toUpperCase();
    }
    return candidate;
  }

  try {
    const host = new URL(finalUrl).hostname;
    const parts = host.split('.');
    if (parts[0] === 'www') {
      parts.shift();
    }
    if (parts.length >= 2) {
      const core = parts[parts.length - 2];
      if (core.length <= 3) {
        return core.toUpperCase();
      }
      return core.charAt(0).toUpperCase() + core.slice(1);
    }
    return host;
  } catch {
    return provided ?? undefined;
  }
};

const mapAgentEvents = (rawEvents: AgentRawEvent[], finalUrl: string): ExtractedEvent[] => {
  const seen = new Set<string>();
  const results: ExtractedEvent[] = [];

  for (const raw of rawEvents) {
    const title = raw.title?.trim();
    if (!title) continue;

    const location = raw.location?.trim() || undefined;
    const link = raw.link?.trim() || undefined;
    const startIso = parseDateToISO(raw.dates?.start ?? undefined);
    const endIso = parseDateToISO(raw.dates?.end ?? raw.dates?.start ?? undefined);
    const source = deriveSourceName(finalUrl, raw.source);

    const dedupeKey = `${title.toLowerCase()}|${startIso ?? ''}|${location ?? ''}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const description = raw.description?.trim() || undefined;
    const event: ExtractedEvent = {
      title,
      start: startIso,
      end: endIso ?? startIso,
      location,
      url: link,
      source,
      description,
      date_status: 'tbd',
      evidence: undefined,
      evidence_context: undefined,
      location_status: 'tbd',
      location_evidence: undefined,
      location_evidence_context: undefined,
    };

    results.push(event);
  }

  return results;
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

const LOCATION_PATTERN = /([A-Z][A-Za-z&'. ]+),\s*([A-Z]{2})/g;
const MAX_DATE_DISTANCE_FROM_TITLE = 240;
const STOP_TOKENS = [
  'Upcoming Events',
  'Recently Concluded',
  'Marketing',
  'Brand',
  'Email',
  'Performance',
  'Data',
  'Publishing',
  'Awards',
  'MediaPost',
  'Events Home',
];

const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC',
};

const stripHtml = (snippet: string): string =>
  snippet.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ');

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Wrap plain text as minimal HTML so strict extractors (which use body text) can run on it. Escapes HTML to avoid injecting tags. */
const wrapTextAsHtml = (text: string): string => {
  if (!text || !text.trim()) return '<html><body></body></html>';
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<html><body>${escaped}</body></html>`;
};

const sanitizeEvidenceText = (text: string, maxLen = 160): string =>
  collapseWhitespace(text).slice(0, maxLen);

const normalizeLocationText = (value: string): string | undefined => {
  if (!value) return undefined;
  let cleaned = value.replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
  cleaned = cleaned.replace(/^[-–,:•]+/, '').trim();
  if (!cleaned) return undefined;

  // Check if it's already a valid "City, ST" format - return as-is
  const validLocationPattern = /^([A-Z][A-Za-z&'\.\-]+(?:\s+[A-Z][A-Za-z&'\.\-]+)*),\s*([A-Z]{2})$/;
  if (validLocationPattern.test(cleaned)) {
    return cleaned;
  }

  // Try to extract location pattern from the text
  const locationMatch = cleaned.match(/([A-Z][A-Za-z&'\.\-]+(?:\s+[A-Z][A-Za-z&'\.\-]+)*),\s*([A-Z]{2})\b/);
  if (locationMatch) {
    const city = collapseWhitespace(locationMatch[1]);
    const state = locationMatch[2];
    return `${city}, ${state}`;
  }

  // Try spelled state
  const spelledMatch = cleaned.match(/([A-Z][A-Za-z&'\.\-]+(?:\s+[A-Z][A-Za-z&'\.\-]+)*),\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/);
  if (spelledMatch) {
    const city = collapseWhitespace(spelledMatch[1]);
    const stateName = collapseWhitespace(spelledMatch[2]).toLowerCase();
    const abbr = STATE_NAME_TO_ABBR[stateName];
    if (abbr) {
      return `${city}, ${abbr}`;
    }
  }

  for (const token of STOP_TOKENS) {
    const idx = cleaned.indexOf(token);
    if (idx > 0) {
      cleaned = cleaned.slice(0, idx).trim();
    }
  }

  if (!cleaned) return undefined;

  // Only reject if there are digits AND it doesn't look like a valid location
  // Allow digits if we can still extract a valid location pattern
  if (/\d/.test(cleaned)) {
    // Try one more time to extract location after cleaning
    const afterCleanMatch = cleaned.match(/([A-Z][A-Za-z&'\.\-]+(?:\s+[A-Z][A-Za-z&'\.\-]+)*),\s*([A-Z]{2})\b/);
    if (afterCleanMatch) {
      const city = collapseWhitespace(afterCleanMatch[1]);
      const state = afterCleanMatch[2];
      return `${city}, ${state}`;
    }
    return undefined;
  }

  const parts = cleaned.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const lastTwo = parts.slice(-2);
    cleaned = lastTwo.join(', ');
  }

  return cleaned;
};

const toLines = (snippetHtml: string): string[] => {
  const withBreaks = snippetHtml
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|dd|dt|tr|td|th|h[1-6])>/gi, '\n');

  return withBreaks
    .replace(/<[^>]+>/g, '')
    .split('\n')
    .map((line) => collapseWhitespace(line))
    .filter(Boolean);
};

const extractYearFromUrl = (url?: string): number | undefined => {
  if (!url) return undefined;
  const match = url.match(/20\d{2}/);
  if (!match) return undefined;
  const year = parseInt(match[0], 10);
  return Number.isNaN(year) ? undefined : year;
};

const extractKeywordsFromUrl = (url?: string): string[] => {
  if (!url) return [];
  try {
    const parsed = new URL(url);
    const segments = [...parsed.pathname.split('/')];
    const tokens = segments
      .flatMap((segment) =>
        segment
          .split(/[-_]/)
          .filter(Boolean)
          .map((token) => token.trim())
      )
      .filter(Boolean);

    const exclude = new Set([
      'https',
      'www',
      'events',
      'event',
      'summit',
      'conference',
      'and',
      'the',
      'media',
      'mediapost',
      'home',
      'calendar',
      'index',
      'html',
      '2025',
      '2026',
    ]);

    return tokens
      .map((token) => token.replace(/\d+/g, ''))
      .filter((token) => token.length > 2 && !exclude.has(token.toLowerCase()));
  } catch {
    return [];
  }
};

const parseDateFromLine = (
  line: string,
  fallbackYear?: number
): { result: ReturnType<typeof parseDateMatch>; match: RegExpExecArray } | null => {
  if (!line) return null;

  // Try cross-month date patterns FIRST (e.g., "October 29 - November 2, 2025")
  CROSS_MONTH_DATE_PATTERN.lastIndex = 0;
  let crossExec: RegExpExecArray | null;
  while ((crossExec = CROSS_MONTH_DATE_PATTERN.exec(line)) !== null) {
    const parsed = parseCrossMonthDateMatch(crossExec, fallbackYear);
    if (parsed) {
      return { result: parsed, match: crossExec };
    }
  }

  // Fallback to single-month date patterns
  DATE_PATTERN.lastIndex = 0;
  let exec: RegExpExecArray | null;
  while ((exec = DATE_PATTERN.exec(line)) !== null) {
    const parsed = parseDateMatch(exec, fallbackYear);
    if (parsed) {
      return { result: parsed, match: exec };
    }
  }
  return null;
};

const refineEventFromSnippet = (
  event: ExtractedEvent,
  snippetHtml: string,
  keywords: string[] = []
): ExtractedEvent | null => {
  if (!snippetHtml || !event.title) {
    return null;
  }

  const lines = toLines(snippetHtml);
  if (lines.length === 0) {
    return null;
  }

  const titleLower = event.title.toLowerCase();
  const fallbackYear = event.start ? new Date(event.start).getUTCFullYear() : undefined;
  let best: { score: number; refined: ExtractedEvent } | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.toLowerCase().includes(titleLower)) {
      continue;
    }

    const candidateLines = [
      line,
      lines[i - 2] ?? '',
      lines[i - 1] ?? '',
      lines[i + 1] ?? '',
      lines[i + 2] ?? '',
      lines[i + 3] ?? '',
      lines[i + 4] ?? '',
    ];

    let dateParse: ReturnType<typeof parseDateFromLine> | null = null;
    let dateLineIndex = -1;

    for (let j = 0; j < candidateLines.length; j += 1) {
      dateParse = parseDateFromLine(candidateLines[j], fallbackYear);
      if (dateParse) {
        dateLineIndex = j;
        break;
      }
    }

    if (!dateParse || !dateParse.result) {
      continue;
    }

    const evidence = collapseWhitespace(dateParse.result.evidence);
    let locationCandidate: string | undefined;

    // First, try to find location pattern in the candidate lines (most reliable)
    // Scan all candidate lines for "City, ST" or "City, State" patterns
    for (const candidateLine of candidateLines) {
      if (!candidateLine) continue;
      
      // Try standard location pattern: "City, ST"
      const locationMatch = candidateLine.match(/([A-Z][A-Za-z&'\.\-]+(?:\s+[A-Z][A-Za-z&'\.\-]+)*),\s*([A-Z]{2})\b/);
      if (locationMatch) {
        const city = collapseWhitespace(locationMatch[1]);
        const state = locationMatch[2];
        locationCandidate = `${city}, ${state}`;
        break;
      }
      
      // Try spelled state: "City, State"
      const spelledMatch = candidateLine.match(/([A-Z][A-Za-z&'\.\-]+(?:\s+[A-Z][A-Za-z&'\.\-]+)*),\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/);
      if (spelledMatch) {
        const city = collapseWhitespace(spelledMatch[1]);
        const stateName = collapseWhitespace(spelledMatch[2]).toLowerCase();
        const abbr = STATE_NAME_TO_ABBR[stateName];
        if (abbr) {
          locationCandidate = `${city}, ${abbr}`;
          break;
        }
      }
    }

    // Fallback: look for dash-separated location at end of line
    if (!locationCandidate) {
      const dashMatch = line.match(/[–-]\s*(.+)$/);
      if (dashMatch) {
        locationCandidate = dashMatch[1];
      }
    }

    // Fallback: look for text after date evidence
    if (!locationCandidate && dateLineIndex >= 0) {
      const sourceLine = candidateLines[dateLineIndex];
      const evidenceIndex = sourceLine.toLowerCase().indexOf(evidence.toLowerCase());
      if (evidenceIndex !== -1) {
        // Look further ahead for location after date (increased from unlimited to 300 chars)
        const afterDate = sourceLine.slice(evidenceIndex + evidence.length, evidenceIndex + evidence.length + 300).trim();
        if (afterDate) {
          // Try to extract location from the text after date
          const afterDateLocationMatch = afterDate.match(/([A-Z][A-Za-z&'\.\-]+(?:\s+[A-Z][A-Za-z&'\.\-]+)*),\s*([A-Z]{2})\b/);
          if (afterDateLocationMatch) {
            const city = collapseWhitespace(afterDateLocationMatch[1]);
            const state = afterDateLocationMatch[2];
            locationCandidate = `${city}, ${state}`;
          } else {
            // Try spelled state
            const afterDateSpelledMatch = afterDate.match(/([A-Z][A-Za-z&'\.\-]+(?:\s+[A-Z][A-Za-z&'\.\-]+)*),\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/);
            if (afterDateSpelledMatch) {
              const city = collapseWhitespace(afterDateSpelledMatch[1]);
              const stateName = collapseWhitespace(afterDateSpelledMatch[2]).toLowerCase();
              const abbr = STATE_NAME_TO_ABBR[stateName];
              if (abbr) {
                locationCandidate = `${city}, ${abbr}`;
              } else {
                locationCandidate = afterDate;
              }
            } else {
              locationCandidate = afterDate;
            }
          }
        }
      }
    }

    // Fallback: check next few lines (expanded from 1 to 3 lines)
    if (!locationCandidate) {
      for (let nextLineIdx = i + 1; nextLineIdx <= i + 3 && nextLineIdx < lines.length; nextLineIdx++) {
        if (lines[nextLineIdx]) {
          locationCandidate = lines[nextLineIdx];
          break;
        }
      }
    }

    // Normalize the location candidate
    const normalizedLocation = locationCandidate
      ? (locationCandidate.match(/^([A-Z][A-Za-z&'\.\-]+(?:\s+[A-Z][A-Za-z&'\.\-]+)*),\s*([A-Z]{2})$/) 
          ? locationCandidate 
          : normalizeLocationText(locationCandidate))
      : undefined;

    const refined: ExtractedEvent = {
      ...event,
      start: dateParse.result.startIso,
      end: dateParse.result.endIso ?? dateParse.result.startIso,
      date_status: 'confirmed',
      evidence,
      evidence_context: 'visible-text',
    };

    if (normalizedLocation) {
      refined.location = normalizedLocation;
      refined.location_status = 'confirmed';
      refined.location_evidence = normalizedLocation;
      refined.location_evidence_context = 'visible-text';
    } else {
      refined.location_status = 'tbd';
      refined.location = undefined;
      refined.location_evidence = undefined;
      refined.location_evidence_context = undefined;
    }

    let score = 0;
    if (!normalizedLocation) {
      score += 50;
    }
    if (event.start) {
      const originalDate = new Date(event.start);
      const parsedDate = new Date(refined.start ?? event.start);
      const dayDiff = Math.abs(
        Math.round((parsedDate.getTime() - originalDate.getTime()) / (24 * 60 * 60 * 1000))
      );
      score += Math.min(dayDiff, 30);
    }
    if (keywords.length > 0) {
      const lineLower = [line, candidateLines[dateLineIndex] ?? '', lines[i + 1] ?? '']
        .join(' ')
        .toLowerCase();
      const missing = keywords.filter(
        (keyword) => keyword && !lineLower.includes(keyword.toLowerCase())
      ).length;
      score += missing * 10;
    }
    if (refined.location && event.location && refined.location !== event.location) {
      score += 5;
    }

    if (!best || score < best.score) {
      best = { score, refined };
    }
  }

  return best?.refined ?? null;
};

const findElementHtmlCandidatesForTitle = (
  dom: cheerio.CheerioAPI,
  title: string,
  keywords: string[] = [],
  expectedYear?: number,
  limit = 6
): Array<{ html: string; score: number }> => {
  if (!title) return [];
  const titleLower = title.toLowerCase();
  const candidates: Array<{ html: string; score: number }> = [];

  const selectors = ['a', 'strong', 'dd', 'li', 'p', 'span', 'div'];

  selectors.forEach((selector) => {
    dom(selector).each((_, el) => {
      const text = dom(el).text();
      if (!text) return;
      const plain = collapseWhitespace(text.replace(/&nbsp;/gi, ' '));
      if (!plain.toLowerCase().includes(titleLower)) return;

      const container = dom(el).closest('dd, li, p, div').length
        ? dom(el).closest('dd, li, p, div')
        : dom(el);
      const containerHtml = dom.html(container) ?? dom.html(el) ?? null;
      if (!containerHtml) return;
      const containerText = collapseWhitespace(stripHtml(containerHtml));
      const containerTextLower = containerText.toLowerCase();
      const hasStateLocation = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2}/.test(containerText);
      DATE_PATTERN.lastIndex = 0;
      const hasDate = DATE_PATTERN.test(containerText);
      const keywordPenalty =
        keywords.length > 0
          ? keywords.filter((keyword) => keyword && !containerTextLower.includes(keyword.toLowerCase())).length
          : 0;
      const yearPenalty =
        expectedYear != null && containerText && !containerText.includes(String(expectedYear)) ? 1 : 0;

      const score =
        (Math.abs(plain.length - title.length)) +
        (plain.length > 200 ? 50 : 0) +
        (containerText.length > 300 ? 20 : 0) +
        (hasDate ? 0 : 20) +
        (hasStateLocation ? -10 : 10) +
        keywordPenalty * 15 +
        yearPenalty * 10;

      candidates.push({ html: containerHtml, score });
    });
  });

  return candidates
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
};

const getContextSnippet = (
  html: string,
  title: string,
  windowSize = 2400,  // Increased from 1200 to 2400 for better location detection
  expectedYear?: number,
  keywords?: string[]
) => {
  const lowerHtml = html.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const bodyIndex = lowerHtml.indexOf('<body');
  const occurrences: Array<{
    index: number;
    plain: string;
    titleIndex: number;
    yearPenalty: number;
    datePenalty: number;
    keywordPenalty: number;
    locationPenalty: number;
    headPenalty: number;
    titlePenalty: number;
    snippetHtml: string;
  }> = [];

  let searchIndex = 0;
  let index = lowerHtml.indexOf(lowerTitle, searchIndex);

  while (index !== -1) {
    const start = Math.max(0, index - windowSize);
    const end = Math.min(html.length, index + lowerTitle.length + windowSize);
    const snippetHtml = html.slice(start, end);
    const plain = collapseWhitespace(stripHtml(snippetHtml));
    const plainLower = plain.toLowerCase();
    const titleIndex = plainLower.indexOf(lowerTitle);

    const yearPenalty =
      expectedYear != null
        ? plain.includes(String(expectedYear))
          ? 0
          : plain.includes(String(expectedYear - 1)) ||
              plain.includes(String(expectedYear + 1))
            ? 1
            : 2
        : 0;

    DATE_PATTERN.lastIndex = 0;
    const hasDate = DATE_PATTERN.test(plain);
    const datePenalty = hasDate ? 0 : 1;
    let keywordPenalty = 0;
    if (keywords && keywords.length > 0) {
      const lowerPlain = plain.toLowerCase();
      const missing = keywords.filter(
        (keyword) => keyword && !lowerPlain.includes(keyword.toLowerCase())
      ).length;
      keywordPenalty = missing;
    }
    const hasStateLocation = /[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2}/.test(plain);
    const locationPenalty = hasStateLocation ? 0 : 1;
    const headPenalty = bodyIndex !== -1 && index < bodyIndex ? 5 : 0;

    const titlePenalty = titleIndex === -1 ? 5 : 0;

    occurrences.push({
      index,
      plain,
      titleIndex,
      yearPenalty,
      datePenalty,
      headPenalty,
      keywordPenalty,
      locationPenalty,
      titlePenalty,
      snippetHtml,
    });

    searchIndex = index + lowerTitle.length;
    index = lowerHtml.indexOf(lowerTitle, searchIndex);
  }

  if (occurrences.length === 0) {
    return null;
  }

  occurrences.sort((a, b) => {
    if (a.yearPenalty !== b.yearPenalty) {
      return a.yearPenalty - b.yearPenalty;
    }
    if (a.datePenalty !== b.datePenalty) {
      return a.datePenalty - b.datePenalty;
    }
    if (a.keywordPenalty !== b.keywordPenalty) {
      return a.keywordPenalty - b.keywordPenalty;
    }
    if (a.headPenalty !== b.headPenalty) {
      return a.headPenalty - b.headPenalty;
    }
    if (a.locationPenalty !== b.locationPenalty) {
      return a.locationPenalty - b.locationPenalty;
    }
    if (a.titlePenalty !== b.titlePenalty) {
      return a.titlePenalty - b.titlePenalty;
    }
    return a.index - b.index;
  });

  const best = occurrences[0];

  return {
    plain: best.plain,
    titleIndex: best.titleIndex,
    snippetHtml: best.snippetHtml,
  };
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

  const evidence = collapseWhitespace(match[0]);

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

  const evidence = collapseWhitespace(match[0]);

  return {
    startIso,
    endIso,
    evidence,
  };
};

const findBestDate = (
  plainSnippet: string,
  titleIndex: number,
  fallbackIso?: string
): { startIso: string; endIso: string; evidence: string } | null => {
  const fallbackYear = fallbackIso ? new Date(fallbackIso).getUTCFullYear() : undefined;

  // Try cross-month date patterns FIRST (e.g., "October 29 - November 2, 2025")
  const crossMonthMatches: Array<{ match: RegExpExecArray; distance: number }> = [];
  let crossExec: RegExpExecArray | null;

  CROSS_MONTH_DATE_PATTERN.lastIndex = 0;
  while ((crossExec = CROSS_MONTH_DATE_PATTERN.exec(plainSnippet)) !== null) {
    const distance = titleIndex >= 0 ? Math.abs(crossExec.index - titleIndex) : crossExec.index;
    if (titleIndex >= 0 && distance > MAX_DATE_DISTANCE_FROM_TITLE) {
      continue;
    }
    crossMonthMatches.push({ match: crossExec, distance });
  }

  if (crossMonthMatches.length > 0) {
    crossMonthMatches.sort((a, b) => a.distance - b.distance);

    for (const candidate of crossMonthMatches) {
      const parsed = parseCrossMonthDateMatch(candidate.match, fallbackYear);
      if (parsed) {
        return parsed;
      }
    }
  }

  // Fallback to single-month date patterns
  const matches: Array<{ match: RegExpExecArray; distance: number }> = [];
  let exec: RegExpExecArray | null;

  DATE_PATTERN.lastIndex = 0;
  while ((exec = DATE_PATTERN.exec(plainSnippet)) !== null) {
    const distance = titleIndex >= 0 ? Math.abs(exec.index - titleIndex) : exec.index;
    if (titleIndex >= 0 && distance > MAX_DATE_DISTANCE_FROM_TITLE) {
      continue;
    }
    matches.push({ match: exec, distance });
  }

  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) => a.distance - b.distance);

  for (const candidate of matches) {
    const parsed = parseDateMatch(candidate.match, fallbackYear);
    if (parsed) {
      return parsed;
    }
  }

  return null;
};

const findBestLocation = (
  plainSnippet: string,
  titleIndex: number
): { location?: string; evidence?: string } => {
  if (titleIndex >= 0) {
    const afterTitle = plainSnippet.slice(titleIndex);
    const separators = [' – ', ' — ', ' - '];
    for (const separator of separators) {
      const sepIndex = afterTitle.indexOf(separator);
      if (sepIndex !== -1 && sepIndex < 200) {  // Increased from 120 to 200
        const remainder = afterTitle.slice(sepIndex + separator.length, sepIndex + separator.length + 250);  // Increased from 150 to 250
        const directMatch = remainder.match(/([A-Z][A-Za-z&'. ]+,\s*[A-Z]{2})/);
        if (directMatch) {
          const location = collapseWhitespace(directMatch[1]);
          return { location, evidence: location };
        }

        const spelledMatch = remainder.match(/([A-Z][A-Za-z&'. ]+),\s+([A-Za-z ]{2,})/);
        if (spelledMatch) {
          const city = collapseWhitespace(spelledMatch[1]);
          const stateName = collapseWhitespace(spelledMatch[2]).toLowerCase();
          const abbr = STATE_NAME_TO_ABBR[stateName];
          if (abbr) {
            const evidence = `${city}, ${abbr}`;
            return { location: evidence, evidence };
          }
        }
      }
    }
  }

  const matches: Array<{ city: string; state: string; evidence: string; index: number }> = [];
  let exec: RegExpExecArray | null;

  LOCATION_PATTERN.lastIndex = 0;
  while ((exec = LOCATION_PATTERN.exec(plainSnippet)) !== null) {
    const city = collapseWhitespace(exec[1]);
    const state = exec[2];
    matches.push({ city, state, evidence: collapseWhitespace(exec[0]), index: exec.index });
  }

  if (matches.length > 0) {
    const prioritizeAfter = titleIndex >= 0;
    const filtered = prioritizeAfter
      ? matches.filter((item) => item.index >= titleIndex)
      : matches;
    const candidateList = filtered.length > 0 ? filtered : matches;

    const chosen = candidateList
      .map((item) => ({
        ...item,
        distance: titleIndex >= 0 ? Math.abs(item.index - titleIndex) : item.index,
      }))
      .sort((a, b) => a.distance - b.distance)[0];

    const location = `${chosen.city}, ${chosen.state}`;
    return { location, evidence: chosen.evidence };
  }

  const spelledMatches: Array<{ city: string; stateName: string; evidence: string; index: number }> = [];
  const spelledPattern = /([A-Z][A-Za-z&'. ]+),\s+([A-Za-z ]{2,})/g;
  let spelledExec: RegExpExecArray | null;
  while ((spelledExec = spelledPattern.exec(plainSnippet)) !== null) {
    spelledMatches.push({
      city: collapseWhitespace(spelledExec[1]),
      stateName: collapseWhitespace(spelledExec[2]).toLowerCase(),
      evidence: collapseWhitespace(spelledExec[0]),
      index: spelledExec.index,
    });
  }

  if (spelledMatches.length > 0) {
    const candidate = spelledMatches
      .map((item) => ({
        ...item,
        distance: titleIndex >= 0 ? Math.abs(item.index - titleIndex) : item.index,
      }))
      .sort((a, b) => a.distance - b.distance)[0];

    const abbr = STATE_NAME_TO_ABBR[candidate.stateName];
    if (abbr) {
      return {
        location: `${candidate.city}, ${abbr}`,
        evidence: candidate.evidence,
      };
    }
  }

  return {};
};

const verifyWithContext = (
  event: ExtractedEvent,
  html: string,
  dom: cheerio.CheerioAPI
): ExtractedEvent => {
  // eslint-disable-next-line no-console
  console.log('[extractor] verifyWithContext called for', event.title, 'location:', event.location);
  const startDate = event.start ? new Date(event.start) : null;
  const expectedYear = startDate && !Number.isNaN(startDate.getTime())
    ? startDate.getUTCFullYear()
    : extractYearFromUrl(event.url);
  const keywords: string[] = [];
  if (event.location && event.location_status === 'confirmed') {
    const parts = event.location
      .split(/[,\s]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 2);
    keywords.push(...parts);
  }
  const slugKeywords = extractKeywordsFromUrl(event.url);
  if (slugKeywords.length > 0) {
    keywords.push(...slugKeywords);
  }

  const directCandidates = findElementHtmlCandidatesForTitle(dom, event.title, keywords, expectedYear);
  if (directCandidates.length > 0) {
    let bestDirect: { refined: ExtractedEvent; score: number } | null = null;
    for (const candidate of directCandidates) {
      const refined = refineEventFromSnippet(event, candidate.html, keywords);
      if (!refined) continue;

      let score = candidate.score;
      if (event.start && refined.start) {
        const original = new Date(event.start);
        const parsed = new Date(refined.start);
        const diffDays = Math.round(
          Math.abs(parsed.getTime() - original.getTime()) / (24 * 60 * 60 * 1000)
        );
        score += Math.min(diffDays, 60);
      }
      if (event.location && refined.location && event.location !== refined.location) {
        score += 10;
      }
      if (bestDirect == null || score < bestDirect.score) {
        bestDirect = { refined, score };
      }
    }
    if (bestDirect) {
      return bestDirect.refined;
    }
  }

  const context = getContextSnippet(html, event.title, 3000, expectedYear, keywords);  // Increased from 1800 to 3000
  if (!context) {
    // No HTML context: do not confirm dates/location without evidence. Use description as evidence when present.
    let verifiedLocationStatus = event.location_status ?? 'tbd';
    if (event.location && event.location_status === 'confirmed') {
      const locationLower = event.location.toLowerCase().trim();
      const htmlLower = html.toLowerCase();
      if (!htmlLower.includes(locationLower)) {
        verifiedLocationStatus = 'tbd';
      }
    } else if (!event.location) {
      verifiedLocationStatus = 'tbd';
    }

    const noContextResult: ExtractedEvent = {
      ...event,
      date_status: 'tbd',
      location_status: verifiedLocationStatus,
      location: verifiedLocationStatus === 'tbd' ? undefined : event.location,
      location_evidence: verifiedLocationStatus === 'tbd' ? undefined : event.location_evidence,
      location_evidence_context: verifiedLocationStatus === 'tbd' ? undefined : event.location_evidence_context,
    };

    if (event.description?.trim()) {
      const descHtml = wrapTextAsHtml(event.description);
      const strictDates = extractStrictDates(descHtml);
      if (strictDates.date_status === 'confirmed' && strictDates.start) {
        noContextResult.start = strictDates.start;
        noContextResult.end = strictDates.end ?? strictDates.start;
        noContextResult.date_status = 'confirmed';
        noContextResult.evidence = strictDates.evidence ?? sanitizeEvidenceText(event.description);
        noContextResult.evidence_context = 'description';
      }
      if (noContextResult.location_status === 'tbd') {
        const strictLoc = extractStrictLocation(descHtml, event.url);
        if (strictLoc.location_status === 'confirmed' && strictLoc.location) {
          noContextResult.location = strictLoc.location;
          noContextResult.location_status = 'confirmed';
          noContextResult.location_evidence = strictLoc.location_evidence ?? sanitizeEvidenceText(event.description);
          noContextResult.location_evidence_context = 'description';
        }
      }
    }

    return noContextResult;
  }

  if (process.env.DEBUG_EXTRACTOR === '1') {
    // eslint-disable-next-line no-console
    console.debug('[extractor] context snippet', event.title, '→', context.plain.slice(0, 240));
  }

  const refinedFromSnippet = refineEventFromSnippet(event, context.snippetHtml, keywords);
  let useRefinedSnippet = false;
  if (refinedFromSnippet) {
    // eslint-disable-next-line no-console
    console.log('[extractor] refined from snippet', refinedFromSnippet.title, 'location:', refinedFromSnippet.location, 'status:', refinedFromSnippet.location_status);
    // If refineEventFromSnippet found a location, use it and return early
    if (refinedFromSnippet.location && refinedFromSnippet.location_status === 'confirmed') {
      // eslint-disable-next-line no-console
      console.log('[extractor] Returning early with refined snippet location');
      return refinedFromSnippet;
    }
    // If refineEventFromSnippet found dates but no location, merge with location verification below
    useRefinedSnippet = true;
    // eslint-disable-next-line no-console
    console.log('[extractor] Continuing to location verification (refined snippet had no location)');
  }

  const { plain, titleIndex, snippetHtml } = context;
  // eslint-disable-next-line no-console
  console.log('[extractor] Processing context, event.location:', event.location);
  let dateInfo: { startIso: string; endIso: string; evidence?: string } | null = findBestDate(plain, titleIndex, event.start);
  let dateInfoEvidenceContext: string = 'visible-text';

  if (snippetHtml) {
    const strict = extractStrictDates(snippetHtml);
    if (strict.date_status === 'confirmed' && strict.start) {
      dateInfo = {
        startIso: strict.start,
        endIso: strict.end ?? strict.start,
        evidence: strict.evidence ?? collapseWhitespace(stripHtml(snippetHtml)).slice(0, 120),
      };
    }
  }

  if (!dateInfo && event.description?.trim()) {
    const strictFromDesc = extractStrictDates(wrapTextAsHtml(event.description));
    if (strictFromDesc.date_status === 'confirmed' && strictFromDesc.start) {
      dateInfo = {
        startIso: strictFromDesc.start,
        endIso: strictFromDesc.end ?? strictFromDesc.start,
        evidence: strictFromDesc.evidence ?? sanitizeEvidenceText(event.description),
      };
      dateInfoEvidenceContext = 'description';
    }
  }

  // Use strict location extractor (similar to dates)
  // Try both snippet HTML and full HTML for better coverage
  let locationInfo: { location?: string; location_status: 'confirmed' | 'tbd'; location_evidence?: string; location_evidence_context?: string } = {
    location_status: 'tbd',
  };
  // eslint-disable-next-line no-console
  console.log('[extractor] Starting location extraction, event.location:', event.location);

  // First, try strict extractor on snippet HTML (most relevant context)
  if (snippetHtml) {
    const strictLocation = extractStrictLocation(snippetHtml, event.url);
    if (strictLocation.location_status === 'confirmed' && strictLocation.location) {
      locationInfo = {
        location: strictLocation.location,
        location_status: 'confirmed',
        location_evidence: strictLocation.location_evidence,
        location_evidence_context: strictLocation.location_evidence_context,
      };
    }
  }

  // If snippet didn't work, try full HTML
  if (locationInfo.location_status === 'tbd') {
    const strictLocationFull = extractStrictLocation(html, event.url);
    if (strictLocationFull.location_status === 'confirmed' && strictLocationFull.location) {
      locationInfo = {
        location: strictLocationFull.location,
        location_status: 'confirmed',
        location_evidence: strictLocationFull.location_evidence,
        location_evidence_context: strictLocationFull.location_evidence_context,
      };
    }
  }

  // Fallback to regex-based findBestLocation if strict extractor found nothing
  if (locationInfo.location_status === 'tbd' && snippetHtml) {
    const fallbackLocation = findBestLocation(plain, titleIndex);
    if (fallbackLocation.location) {
      // Verify fallback location appears in HTML before confirming
      const locationLower = fallbackLocation.location.toLowerCase();
      const htmlLower = html.toLowerCase();
      if (htmlLower.includes(locationLower)) {
        locationInfo = {
          location: fallbackLocation.location,
          location_status: 'confirmed',
          location_evidence: fallbackLocation.evidence ?? fallbackLocation.location,
          location_evidence_context: 'visible-text',
        };
      }
    }
  }

  if (locationInfo.location_status === 'tbd' && event.description?.trim()) {
    const strictLocFromDesc = extractStrictLocation(wrapTextAsHtml(event.description), event.url);
    if (strictLocFromDesc.location_status === 'confirmed' && strictLocFromDesc.location) {
      locationInfo = {
        location: strictLocFromDesc.location,
        location_status: 'confirmed',
        location_evidence: strictLocFromDesc.location_evidence ?? sanitizeEvidenceText(event.description),
        location_evidence_context: 'description',
      };
    }
  }

  // Verify LLM-extracted location against HTML evidence (even if status is 'tbd')
  // This is important because mapAgentEvents sets all locations to 'tbd' by default
  if (event.location) {
    const eventLocationLower = event.location.toLowerCase().trim();
    const htmlLower = html.toLowerCase();
    
    // eslint-disable-next-line no-console
    console.log('[extractor] Verifying LLM location', event.location, 'in HTML (length:', html.length, ')');
    
    // Check if the LLM-extracted location appears in the HTML
    // Use flexible matching: check for city, state separately, and full location
    const locationParts = eventLocationLower.split(',').map(p => p.trim()).filter(Boolean);
    const city = locationParts[0] || '';
    const state = locationParts[1] || '';
    
    // Check for full location match (exact)
    const fullLocationMatch = htmlLower.includes(eventLocationLower);
    
    // Check for city, state pattern (e.g., "City, ST" or "City, State")
    // This handles cases where venue names precede the location
    const cityStatePattern = city && state ? 
      new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^,]*,\\s*${state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') :
      null;
    const cityStatePatternMatch = cityStatePattern ? cityStatePattern.test(htmlLower) : false;
    
    // Check for city + state separately (more flexible) - they can be anywhere in the HTML
    const cityStateMatch = city && state && 
      htmlLower.includes(city) && 
      (htmlLower.includes(`, ${state}`) || htmlLower.includes(` ${state}`) || htmlLower.includes(`(${state})`));
    
    // Check for partial matches (city only with state abbreviation nearby)
    // Look for city followed by state within reasonable distance (e.g., "City, ST" or "City (ST)")
    const cityStateNearby = city && state && state.length === 2 ? 
      new RegExp(`${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^,]{0,50},?\\s*${state.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(htmlLower) :
      false;
    
    const locationInHtml = fullLocationMatch || cityStatePatternMatch || cityStateMatch || cityStateNearby;
    
    // eslint-disable-next-line no-console
    console.log('[extractor] Location match results', {
      location: event.location,
      fullLocationMatch,
      cityStatePatternMatch,
      cityStateMatch,
      cityStateNearby,
      locationInHtml,
      city,
      state,
    });
    
    // Also check if strict extractor found a matching location
    const strictLocationSnippet = snippetHtml ? extractStrictLocation(snippetHtml, event.url) : null;
    const strictLocationFull = extractStrictLocation(html, event.url);
    const strictLocation = strictLocationSnippet?.location_status === 'confirmed' ? strictLocationSnippet : strictLocationFull;
    
    if (process.env.DEBUG_EXTRACTOR === '1') {
      // eslint-disable-next-line no-console
      console.debug('[extractor] Strict location extractor results', {
        snippet: strictLocationSnippet?.location,
        full: strictLocationFull?.location,
        chosen: strictLocation?.location,
      });
    }
    
    const strictMatch = strictLocation?.location_status === 'confirmed' && 
      strictLocation.location?.toLowerCase().trim() === eventLocationLower;
    
    // Also check for partial match with strict extractor (city matches)
    const strictPartialMatch = strictLocation?.location_status === 'confirmed' && 
      strictLocation.location && city &&
      strictLocation.location.toLowerCase().includes(city);
    
    if (!locationInHtml && !strictMatch && !strictPartialMatch) {
      // LLM hallucinated location - mark as TBD
      if (process.env.DEBUG_EXTRACTOR === '1') {
        // eslint-disable-next-line no-console
        console.debug('[extractor] LLM location not found in HTML, marking TBD', event.location);
      }
      // Don't clear event.location here - let it be handled by the final assignment
    } else if (strictMatch && strictLocation) {
      // Use strict extractor's location and evidence (exact match)
      if (process.env.DEBUG_EXTRACTOR === '1') {
        // eslint-disable-next-line no-console
        console.debug('[extractor] Using strict extractor location (exact match)', strictLocation.location);
      }
      locationInfo = {
        location: strictLocation.location,
        location_status: 'confirmed',
        location_evidence: strictLocation.location_evidence,
        location_evidence_context: strictLocation.location_evidence_context,
      };
    } else if (strictPartialMatch && strictLocation) {
      // Use strict extractor's location (partial match - strict extractor is more reliable)
      if (process.env.DEBUG_EXTRACTOR === '1') {
        // eslint-disable-next-line no-console
        console.debug('[extractor] Using strict extractor location (partial match)', strictLocation.location);
      }
      locationInfo = {
        location: strictLocation.location,
        location_status: 'confirmed',
        location_evidence: strictLocation.location_evidence,
        location_evidence_context: strictLocation.location_evidence_context,
      };
    } else if (locationInHtml) {
      // LLM location found in HTML, use it
      if (process.env.DEBUG_EXTRACTOR === '1') {
        // eslint-disable-next-line no-console
        console.debug('[extractor] Using LLM location (found in HTML)', event.location);
      }
      locationInfo = {
        location: event.location,
        location_status: 'confirmed',
        location_evidence: event.location_evidence ?? event.location,
        location_evidence_context: event.location_evidence_context ?? 'visible-text',
      };
    }
  }

  // Start with refined snippet data if available, otherwise use original event
  const next: ExtractedEvent = useRefinedSnippet && refinedFromSnippet 
    ? { ...refinedFromSnippet }
    : { ...event };

  // Override dates with dateInfo if available (from strict extractor or findBestDate)
  if (dateInfo) {
    // Check if LLM detected a multi-day event but regex collapsed it to single-day
    const llmStartDate = event.start ? new Date(event.start) : null;
    const llmEndDate = event.end ? new Date(event.end) : null;
    const regexStartDate = new Date(dateInfo.startIso);
    const regexEndDate = new Date(dateInfo.endIso);
    
    const llmIsMultiDay = llmStartDate && llmEndDate && 
      llmEndDate.getTime() > llmStartDate.getTime() + (24 * 60 * 60 * 1000);
    const regexIsSingleDay = dateInfo.startIso === dateInfo.endIso || 
      (regexEndDate.getTime() - regexStartDate.getTime()) < (24 * 60 * 60 * 1000);
    
    // Also check if the LLM start date matches (or is very close to) the regex start date
    const startDatesMatch = llmStartDate && 
      Math.abs(llmStartDate.getTime() - regexStartDate.getTime()) < (2 * 24 * 60 * 60 * 1000); // within 2 days
    
    if (llmIsMultiDay && regexIsSingleDay && startDatesMatch) {
      // Preserve LLM's end date, but use regex start date (regex is usually more accurate for start)
      if (process.env.DEBUG_EXTRACTOR === '1') {
        // eslint-disable-next-line no-console
        console.debug('[extractor] Preserving LLM multi-day end date', {
          llmStart: event.start,
          llmEnd: event.end,
          regexStart: dateInfo.startIso,
          regexEnd: dateInfo.endIso,
        });
      }
      next.start = dateInfo.startIso;
      next.end = event.end; // Keep LLM's multi-day end date
      next.evidence = `${dateInfo.evidence} (multi-day event)`;
      next.evidence_context = dateInfoEvidenceContext;
      next.date_status = 'confirmed';
    } else {
      // Normal case: use regex dates
      next.start = dateInfo.startIso;
      next.end = dateInfo.endIso;
      next.evidence = dateInfo.evidence;
      next.evidence_context = dateInfoEvidenceContext;
      next.date_status = 'confirmed';
    }
  } else if (!useRefinedSnippet) {
    // Only clear dates if we're not using refined snippet (which already has dates)
    next.start = undefined;
    next.end = undefined;
    next.date_status = 'tbd';
    next.evidence = undefined;
    next.evidence_context = undefined;
  }

  // Apply location info from strict extractor or verified LLM extraction
  if (locationInfo.location_status === 'confirmed' && locationInfo.location) {
    next.location = locationInfo.location;
    next.location_evidence = locationInfo.location_evidence;
    next.location_evidence_context = locationInfo.location_evidence_context;
    next.location_status = 'confirmed';
  } else {
    // No confirmed location found
    next.location = undefined;
    next.location_status = 'tbd';
    next.location_evidence = undefined;
    next.location_evidence_context = undefined;
  }

  return next;
};

const ensureDateEvidence = (
  events: ExtractedEvent[],
  html: string,
  dom: cheerio.CheerioAPI
): ExtractedEvent[] => events.map((event) => verifyWithContext(event, html, dom));

const sanitizeResponse = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    const withoutFence = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/, '');
    return withoutFence.trim();
  }
  return trimmed;
};

const runAgent = async (system: string, user: string): Promise<AgentRawEvent[]> => {
  try {
    const response = await llmText({
      system,
      user,
    });
    const cleaned = sanitizeResponse(response);
    if (process.env.DEBUG_EXTRACTOR === '1') {
      // eslint-disable-next-line no-console
      console.debug('[extractor] raw agent response', cleaned);
    }
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed as AgentRawEvent[];
    }
    console.warn('[extractor] agent returned non-array JSON');
    return [];
  } catch (error: any) {
    console.warn('[extractor] agent parsing failed', error?.message ?? error);
    return [];
  }
};

/**
 * Extract events from a URL using AI-powered extraction
 */
export async function extractEventsFromUrl(
  url: string,
  hint?: string,
  overrideHtml?: string
): Promise<{ events: ExtractedEvent[] }> {
  try {
    let finalUrl = url;
    let html = overrideHtml;

    if (!html) {
      // Try browser automation first (Playwright) for full JavaScript rendering
      try {
        console.log(`[extractor] Attempting browser automation for ${url}`);
        const rendered = await getRenderedHTML(url, {
          maxLoads: 3,
          waitMs: 1200,
          timeoutMs: 60000,
        });
        finalUrl = rendered.finalURL;
        html = rendered.html;
        console.log(`[extractor] Browser automation successful, got ${html.length} bytes of HTML`);
      } catch (browserError: any) {
        // Fallback to simple fetch if browser automation fails
        console.warn(`[extractor] Browser automation failed, falling back to fetch: ${browserError.message}`);
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        } as any);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        finalUrl = response.url || url;
        html = await (response as any).text();
      }
    }

    if (!html) {
      throw new Error('Failed to load page HTML');
    }

    const truncatedHtml = html.substring(0, MAX_HTML_LENGTH);
    const dom = cheerio.load(html) as cheerio.CheerioAPI;

    let rawEvents: AgentRawEvent[] = [];

    rawEvents = await runAgent(
      systemPrompt,
      `URL: ${finalUrl}
${hint ? `Hint: ${hint}\n` : ''}

HTML:
${truncatedHtml}`
    );

    if (!rawEvents || rawEvents.length === 0) {
      const roughRows = extractFromHtml(html, finalUrl);
      if (roughRows.length > 0) {
        rawEvents = await runAgent(
          systemPrompt,
          `The page HTML produced the following structured rows. Convert them into confirmed events following all rules:
${JSON.stringify(roughRows.slice(0, 25), null, 2)}`
        );
      }
    }

    const mappedEvents = mapAgentEvents(rawEvents ?? [], finalUrl);
    const events = ensureDateEvidence(mappedEvents, html, dom);
    return { events };
  } catch (error: any) {
    throw new Error(`Failed to extract events from ${url}: ${error.message}`);
  }
}

