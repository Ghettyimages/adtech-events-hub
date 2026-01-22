import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';
import Image from 'next/image';
import SessionProvider from '@/components/SessionProvider';
import AuthNav from '@/components/AuthNav';

export const metadata: Metadata = {
  title: 'The Media Calendar',
  description: 'The one-stop-shop for all adtech and media events',
  icons: {
    icon: [
      { url: '/icon.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [
      { url: '/icon.png', sizes: '180x180', type: 'image/png' },
    ],
    shortcut: '/icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <SessionProvider>
          <header className="bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg">
            <div className="container mx-auto px-4 py-4">
              <nav className="flex items-center justify-between">
                <Link href="/" className="flex items-center gap-2 text-2xl font-bold hover:opacity-90 transition">
                  <Image
                    src="/logo.png"
                    alt="TMC Logo"
                    width={40}
                    height={40}
                    className="rounded"
                  />
                  The Media Calendar
                </Link>
                <div className="flex gap-4 items-center">
                  <Link
                    href="/submit"
                    className="bg-white text-blue-600 px-4 py-2 rounded-lg font-semibold hover:bg-blue-50 transition"
                  >
                    Submit Event
                  </Link>
                  <Link
                    href="/admin"
                    className="text-white hover:underline text-sm"
                  >
                    Admin
                  </Link>
                  <AuthNav />
                </div>
              </nav>
            </div>
          </header>
          <main className="min-h-screen">{children}</main>
          <footer className="bg-gray-100 dark:bg-gray-900 border-t mt-12">
            <div className="container mx-auto px-4 py-6 text-center text-gray-600 dark:text-gray-400">
              <div className="flex flex-col gap-2 items-center">
                <p>
                  The Media Calendar &copy; {new Date().getFullYear()} | Built with Next.js, Prisma &amp; FullCalendar
                </p>
                <div className="flex gap-4 text-sm">
                  <Link href="/terms" className="hover:underline">
                    Terms
                  </Link>
                  <Link href="/privacy" className="hover:underline">
                    Privacy
                  </Link>
                </div>
              </div>
            </div>
          </footer>
        </SessionProvider>
      </body>
    </html>
  );
}
