import { z } from 'zod';

export const createEventSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  // Optional fields can be string, null, or undefined
  description: z.string().max(2000).nullable().optional(),
  // URL can be a valid URL, empty string, null, or undefined
  url: z.union([
    z.string().url('Must be a valid URL'),
    z.literal(''),
    z.null()
  ]).optional(),
  location: z.string().max(200).nullable().optional(),
  start: z.string().datetime('Start must be a valid ISO datetime'),
  end: z.string().datetime('End must be a valid ISO datetime'),
  timezone: z.string().max(50).nullable().optional(),
  source: z.string().max(100).nullable().optional(),
  // NEW: tags and structured location fields
  tags: z.array(z.string()).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  region: z.string().max(100).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
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
