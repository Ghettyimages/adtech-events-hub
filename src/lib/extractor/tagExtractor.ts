/**
 * Tag extraction for events
 * Extracts and normalizes tags from event data and source pages
 */

import { ExtractedEvent } from './schema';

// Predefined tag mappings - keywords to tags
const TAG_KEYWORDS: Record<string, string[]> = {
  adtech: ['adtech', 'ad tech', 'advertising technology', 'advertising tech'],
  publishers: ['publisher', 'publishing', 'media publisher', 'content publisher'],
  programmatic: ['programmatic', 'programmatic advertising', 'rtb', 'real-time bidding'],
  ctv: ['ctv', 'connected tv', 'streaming tv', 'ott', 'over-the-top'],
  data: ['data', 'data science', 'data analytics', 'big data', 'data platform'],
  privacy: ['privacy', 'gdpr', 'ccpa', 'data privacy', 'consumer privacy'],
  measurement: ['measurement', 'attribution', 'analytics', 'metrics', 'reporting'],
  marketing: ['marketing', 'digital marketing', 'brand marketing', 'performance marketing'],
  mobile: ['mobile', 'mobile advertising', 'app marketing', 'mobile marketing'],
  video: ['video', 'video advertising', 'video marketing', 'streaming video'],
};

// Predefined tags list
export const PREDEFINED_TAGS = [
  'adtech',
  'publishers',
  'programmatic',
  'ctv',
  'data',
  'privacy',
  'measurement',
  'marketing',
  'mobile',
  'video',
] as const;

/**
 * Normalize a tag (lowercase, trim, remove special characters)
 */
function normalizeTag(tag: string): string {
  return tag
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Extract tags from event data (title, description, source)
 * @param event - The event to extract tags from
 * @param html - Optional HTML content to search
 * @param tagKeywordMap - Optional map of tag names to keywords (from database). If not provided, uses hardcoded TAG_KEYWORDS as fallback.
 */
export function extractTags(
  event: ExtractedEvent,
  html?: string,
  tagKeywordMap?: Record<string, string[]>
): string[] {
  const tags = new Set<string>();

  // If tags already provided in event, use them (normalized)
  if (event.tags && Array.isArray(event.tags)) {
    for (const tag of event.tags) {
      const normalized = normalizeTag(tag);
      if (normalized) {
        tags.add(normalized);
      }
    }
  }

  // Use provided tagKeywordMap or fall back to hardcoded TAG_KEYWORDS
  const keywordMap = tagKeywordMap || TAG_KEYWORDS;

  // Combine all text from event for keyword matching
  const searchText = [
    event.title,
    event.description,
    event.source,
    event.location,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  // Match keywords to tags
  for (const [tag, keywords] of Object.entries(keywordMap)) {
    for (const keyword of keywords) {
      if (searchText.includes(keyword.toLowerCase())) {
        tags.add(tag);
        break; // Only add tag once per event
      }
    }
  }

  // Additional keyword-based extraction from title/description
  const titleLower = (event.title || '').toLowerCase();
  const descLower = (event.description || '').toLowerCase();

  // Check for specific patterns
  if (titleLower.includes('conference') || descLower.includes('conference')) {
    // Could add a 'conference' tag if needed
  }

  if (titleLower.includes('webinar') || descLower.includes('webinar')) {
    // Could add a 'webinar' tag if needed
  }

  // Extract from HTML if provided
  if (html) {
    const htmlLower = html.toLowerCase();
    for (const [tag, keywords] of Object.entries(keywordMap)) {
      for (const keyword of keywords) {
        if (htmlLower.includes(keyword.toLowerCase())) {
          tags.add(tag);
          break;
        }
      }
    }
  }

  // Return sorted array of normalized tags
  return Array.from(tags).sort();
}

/**
 * Validate and normalize an array of tags
 */
export function normalizeTags(tags: string[]): string[] {
  const normalized = tags
    .map(normalizeTag)
    .filter((tag) => tag.length > 0);

  // Remove duplicates
  return Array.from(new Set(normalized)).sort();
}

