/**
 * HTML rendering utilities using Playwright for JavaScript-heavy pages
 */

import { assertSafePublicHttpUrl } from './safeRemoteUrl';
import chromium from '@sparticuz/chromium';
import { chromium as playwrightChromium } from 'playwright-core';

interface RenderOptions {
  maxLoads?: number; // Maximum number of "load more" clicks
  waitMs?: number; // Wait time between actions
  timeoutMs?: number; // Total timeout
}

interface RenderedHTML {
  html: string;
  finalURL: string;
}

let browserInstance: any = null;
let playwrightAvailable = false;

async function getBrowser(): Promise<any> {
  if (!browserInstance) {
    browserInstance = await playwrightChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    playwrightAvailable = true;
  }
  return browserInstance;
}

/**
 * Get fully rendered HTML from a URL using Playwright
 * Handles JavaScript rendering, lazy loading, and pagination
 */
export async function getRenderedHTML(
  url: string,
  options: RenderOptions = {}
): Promise<RenderedHTML> {
  const { maxLoads = 3, waitMs = 1200, timeoutMs = 60000 } = options;
  await assertSafePublicHttpUrl(url);

  let page: any = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

    const checkedHosts = new Map<string, boolean>();
    await page.route('**/*', async (route: any) => {
      const requestUrl = route.request().url();
      if (requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) {
        await route.continue();
        return;
      }
      try {
        const parsed = new URL(requestUrl);
        const cacheKey = `${parsed.protocol}//${parsed.hostname}`;
        if (!checkedHosts.has(cacheKey)) {
          await assertSafePublicHttpUrl(requestUrl);
          checkedHosts.set(cacheKey, true);
        }
        await route.continue();
      } catch {
        await route.abort('blockedbyclient');
      }
    });

    // Set a reasonable viewport
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Navigate to the page
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: timeoutMs,
    });

    if (!response) {
      throw new Error('Failed to load page');
    }

    const finalURL = page.url();
    await assertSafePublicHttpUrl(finalURL);

    // Wait for initial content to load
    await page.waitForTimeout(waitMs);

    // Try to click "Load more" buttons up to maxLoads times
    for (let i = 0; i < maxLoads; i++) {
      try {
        // Look for common "load more" button selectors
        const loadMoreSelectors = [
          'button:has-text("Load more")',
          'button:has-text("Show more")',
          'button:has-text("More events")',
          'a:has-text("Load more")',
          'a:has-text("Show more")',
          '[data-testid*="load-more"]',
          '[class*="load-more"]',
          '[id*="load-more"]',
        ];

        let clicked = false;
        for (const selector of loadMoreSelectors) {
          try {
            const button = await page.$(selector);
            if (button && (await button.isVisible())) {
              await button.click();
              await page.waitForTimeout(waitMs);
              clicked = true;
              break;
            }
          } catch {
            // Continue to next selector
          }
        }

        if (!clicked) {
          // No more "load more" buttons found
          break;
        }
      } catch {
        // Continue even if clicking fails
        break;
      }
    }

    // Get the final HTML
    const html = await page.content();

    return {
      html,
      finalURL,
    };
  } catch (error: any) {
    throw new Error(`Failed to render HTML: ${error.message}`);
  } finally {
    if (page) {
      await page.close();
    }
  }
}

/**
 * Cleanup browser instance (call this when shutting down)
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance && playwrightAvailable) {
    try {
      await browserInstance.close();
      browserInstance = null;
    } catch (error) {
      // Ignore errors during cleanup
    }
  }
}
