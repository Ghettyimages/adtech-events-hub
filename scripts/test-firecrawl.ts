/**
 * Throwaway: verify FIRECRAWL_API_KEY works and inspect what Firecrawl returns
 * for a given URL. Run: npx tsx scripts/test-firecrawl.ts <url>
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { markdownToOverrideHtml, scrapeUrlWithFirecrawl } from '../src/lib/firecrawl';
import { extractEventsFromUrl } from '../src/lib/extractor/agent';

const url =
  process.argv[2] ||
  'https://www.smartly.io/events/cannes-2026?utm_source=invite_ELT&utm_medium=outreach&utm_campaign=cannes_2026';

async function main() {
  console.log('Key present:', Boolean(process.env.FIRECRAWL_API_KEY));
  console.log('Scraping:', url);

  const result = await scrapeUrlWithFirecrawl(url);

  console.log('error:', result.error ?? null);
  console.log('html length:', result.html?.length ?? 0);
  console.log('markdown length:', result.markdown?.length ?? 0);
  console.log('title:', (result.metadata as any)?.title ?? null);
  const overrideHtml =
    result.html || (result.markdown ? markdownToOverrideHtml(result.markdown) : undefined);

  if (overrideHtml) {
    console.log('\n--- running agent extraction on Firecrawl content ---');
    const extracted = await extractEventsFromUrl(url, 'Smartly', overrideHtml);
    console.log('events found:', extracted.events.length);
    console.log(JSON.stringify(extracted.events, null, 2));
  } else {
    console.log('No content to extract from.');
  }
}

main().catch((e) => {
  console.error('FAILED:', e);
  process.exit(1);
});
