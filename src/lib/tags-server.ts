/**
 * Server-only tag functions that require database access
 */

import 'server-only';
import { prisma } from './db';
import { Tag } from '@prisma/client';
import { normalizeTagName } from './tags';

/**
 * Fetch all tags from database
 */
export async function fetchAllTags(): Promise<Tag[]> {
  return await prisma.tag.findMany({
    orderBy: { name: 'asc' },
  });
}

/**
 * Fetch all tags with their usage counts (usageCount is already cached in model)
 */
export async function fetchTagsWithUsage(): Promise<Tag[]> {
  return await prisma.tag.findMany({
    orderBy: [
      { usageCount: 'desc' },
      { name: 'asc' },
    ],
  });
}

/**
 * Get tag names used in events (extract from JSON string arrays)
 */
export async function getAllTagNamesFromEvents(): Promise<string[]> {
  const events = await prisma.event.findMany({
    select: { tags: true },
    where: {
      tags: { not: null },
    },
  });

  const tagSet = new Set<string>();
  
  for (const event of events) {
    if (event.tags) {
      try {
        const tagsArray = JSON.parse(event.tags);
        if (Array.isArray(tagsArray)) {
          tagsArray.forEach((tag: string) => {
            if (tag && typeof tag === 'string') {
              tagSet.add(normalizeTagName(tag));
            }
          });
        }
      } catch (e) {
        // Invalid JSON, skip
        console.error('Failed to parse tags:', e);
      }
    }
  }

  return Array.from(tagSet);
}

/**
 * Recalculate and update usage counts for specified tags
 */
export async function updateTagUsageCounts(tagNames: string[]): Promise<void> {
  if (tagNames.length === 0) return;

  // Get all events with tags
  const events = await prisma.event.findMany({
    select: { tags: true },
    where: {
      tags: { not: null },
    },
  });

  // Count occurrences of each tag
  const tagCounts = new Map<string, number>();
  tagNames.forEach((tagName) => {
    tagCounts.set(tagName, 0);
  });

  for (const event of events) {
    if (event.tags) {
      try {
        const tagsArray = JSON.parse(event.tags);
        if (Array.isArray(tagsArray)) {
          tagsArray.forEach((tag: string) => {
            const normalized = normalizeTagName(tag);
            if (tagCounts.has(normalized)) {
              tagCounts.set(normalized, (tagCounts.get(normalized) || 0) + 1);
            }
          });
        }
      } catch (e) {
        // Invalid JSON, skip
      }
    }
  }

  // Update usage counts in database
  for (const [tagName, count] of tagCounts.entries()) {
    await prisma.tag.updateMany({
      where: { name: tagName },
      data: { usageCount: count },
    });
  }
}

/**
 * Recalculate usage counts for all tags in database
 */
export async function recalculateAllTagUsageCounts(): Promise<void> {
  const allTags = await prisma.tag.findMany({
    select: { name: true },
  });

  const tagNames = allTags.map((tag) => tag.name);
  await updateTagUsageCounts(tagNames);
}

/**
 * Update usage counts for tags when event tags change
 * Call this after creating/updating/deleting events
 */
export async function updateUsageCountsForEventTags(oldTags: string[] | null, newTags: string[] | null): Promise<void> {
  const tagsToUpdate = new Set<string>();

  if (oldTags) {
    oldTags.forEach((tag) => tagsToUpdate.add(normalizeTagName(tag)));
  }
  if (newTags) {
    newTags.forEach((tag) => tagsToUpdate.add(normalizeTagName(tag)));
  }

  if (tagsToUpdate.size > 0) {
    await updateTagUsageCounts(Array.from(tagsToUpdate));
  }
}

/**
 * Ensure tag exists in database (create if doesn't exist)
 */
export async function ensureTagExists(tagName: string, displayName?: string): Promise<Tag> {
  const normalized = normalizeTagName(tagName);
  
  const existing = await prisma.tag.findUnique({
    where: { name: normalized },
  });

  if (existing) {
    return existing;
  }

  return await prisma.tag.create({
    data: {
      name: normalized,
      displayName: displayName || null,
      usageCount: 0,
    },
  });
}

