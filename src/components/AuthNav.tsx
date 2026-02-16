'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';

interface AuthNavProps {
  mobile?: boolean;
}

export default function AuthNav({ mobile }: AuthNavProps) {
  const { data: session, status } = useSession();

  const linkClass = mobile
    ? 'min-h-[44px] flex items-center px-4 text-white hover:bg-white/10 rounded-lg transition w-full'
    : 'text-white hover:underline text-sm';
  const buttonClass = mobile
    ? 'min-h-[44px] flex items-center px-4 text-white hover:bg-white/10 rounded-lg transition w-full text-left'
    : 'text-white hover:underline text-sm';
  const containerClass = mobile ? 'flex flex-col gap-1 w-full' : 'flex gap-4 items-center';

  if (status === 'loading') {
    return (
      <div className="text-white text-sm opacity-70">Loading...</div>
    );
  }

  if (session) {
    const isOrganizerOrAdmin =
      (session.user as any)?.isOrganizer || (session.user as any)?.isAdmin;

    return (
      <div className={containerClass}>
        <Link href="/subscriptions" className={linkClass}>
          My Subscriptions
        </Link>
        <Link href="/speaker-profile" className={linkClass}>
          Speaker Profile
        </Link>
        {isOrganizerOrAdmin && (
          <Link href="/speakers" className={linkClass}>
            Speakers
          </Link>
        )}
        <Link href="/profile" className={linkClass}>
          Account
        </Link>
        <button onClick={() => signOut({ callbackUrl: '/' })} className={buttonClass}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <Link href="/login" className={linkClass}>
      Sign In
    </Link>
  );
}

