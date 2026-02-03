import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      feedToken?: string | null;
      company?: string | null;
      title?: string | null;
      companyEmail?: string | null;
      location?: string | null;
      consentEmail?: boolean;
      consentCalendar?: boolean;
      isProfileComplete?: boolean;
      isAdmin?: boolean;
      isOrganizer?: boolean;
    };
  }

  interface User {
    id: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
  }
}

