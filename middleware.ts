import { withAuth } from 'next-auth/middleware';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { prisma } from '@/lib/db';

// Public routes that don't require authentication
const publicRoutes = ['/', '/submit', '/login', '/privacy', '/terms'];

export default withAuth(
  async function middleware(req: NextRequest) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    const pathname = req.nextUrl.pathname;

    // If user is authenticated and not on profile page or API routes, check profile completion
    if (
      token &&
      pathname !== '/profile' &&
      pathname !== '/api' &&
      !pathname.startsWith('/api/') &&
      !pathname.startsWith('/_next')
    ) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: token.sub || '' },
          select: {
            name: true,
            company: true,
            title: true,
            companyEmail: true,
            location: true,
          },
        });

        if (user) {
          // Check if profile is incomplete
          const isProfileComplete = !!(
            user.name &&
            user.company &&
            user.title &&
            user.companyEmail &&
            user.location
          );

          // If profile is incomplete, redirect to profile page
          if (!isProfileComplete) {
            const url = req.nextUrl.clone();
            url.pathname = '/profile';
            return NextResponse.redirect(url);
          }
        }
      } catch (error) {
        console.error('Error checking profile completion in middleware:', error);
        // Continue if there's an error
      }
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname;
        
        // Allow public routes without authentication
        if (publicRoutes.includes(pathname)) {
          return true;
        }
        
        // For all other routes, require authentication
        return !!token;
      },
    },
  }
);

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (NextAuth routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

