import { z } from 'zod';

export const createEventSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional(),
  url: z.string().url('Must be a valid URL').optional().or(z.literal('')),
  location: z.string().max(200).optional(),
  start: z.string().datetime('Start must be a valid ISO datetime'),
  end: z.string().datetime('End must be a valid ISO datetime'),
  timezone: z.string().max(50).optional(),
  source: z.string().max(100).optional(),
});

export const updateEventStatusSchema = z.object({
  id: z.string(),
  status: z.enum(['PUBLISHED', 'PENDING']),
});

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventStatusInput = z.infer<typeof updateEventStatusSchema>;
