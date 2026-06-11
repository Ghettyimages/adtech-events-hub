import { z } from 'zod';
import { TEMPORAL_KIND } from '@/lib/eventTemporal';

const temporalKindSchema = z.enum([TEMPORAL_KIND.ALL_DAY, TEMPORAL_KIND.TIMED]).optional();

const dateOrDateTimeString = z.string().refine(
  (val) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(val.trim())) return true;
    const date = new Date(val);
    return !isNaN(date.getTime());
  },
  { message: 'Must be a valid date (YYYY-MM-DD) or datetime' }
);

export const createEventSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  // Optional fields can be string, null, or undefined
  description: z.union([z.string().max(2000), z.literal(''), z.null(), z.undefined()]).optional(),
  // URL can be a valid URL, empty string, null, or undefined
  url: z.union([
    z.string().url('Must be a valid URL'),
    z.literal(''),
    z.null()
  ]).optional(),
  location: z.union([z.string().max(200), z.literal(''), z.null()]).optional(),
  temporalKind: temporalKindSchema,
  start: dateOrDateTimeString,
  end: dateOrDateTimeString,
  timezone: z.union([z.string().max(50), z.literal(''), z.null()]).optional(),
  source: z.union([z.string().max(100), z.literal(''), z.null()]).optional(),
  sponsoredBy: z.union([z.string().max(200), z.literal(''), z.null()]).optional(),
  sponsorKind: z.enum(['SPONSORED', 'PARTNERSHIP']).nullable().optional(),
  // NEW: tags and structured location fields
  tags: z.array(z.string()).nullable().optional(),
  country: z.union([z.string().max(100), z.literal(''), z.null()]).optional(),
  region: z.union([z.string().max(100), z.literal(''), z.null()]).optional(),
  city: z.union([z.string().max(100), z.literal(''), z.null()]).optional(),
  hubId: z.union([z.string(), z.null()]).optional(),
  hubHostId: z.union([z.string(), z.null()]).optional(),
  showOnMainCalendar: z.boolean().optional(),
});

export const updateEventStatusSchema = z.object({
  id: z.string(),
  status: z.enum(['PUBLISHED', 'PENDING']),
});

export const updateEventSchema = createEventSchema.partial().extend({
  status: z.enum(['PUBLISHED', 'PENDING']).optional(),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventStatusInput = z.infer<typeof updateEventStatusSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
