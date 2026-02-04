'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';

export default function AuthNav() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return (
      <div className="text-white text-sm opacity-70">Loading...</div>
    );
  }

  if (session) {
    const isOrganizerOrAdmin =
      (session.user as any)?.isOrganizer || (session.user as any)?.isAdmin;

    return (
      <div className="flex gap-4 items-center">
        <Link
          href="/subscriptions"
          className="text-white hover:underline text-sm"
        >
          My Subscriptions
        </Link>
        <Link
          href="/speaker-profile"
          className="text-white hover:underline text-sm"
        >
          Speaker Profile
        </Link>
        {isOrganizerOrAdmin && (
          <Link
            href="/speakers"
            className="text-white hover:underline text-sm"
          >
            Speakers
          </Link>
        )}
        <Link
          href="/profile"
          className="text-white hover:underline text-sm"
        >
          Account
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="text-white hover:underline text-sm"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <Link
      href="/login"
      className="text-white hover:underline text-sm"
    >
      Sign In
    </Link>
  );
}

