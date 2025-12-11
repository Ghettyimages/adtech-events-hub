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


