import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

// Public routes that don't require authentication
const publicRoutes = ['/', '/submit', '/login', '/signup', '/privacy', '/terms'];

// Use the shared auth() helper so middleware and API/pages share the same secret/cookies
export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  // Allow public routes without authentication
  if (publicRoutes.includes(pathname)) {
    return NextResponse.next();
  }

  // For all other routes, require authentication
  if (!req.auth) {
    const loginUrl = new URL('/login', nextUrl);
    // Preserve the original destination so users land back where they intended
    loginUrl.searchParams.set('callbackUrl', `${pathname}${nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

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
