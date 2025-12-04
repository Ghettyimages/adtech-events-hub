/**
 * Schema for extracted events
 */

export type ExtractedEvent = {
  title: string;
  start?: string; // ISO date string
  end?: string; // ISO date string
  location?: string;
  url?: string;
  description?: string;
  source?: string;
  date_status: 'confirmed' | 'tbd';
  evidence?: string;
  evidence_context?: string;
  location_status: 'confirmed' | 'tbd';
  location_evidence?: string;
  location_evidence_context?: string;
  // NEW: tags and structured location fields
  tags?: string[];
  country?: string;
  region?: string; // State/province
  city?: string;
};

