/**
 * Tag utility functions for normalization, fetching, and usage tracking
 */

import { Tag } from '@prisma/client';

/**
 * Normalize a tag name (lowercase, trim, remove special characters, hyphenate spaces)
 */
export function normalizeTagName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Get display name for a tag (displayName if set, otherwise name)
 * This is a pure function that can be used in client components
 */
export function getDisplayName(tag: Tag | { name: string; displayName?: string | null }): string {
  return tag.displayName || tag.name;
}

/**
 * Merge database tags with predefined tags, deduplicating by normalized tag name
 * Predefined tags are only included if no database tag with the same normalized name exists
 * @param databaseTags - Tags fetched from the database
 * @param predefinedTags - Array of predefined tag names
 * @returns Merged array of tags (database tags + unique predefined tags)
 */
export function mergeTagsWithPredefined(
  databaseTags: Tag[],
  predefinedTags: readonly string[]
): Array<Tag | { name: string; displayName: string }> {
  // Create a map of normalized tag names to database tags
  const dbTagMap = new Map<string, Tag>();
  databaseTags.forEach((tag) => {
    const normalized = normalizeTagName(tag.name);
    dbTagMap.set(normalized, tag);
  });

  // Start with all database tags
  const merged: Array<Tag | { name: string; displayName: string }> = [...databaseTags];

  // Add predefined tags that don't exist in database
  predefinedTags.forEach((predefinedTag) => {
    const normalized = normalizeTagName(predefinedTag);
    if (!dbTagMap.has(normalized)) {
      // Create a simple tag object for predefined tags
      merged.push({
        name: predefinedTag,
        displayName: predefinedTag,
      });
    }
  });

  // Sort by display name
  return merged.sort((a, b) => {
    const nameA = getDisplayName(a).toLowerCase();
    const nameB = getDisplayName(b).toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

