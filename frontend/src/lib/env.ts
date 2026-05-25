import { z } from 'zod';

const EnvSchema = z.object({
  VITE_GOOGLE_CLIENT_ID: z.string(),
  VITE_API_URL: z.string().url().or(z.literal('')).optional(),
});

export const env = EnvSchema.parse(import.meta.env);
