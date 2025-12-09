import { handlers } from '@/lib/auth';

// NextAuth v4 App Router pattern
// Check if handlers has GET/POST properties, otherwise use handler function for both
const getHandler = (handlers as any)?.GET || handlers;
const postHandler = (handlers as any)?.POST || handlers;

export const GET = getHandler;
export const POST = postHandler;

