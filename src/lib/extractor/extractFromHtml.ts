/**
 * Basic HTML extraction for event-like structures
 * Used as fallback when LLM extraction fails
 */

import * as cheerio from 'cheerio';

export interface RoughEventRow {
  title?: string;
  date?: string;
  location?: string;
  url?: string;
  text?: string;
}

/**
 * Extract rough event-like structures from HTML
 * Looks for common patterns like lists, cards, tables
 */
export function extractFromHtml(html: string, baseUrl: string): RoughEventRow[] {
  const $ = cheerio.load(html);
  const rows: RoughEventRow[] = [];

  // Common selectors for event listings
  const eventSelectors = [
    'article',
    '[class*="event"]',
    '[class*="card"]',
    '[class*="listing"]',
    'li[class*="event"]',
    'div[class*="event"]',
    'tr[class*="event"]',
  ];

  // Try to find event containers
  for (const selector of eventSelectors) {
    $(selector).each((_, el) => {
      const $el = $(el);
      const text = $el.text().trim();

      // Skip if too short or too long (likely not an event)
      if (text.length < 10 || text.length > 500) {
        return;
      }

      // Look for links (event URLs)
      const link = $el.find('a').first().attr('href');
      const absoluteUrl = link
        ? new URL(link, baseUrl).toString()
        : undefined;

      // Extract title (from heading, link text, or first line)
      const title =
        $el.find('h1, h2, h3, h4, h5, h6').first().text().trim() ||
        $el.find('a').first().text().trim() ||
        text.split('\n')[0].trim();

      // Look for date-like patterns
      const dateMatch = text.match(
        /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,\s+\d{4})?/i
      );
      const date = dateMatch ? dateMatch[0] : undefined;

      // Look for location patterns (City, ST)
      const locationMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})\b/);
      const location = locationMatch ? locationMatch[0] : undefined;

      if (title && title.length > 3) {
        rows.push({
          title,
          date,
          location,
          url: absoluteUrl,
          text: text.substring(0, 200), // First 200 chars
        });
      }
    });
  }

  // Deduplicate by title
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.title?.toLowerCase() || '';
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

