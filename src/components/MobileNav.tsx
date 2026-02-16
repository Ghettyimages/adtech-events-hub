'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import AuthNav from '@/components/AuthNav';

export default function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);

  const closeDrawer = () => setIsOpen(false);

  return (
    <>
      <nav className="flex items-center justify-between w-full">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg md:text-2xl font-bold hover:opacity-90 transition"
          onClick={closeDrawer}
        >
          <Image
            src="/logo.png"
            alt="TMC Logo"
            width={80}
            height={80}
            className="rounded w-12 h-12 md:w-20 md:h-20"
          />
          The Media Calendar
        </Link>
        {/* Desktop nav - unchanged */}
        <div className="hidden md:flex gap-4 items-center">
          <Link
            href="/submit"
            className="bg-white text-tmc-navy px-4 py-2 rounded-lg font-semibold hover:bg-slate-50 transition"
          >
            Submit Event
          </Link>
          <Link href="/admin" className="text-white hover:underline text-sm">
            Admin
          </Link>
          <AuthNav />
        </div>
        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="md:hidden p-3 -m-3 min-h-[44px] min-w-[44px] flex items-center justify-center text-white hover:bg-white/10 rounded-lg transition"
          aria-label="Open menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </nav>

      {/* Mobile drawer overlay */}
      {isOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/50 z-40"
            onClick={closeDrawer}
            aria-hidden
          />
          <div className="md:hidden fixed inset-y-0 right-0 w-full max-w-xs bg-tmc-navy shadow-2xl z-50 flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-white/20">
              <span className="text-white font-bold">Menu</span>
              <button
                type="button"
                onClick={closeDrawer}
                className="p-3 -m-3 min-h-[44px] min-w-[44px] flex items-center justify-center text-white hover:bg-white/10 rounded-lg transition"
                aria-label="Close menu"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col p-4 gap-1 overflow-y-auto">
              <Link
                href="/submit"
                onClick={closeDrawer}
                className="min-h-[44px] flex items-center px-4 rounded-lg bg-white text-tmc-navy font-semibold hover:bg-slate-50 transition"
              >
                Submit Event
              </Link>
              <Link
                href="/admin"
                onClick={closeDrawer}
                className="min-h-[44px] flex items-center px-4 text-white hover:bg-white/10 rounded-lg transition"
              >
                Admin
              </Link>
              <div className="border-t border-white/20 my-2" />
              <AuthNav mobile />
            </div>
          </div>
        </>
      )}
    </>
  );
}
