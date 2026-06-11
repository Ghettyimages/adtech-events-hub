export type SponsorKind = 'SPONSORED' | 'PARTNERSHIP';

const SPONSOR_PATTERNS: Array<{ kind: SponsorKind; re: RegExp }> = [
  {
    kind: 'PARTNERSHIP',
    re: /\b(?:in\s+partn(?:e|a)rship\s+with|in\s+collaboration\s+with)\s+([^|\n\r–—]+)/i,
  },
  {
    kind: 'SPONSORED',
    re: /\b(?:sponso(?:r|)red\s+by|presented\s+by)\s+([^|\n\r–—]+)/i,
  },
];

function cleanSponsorName(raw: string): string {
  return raw
    .replace(/\s*[\[\(].*?[\]\)]\s*$/g, '')
    .trim()
    .replace(/[.,;]+$/, '');
}

export function extractSponsorFromText(text: string): {
  sponsoredBy: string | null;
  sponsorKind: SponsorKind | null;
  cleanedText: string;
} {
  for (const { kind, re } of SPONSOR_PATTERNS) {
    const match = text.match(re);
    if (!match) continue;
    const sponsoredBy = cleanSponsorName(match[1]);
    if (!sponsoredBy) {
      return { sponsoredBy: null, sponsorKind: null, cleanedText: text };
    }
    const cleanedText = text
      .replace(match[0], '')
      .replace(/\s*[—–-]\s*$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return { sponsoredBy, sponsorKind: kind, cleanedText };
  }
  return { sponsoredBy: null, sponsorKind: null, cleanedText: text };
}

export function formatSponsorLine(
  name: string,
  kind?: string | null
): string {
  if (kind === 'PARTNERSHIP') return `In partnership with ${name}`;
  if (kind === 'SPONSORED') return `Sponsored by ${name}`;
  return name;
}
