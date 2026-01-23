import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/password';

// Use Web Crypto to generate tokens so this works in both Node and Edge runtimes
const generateFeedToken = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma) as any,
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        try {
          // Find user by email
          const user = await prisma.user.findUnique({
            where: { email: credentials.email as string },
          });

          if (!user || !user.password) {
            // User doesn't exist or doesn't have a password (OAuth user)
            return null;
          }

          // Verify password
          const isValid = await verifyPassword(credentials.password as string, user.password);

          if (!isValid) {
            return null;
          }

          // Return user object (NextAuth will use this to create session)
          return {
            id: user.id,
            email: user.email,
            name: user.name,
          };
        } catch (error) {
          console.error('Error in CredentialsProvider authorize:', error);
          return null;
        }
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/calendar.app.created',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async redirect({ url, baseUrl }) {
      // If url is a relative URL, make it absolute
      const relativeUrl = url.startsWith('/') ? url : `/${url}`;
      const absoluteUrl = url.startsWith('/') ? `${baseUrl}${url}` : url;
      
      // Check if it's a valid URL on the same origin
      try {
        const urlObj = new URL(absoluteUrl);
        if (urlObj.origin === baseUrl) {
          // If it's the login page, redirect to home instead
          if (urlObj.pathname === '/login') {
            return baseUrl;
          }
          return absoluteUrl;
        }
      } catch (e) {
        // Invalid URL, use relative path
        if (relativeUrl && relativeUrl !== '/login') {
          return `${baseUrl}${relativeUrl}`;
        }
      }
      
      // Default to home page
      return baseUrl;
    },
    async session({ session, user, token }) {
      // Handle both OAuth (user parameter) and credentials (token parameter) providers
      const userId = user?.id || (token as any)?.sub || (token as any)?.id;
      
      if (session.user && userId) {
        session.user.id = userId;
        
        try {
          // Fetch user from DB to get feedToken and profile data
          const dbUser = await prisma.user.findUnique({
            where: { id: userId },
            select: {
              feedToken: true,
              name: true,
              company: true,
              title: true,
              companyEmail: true,
              location: true,
              consentEmail: true,
              consentCalendar: true,
              isAdmin: true,
            },
          });

          if (dbUser) {
            // Generate feedToken if it doesn't exist (first login)
            if (!dbUser.feedToken) {
              const feedToken = generateFeedToken();
              await prisma.user.update({
                where: { id: userId },
                data: { feedToken },
              });
              (session.user as any).feedToken = feedToken;
            } else {
              (session.user as any).feedToken = dbUser.feedToken;
            }

            // Add profile data to session
            (session.user as any).company = dbUser.company;
            (session.user as any).title = dbUser.title;
            (session.user as any).companyEmail = dbUser.companyEmail;
            (session.user as any).location = dbUser.location;
            (session.user as any).consentEmail = dbUser.consentEmail;
            (session.user as any).consentCalendar = dbUser.consentCalendar;
            
            // Add profile completion status to session
            const isProfileComplete = !!(
              dbUser.name &&
              dbUser.company &&
              dbUser.title &&
              dbUser.companyEmail &&
              dbUser.location
            );
            (session.user as any).isProfileComplete = isProfileComplete;
            (session.user as any).isAdmin = dbUser.isAdmin || false;
          }
        } catch (error) {
          console.error('Error in session callback:', error);
          // Return session even if there's an error
        }
      }
      return session;
    },
    async jwt({ token, user, account }) {
      // When user signs in, add user ID to token
      if (user) {
        token.id = user.id;
        token.sub = user.id;
      }
      return token;
    },
  },
  session: {
    strategy: 'jwt', // Changed to JWT for better compatibility with credentials provider
  },
  events: {
    async linkAccount({ account, user }) {
      // When a Google account is linked, enable sync flags but DON'T create calendar here.
      // Calendar provisioning is handled by /api/mine/gcal/ensure or /api/mine/gcal/sync
      // to avoid race conditions that create duplicate calendars.
      if (account.provider === 'google' && user.id) {
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              gcalSyncEnabled: true,
              gcalSyncPending: true,
              // gcalCalendarId left as-is (provisioned later by API routes)
              // gcalSyncMode defaults to 'FULL' in schema
            },
          });
          console.log(`[linkAccount] Enabled sync flags for user ${user.id}, calendar will be provisioned on first sync/ensure call`);
        } catch (error) {
          console.error('Error enabling sync flags on account link:', error);
          // Don't throw - allow account linking to succeed
        }
      }
    },
  },
});

