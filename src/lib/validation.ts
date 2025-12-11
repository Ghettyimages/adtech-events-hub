import { z } from 'zod';

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
  // Accept ISO datetime strings (can be generated from datetime-local inputs)
  start: z.string().refine(
    (val) => {
      const date = new Date(val);
      return !isNaN(date.getTime());
    },
    { message: 'Start must be a valid datetime' }
  ),
  end: z.string().refine(
    (val) => {
      const date = new Date(val);
      return !isNaN(date.getTime());
    },
    { message: 'End must be a valid datetime' }
  ),
  timezone: z.union([z.string().max(50), z.literal(''), z.null()]).optional(),
  source: z.union([z.string().max(100), z.literal(''), z.null()]).optional(),
  // NEW: tags and structured location fields
  tags: z.array(z.string()).nullable().optional(),
  country: z.union([z.string().max(100), z.literal(''), z.null()]).optional(),
  region: z.union([z.string().max(100), z.literal(''), z.null()]).optional(),
  city: z.union([z.string().max(100), z.literal(''), z.null()]).optional(),
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
