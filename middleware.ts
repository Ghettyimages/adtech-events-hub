import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Public routes that don't require authentication
const publicRoutes = ['/', '/submit', '/login', '/signup', '/privacy', '/terms'];

export async function middleware(req: NextRequest) {
  // Use the same secret as auth.ts
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  const token = await getToken({ req, secret });
  const pathname = req.nextUrl.pathname;

  // Allow public routes without authentication
  if (publicRoutes.includes(pathname)) {
    return NextResponse.next();
  }

  // For all other routes, require authentication
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Note: Profile completion check has been removed from middleware
  // because it requires Prisma which uses Node.js built-in modules
  // not available in Edge runtime. Profile checks should be done:
  // - Client-side after authentication
  // - In API routes
  // - Or stored in JWT token claims (requires custom NextAuth config)

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/ (all API routes - they handle their own authentication)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
