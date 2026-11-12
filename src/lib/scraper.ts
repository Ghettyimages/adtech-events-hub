/**
 * Generic URL scraper - fallback when AI agent extraction fails
 */

import { ExtractedEvent } from './extractor/schema';
import { extractFromHtml } from './extractor/extractFromHtml';
import { extractStrictDates } from './extractor/dateExtractor';
import { verifyExtractedEvents } from './eventEvidence';
import { assertSafePublicHttpUrl, safePublicFetch } from './safeRemoteUrl';

/**
 * Generic scraper that extracts events from HTML without AI
 * Returns basic event structures that can be normalized later
 */
export async function scrapeUrlGenericWithVerification(
  url: string,
  sourceName?: string,
  overrideHtml?: string
): Promise<{ events: ExtractedEvent[]; rejectedEvents: number; verificationWarnings: Array<{ title: string; reasons: string[] }>; verificationIssues: Array<{ title: string; reasons: string[] }> }> {
  try {
    // Reuse the exact fetched snapshot when Event Watch has already loaded it.
    await assertSafePublicHttpUrl(url);
    let html = overrideHtml;
    let finalUrl = url;
    if (html == null) {
      const response = await safePublicFetch(url, {
        headers: { 'User-Agent': 'TheMediaCalendar Event Watch' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      html = await response.text();
      finalUrl = response.url || url;
      await assertSafePublicHttpUrl(finalUrl);
    }

    // Use extractFromHtml to get rough structures
    const roughRows = extractFromHtml(html, finalUrl);

    // Convert to ExtractedEvent format
    const events: ExtractedEvent[] = [];
    let rejectedEvents = 0;
    const verificationIssues: Array<{ title: string; reasons: string[] }> = [];
    const verificationWarnings: Array<{ title: string; reasons: string[] }> = [];

    for (const row of roughRows) {
      if (!row.title) continue;

      // Parse only this card's source text, including the entire date range.
      // Never infer a year or silently reduce a multi-day event to one day.
      const rowHtml = `<article><h2>${escapeHtml(row.title)}</h2><p>${escapeHtml(row.text || row.date || '')}</p></article>`;
      const dates = extractStrictDates(rowHtml);
      const startIso = dates.start;
      const endIso = dates.end || dates.start;

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
        date_status: dates.date_status,
        evidence: dates.evidence,
        evidence_context: dates.evidence_context,
        location_status: row.location ? 'confirmed' : 'tbd',
        location_evidence: row.location || undefined,
      };

      const verified = verifyExtractedEvents([event], html, finalUrl);
      events.push(...verified.events);
      rejectedEvents += verified.rejected.length;
      verificationIssues.push(...verified.rejected.map(({ event, reasons }) => ({ title: event.title, reasons })));
      verificationWarnings.push(...verified.warnings);
    }

    return { events, rejectedEvents, verificationWarnings, verificationIssues };
  } catch (error: any) {
    console.error(`Error in generic scraper for ${url}:`, error);
    throw error;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Compatibility wrapper for callers that only need verified events. */
export async function scrapeUrlGeneric(url: string, sourceName?: string, overrideHtml?: string): Promise<ExtractedEvent[]> {
  const result = await scrapeUrlGenericWithVerification(url, sourceName, overrideHtml);
  return result.events;
}
