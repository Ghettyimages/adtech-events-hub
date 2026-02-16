import type { Metadata, Viewport } from 'next';
import './globals.css';
import Link from 'next/link';
import SessionProvider from '@/components/SessionProvider';
import MobileNav from '@/components/MobileNav';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0B2A66',
};

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
          <header className="bg-tmc-gradient text-white shadow-lg">
            <div className="container mx-auto px-4 py-4">
              <MobileNav />
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
                  <Link href="/terms" className="hover:underline py-2 min-h-[44px] flex items-center justify-center">
                    Terms
                  </Link>
                  <Link href="/privacy" className="hover:underline py-2 min-h-[44px] flex items-center justify-center">
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
