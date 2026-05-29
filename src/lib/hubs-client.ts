/** Client-safe hub types (no server-only imports) */

export interface HubTheme {
  accent?: string;
  heroGradient?: string;
  surface?: string;
  label?: string;
}

export interface HubHostSummary {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  websiteUrl?: string | null;
  description?: string | null;
  featured: boolean;
  eventCount: number;
}

export interface HubSummary {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  start: string;
  end: string;
  timezone: string | null;
  location: string | null;
  status: string;
  theme?: HubTheme;
  eventCount: number;
  hostCount: number;
  hosts: HubHostSummary[];
}

export interface HubPreviewEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string | null;
}
