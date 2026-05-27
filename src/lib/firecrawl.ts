/**
 * Firecrawl page acquisition — single-URL scrape only (no crawl / JSON extract / interact).
 */

import Firecrawl from '@mendable/firecrawl-js';

export type FirecrawlScrapeResult = {
  html?: string;
  markdown?: string;
  metadata?: Record<string, unknown>;
  error?: string;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Wrap markdown in minimal HTML for the extractor overrideHtml path. */
export function markdownToOverrideHtml(markdown: string): string {
  return `<html><body><pre>${escapeHtml(markdown)}</pre></body></html>`;
}

/**
 * Scrape a single URL via Firecrawl for rendered html/markdown.
 * Returns a safe empty result when FIRECRAWL_API_KEY is missing.
 */
export async function scrapeUrlWithFirecrawl(url: string): Promise<FirecrawlScrapeResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;

  if (!apiKey?.trim()) {
    console.warn('[firecrawl] FIRECRAWL_API_KEY is not set; skipping Firecrawl scrape');
    return { error: 'FIRECRAWL_API_KEY is not configured' };
  }

  try {
    const firecrawl = new Firecrawl({ apiKey: apiKey.trim() });
    const document = await firecrawl.scrape(url, {
      formats: ['markdown', 'html'],
    });

    const html = document.html ?? document.rawHtml;
    const markdown = document.markdown;

    return {
      html: html || undefined,
      markdown: markdown || undefined,
      metadata: document.metadata as Record<string, unknown> | undefined,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown Firecrawl error';
    console.error('[firecrawl] Scrape failed:', message);
    return { error: message };
  }
}
