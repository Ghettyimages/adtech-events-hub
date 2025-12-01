import * as cheerio from 'cheerio';

export type StrictLocationStatus = 'confirmed' | 'tbd';

export type StrictLocationResult = {
  location?: string;
  location_status: StrictLocationStatus;
  location_evidence?: string;
  location_evidence_context?: string;
};

const STATE_ABBREVIATIONS = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

const STATE_NAMES = new Set([
  'alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware',
  'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky',
  'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi',
  'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico',
  'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania',
  'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont',
  'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming',
]);

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

const LOCATION_REGEX = /([A-Z][A-Za-z'&\.\-]+(?:\s+[A-Z][A-Za-z'&\.\-]+)*),\s*([A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/;
const DEBUG = process.env.DEBUG_EXTRACTOR === '1';

const logDebug = (...args: any[]) => {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.debug('[strict-location]', ...args);
  }
};

const sanitizeEvidence = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 160);

const fromJsonLd = (html: string): StrictLocationResult | null => {
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

        const loc = item.location;
        if (loc) {
          if (typeof loc === 'string') {
            logDebug('JSON-LD location string found', loc);
            return {
              location: loc,
              location_status: 'confirmed',
              location_evidence: sanitizeEvidence(loc),
              location_evidence_context: 'json-ld',
            };
          }

          if (typeof loc === 'object') {
            const name = loc.name || (loc.address && loc.address.addressLocality);
            const state = loc.address && loc.address.addressRegion;
            const combined = [name, state].filter(Boolean).join(', ');
            const location = combined || name || state;
            if (location) {
              const evidence = sanitizeEvidence(JSON.stringify(loc).slice(0, 160));
              logDebug('JSON-LD location object found', location);
              return {
                location,
                location_status: 'confirmed',
                location_evidence: evidence,
                location_evidence_context: 'json-ld',
              };
            }
          }
        }
      }
    } catch (error) {
      logDebug('Failed to parse JSON-LD for location', error);
    }
  }
  return null;
};

const fromMetaTags = (html: string): StrictLocationResult | null => {
  const $ = cheerio.load(html);
  const selectors = [
    'meta[property="event:location"]',
    'meta[name="event:location"]',
    'meta[itemprop="location"]',
    'meta[name="og:site_name"]',
  ];

  for (const selector of selectors) {
    const node = $(selector).first();
    if (!node || node.length === 0) continue;
    const content = node.attr('content')?.trim();
    if (!content) continue;
    if (!LOCATION_REGEX.test(content)) continue;

    logDebug('Meta location found', selector, content);
    return {
      location: content,
      location_status: 'confirmed',
      location_evidence: sanitizeEvidence(content),
      location_evidence_context: selector,
    };
  }

  return null;
};

const visibleTextScan = (html: string): StrictLocationResult | null => {
  const $ = cheerio.load(html);

  // First, try to get all text content and search for location patterns
  const bodyText = $('body').text();
  
  // Try multiple regex patterns for different location formats
  const patterns = [
    // Standard: "City, ST" or "City, State"
    /([A-Z][A-Za-z'&\.\-]+(?:\s+[A-Z][A-Za-z'&\.\-]+)*),\s*([A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/g,
    // With parentheses: "City (ST)" or "City, (ST)"
    /([A-Z][A-Za-z'&\.\-]+(?:\s+[A-Z][A-Za-z'&\.\-]+)*)[,\s]*\(([A-Z]{2})\)/g,
    // With dash: "City - ST"
    /([A-Z][A-Za-z'&\.\-]+(?:\s+[A-Z][A-Za-z'&\.\-]+)*)\s*[-–]\s*([A-Z]{2})/g,
  ];

  const candidates: Array<{ location: string; evidence: string; index: number }> = [];

  for (const pattern of patterns) {
    let match;
    pattern.lastIndex = 0; // Reset regex
    while ((match = pattern.exec(bodyText)) !== null) {
      const [, city, statePart] = match;
      if (!city || !statePart) continue;

      const stateLower = statePart.toLowerCase();
      const isValidState = STATE_ABBREVIATIONS.has(statePart) || STATE_NAMES.has(stateLower);
      
      if (!isValidState) continue;

      // Normalize state abbreviation
      let stateAbbr = statePart;
      if (STATE_NAMES.has(stateLower)) {
        // Convert full state name to abbreviation
        stateAbbr = STATE_NAME_TO_ABBR[stateLower] || statePart.toUpperCase();
      }

      const fullLocation = `${city.trim()}, ${stateAbbr}`;
      const contextStart = Math.max(0, match.index - 30);
      const contextEnd = Math.min(bodyText.length, match.index + match[0].length + 30);
      const evidence = bodyText.slice(contextStart, contextEnd).trim();

      candidates.push({
        location: fullLocation,
        evidence: sanitizeEvidence(evidence),
        index: match.index,
      });
    }
  }

  // Also check individual elements for better context
  const nodes = $('body *')
    .toArray()
    .filter((el) => {
      const tag = el.tagName?.toLowerCase();
      return tag && !['script', 'style', 'noscript', 'meta', 'link'].includes(tag);
    });

  for (const el of nodes) {
    const text = $(el)
      .contents()
      .filter((_, node) => node.type === 'text')
      .text()
      .trim();

    if (!text || text.length < 5) continue;
    
    // Check for location patterns in this element
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) continue;

      const [, city, statePart] = match;
      if (!city || !statePart) continue;

      const stateLower = statePart.toLowerCase();
      const isValidState = STATE_ABBREVIATIONS.has(statePart) || STATE_NAMES.has(stateLower);
      
      if (!isValidState) continue;

      let stateAbbr = statePart;
      if (STATE_NAMES.has(stateLower)) {
        // Convert full state name to abbreviation
        stateAbbr = STATE_NAME_TO_ABBR[stateLower] || statePart.toUpperCase();
      }

      const fullLocation = `${city.trim()}, ${stateAbbr}`;
      const evidence = sanitizeEvidence(text);

      // Prefer element-based matches (better context)
      logDebug('Visible location match from element', { location: fullLocation, evidence });
      return {
        location: fullLocation,
        location_status: 'confirmed',
        location_evidence: evidence,
        location_evidence_context: 'visible-text',
      };
    }
  }

  // If no element-based match, use first candidate from body text
  if (candidates.length > 0) {
    // Sort by index (earlier in document is often more relevant)
    candidates.sort((a, b) => a.index - b.index);
    const best = candidates[0];
    logDebug('Visible location match from body text', { location: best.location, evidence: best.evidence });
    return {
      location: best.location,
      location_status: 'confirmed',
      location_evidence: best.evidence,
      location_evidence_context: 'visible-text',
    };
  }

  return null;
};

export function extractStrictLocation(html: string, baseUrl?: string): StrictLocationResult {
  logDebug('Starting strict location extraction', { baseUrl });

  const jsonLd = fromJsonLd(html);
  if (jsonLd) {
    logDebug('Location from JSON-LD');
    return jsonLd;
  }

  const meta = fromMetaTags(html);
  if (meta) {
    logDebug('Location from meta tags');
    return meta;
  }

  const visible = visibleTextScan(html);
  if (visible) {
    logDebug('Location from visible text');
    return visible;
  }

  logDebug('No location evidence found, marking TBD');
  return {
    location_status: 'tbd',
  };
}
