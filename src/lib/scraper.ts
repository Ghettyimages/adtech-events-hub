/**
 * Generic URL scraper - fallback when AI agent extraction fails
 */

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { ExtractedEvent } from './extractor/schema';
import { extractFromHtml } from './extractor/extractFromHtml';
import { parse } from 'date-fns';

/**
 * Generic scraper that extracts events from HTML without AI
 * Returns basic event structures that can be normalized later
 */
export async function scrapeUrlGeneric(
  url: string,
  sourceName?: string
): Promise<ExtractedEvent[]> {
  try {
    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
    } as any);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const finalUrl = response.url || url;

    // Use extractFromHtml to get rough structures
    const roughRows = extractFromHtml(html, finalUrl);

    // Convert to ExtractedEvent format
    const events: ExtractedEvent[] = [];

    for (const row of roughRows) {
      if (!row.title) continue;

      // Try to parse date
      let startIso: string | undefined;
      let endIso: string | undefined;

      if (row.date) {
        try {
          // Try common date formats
          const dateFormats = [
            'MMM d, yyyy',
            'MMMM d, yyyy',
            'MMM dd, yyyy',
            'MMMM dd, yyyy',
            'MM/dd/yyyy',
            'yyyy-MM-dd',
          ];

          for (const format of dateFormats) {
            try {
              const parsed = parse(row.date, format, new Date());
              if (!isNaN(parsed.getTime())) {
                // Return date-only format (YYYY-MM-DD) for all-day events
                // This allows normalization to properly detect and handle all-day events
                const year = parsed.getFullYear();
                const month = String(parsed.getMonth() + 1).padStart(2, '0');
                const day = String(parsed.getDate()).padStart(2, '0');
                startIso = `${year}-${month}-${day}`;
                endIso = `${year}-${month}-${day}`;
                break;
              }
            } catch {
              // Try next format
            }
          }
        } catch {
          // Date parsing failed, leave as undefined
        }
      }

      // Derive source name from URL if not provided
      let source = sourceName;
      if (!source) {
        try {
          const host = new URL(finalUrl).hostname.replace('www.', '');
          const parts = host.split('.');
          if (parts.length >= 2) {
            source = parts[parts.length - 2];
            source = source.charAt(0).toUpperCase() + source.slice(1);
          }
        } catch {
          source = undefined;
        }
      }

      const event: ExtractedEvent = {
        title: row.title,
        start: startIso,
        end: endIso,
        location: row.location || undefined,
        url: row.url || undefined,
        source,
        date_status: startIso ? 'confirmed' : 'tbd',
        location_status: row.location ? 'confirmed' : 'tbd',
        location_evidence: row.location || undefined,
      };

      events.push(event);
    }

    return events;
  } catch (error: any) {
    console.error(`Error in generic scraper for ${url}:`, error);
    return [];
  }
}

