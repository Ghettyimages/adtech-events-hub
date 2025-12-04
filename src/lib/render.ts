/**
 * HTML rendering utilities using Playwright for JavaScript-heavy pages
 */

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

// Lazy load Playwright to avoid issues if not installed
async function getPlaywright() {
  try {
    const playwright = await import('playwright');
    playwrightAvailable = true;
    return playwright;
  } catch (error) {
    playwrightAvailable = false;
    throw new Error('Playwright is not available. Install it with: npm install playwright && npx playwright install chromium');
  }
}

async function getBrowser(): Promise<any> {
  if (!browserInstance) {
    const playwright = await getPlaywright();
    browserInstance = await playwright.chromium.launch({
      headless: true,
    });
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

  // Try to use Playwright, fallback to fetch if not available
  try {
    const playwright = await getPlaywright();
    playwrightAvailable = true;
  } catch {
    // Fallback to simple fetch if Playwright not available
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    } as any);
    const html = await response.text();
    return {
      html,
      finalURL: response.url || url,
    };
  }

  let page: any = null;

  try {
    const browser = await getBrowser();
    page = await browser.newPage();

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

