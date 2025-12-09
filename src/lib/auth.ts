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
        host: process.env.EMAIL_SERVER_HOST || 'localhost',
        port: Number(process.env.EMAIL_SERVER_PORT) || 587,
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM || 'noreply@example.com',
      // In development, log the magic link to console instead of sending email
      sendVerificationRequest: async ({ identifier, url, provider }) => {
        // Always log the magic link in development for easy testing
        if (process.env.NODE_ENV === 'development') {
          console.log('\n🔐 Magic Link for', identifier);
          console.log('👉 Click this link to sign in:', url);
          console.log('⚠️  In production, this would be sent via email\n');
        }
        
        // If email server is configured, try to send the email
        if (process.env.EMAIL_SERVER_HOST && process.env.EMAIL_SERVER_USER) {
          try {
            const { host, port, auth } = provider.server as any;
            const nodemailer = (await import('nodemailer')).default;
            const transport = nodemailer.createTransport({
              host,
              port,
              auth,
            });
            
            await transport.sendMail({
              to: identifier,
              from: provider.from,
              subject: 'Sign in to AdTech Events Hub',
              text: `Sign in to AdTech Events Hub\n\nClick this link to sign in:\n${url}\n\nThis link will expire in 24 hours.`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                  <h2>Sign in to AdTech Events Hub</h2>
                  <p>Click the button below to sign in:</p>
                  <a href="${url}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0;">Sign In</a>
                  <p>Or copy and paste this link into your browser:</p>
                  <p style="word-break: break-all; color: #666;">${url}</p>
                  <p style="color: #999; font-size: 12px; margin-top: 30px;">This link will expire in 24 hours.</p>
                </div>
              `,
            });
            if (process.env.NODE_ENV === 'development') {
              console.log('✅ Email sent successfully');
            }
          } catch (error) {
            console.error('❌ Failed to send email:', error);
            if (process.env.NODE_ENV === 'development') {
              console.log('📋 Use the link above to sign in manually');
            }
            // In development, don't throw error - just log it
            // In production, re-throw so NextAuth can handle it
            if (process.env.NODE_ENV === 'production') {
              throw error;
            }
          }
        } else if (process.env.NODE_ENV === 'development') {
          // In development without email config, just log the link
          // This allows testing without setting up email
          console.log('\n⚠️  Email server not configured. Magic link:', url);
          console.log('📋 Set EMAIL_SERVER_HOST, EMAIL_SERVER_USER, and EMAIL_SERVER_PASSWORD to send emails\n');
        } else {
          // In production without email config, throw an error with a clear message
          const error = new Error('Email server not configured');
          console.error('❌ Email authentication failed: Email server not configured. Set EMAIL_SERVER_HOST, EMAIL_SERVER_USER, and EMAIL_SERVER_PASSWORD environment variables.');
          throw error;
        }
      },
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
    async redirect({ url, baseUrl }) {
      // If url is a relative URL, make it absolute
      if (url.startsWith('/')) {
        url = `${baseUrl}${url}`;
      }
      // If url is on the same origin, allow it
      // Profile completion check will be handled by middleware
      if (new URL(url).origin === baseUrl) {
        return url;
      }
      // Otherwise, return baseUrl
      return baseUrl;
    },
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
            
            // Add profile completion status to session
            const isProfileComplete = !!(
              dbUser.name &&
              dbUser.company &&
              dbUser.title &&
              dbUser.companyEmail &&
              dbUser.location
            );
            (session.user as any).isProfileComplete = isProfileComplete;
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

// Export handlers for use in API route
// NextAuth v4 App Router pattern
export const { handlers } = NextAuth(authOptions);

