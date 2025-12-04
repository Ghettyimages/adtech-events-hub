import NextAuth, { NextAuthOptions } from 'next-auth';
import EmailProvider from 'next-auth/providers/email';
import GoogleProvider from 'next-auth/providers/google';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/db';
import { randomBytes } from 'crypto';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    EmailProvider({
      server: process.env.EMAIL_SERVER || {
        host: process.env.EMAIL_SERVER_HOST,
        port: Number(process.env.EMAIL_SERVER_PORT),
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM || 'noreply@example.com',
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/calendar',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
        
        try {
          // Fetch user from DB to get feedToken and profile data
          const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: {
              feedToken: true,
              name: true,
              company: true,
              title: true,
              companyEmail: true,
              location: true,
              consentEmail: true,
              consentCalendar: true,
            },
          });

          if (dbUser) {
            // Generate feedToken if it doesn't exist (first login)
            if (!dbUser.feedToken) {
              const feedToken = randomBytes(32).toString('hex');
              await prisma.user.update({
                where: { id: user.id },
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
          }
        } catch (error) {
          console.error('Error in session callback:', error);
          // Return session even if there's an error
        }
      }
      return session;
    },
  },
  session: {
    strategy: 'database',
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };

