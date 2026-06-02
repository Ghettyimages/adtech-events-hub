'use client';

import type { HubTheme } from '@/lib/hubs-client';

interface HubThemeWrapperProps {
  theme?: HubTheme;
  children: React.ReactNode;
  className?: string;
}

export default function HubThemeWrapper({ theme, children, className = '' }: HubThemeWrapperProps) {
  const style: React.CSSProperties = {
    ['--hub-accent' as string]: theme?.accent ?? '#C9A227',
    ['--hub-surface' as string]: theme?.surface ?? '#F5F0E8',
    background: theme?.surface ?? undefined,
  };

  return (
    <div
      className={`hub-themed min-h-screen text-tmc-ink ${className}`}
      style={{ ...style, colorScheme: 'light' }}
    >
      {children}
    </div>
  );
}
