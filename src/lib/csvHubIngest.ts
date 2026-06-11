import 'server-only';
import { prisma } from '@/lib/db';
import { resolveOrCreateHostForIngest } from '@/lib/hubs';
import { extractSponsorFromText, type SponsorKind } from '@/lib/sponsorExtract';

export interface CsvHubColumns {
  hub_slug?: string;
  hub_name?: string;
  hub_start?: string;
  hub_end?: string;
  hub_timezone?: string;
  hub_location?: string;
  host_slug?: string;
  host_name?: string;
  host_url?: string;
  source?: string;
  sponsored_by?: string;
  sponsor_kind?: string;
  title?: string;
}

export function normalizeSponsorKind(value?: string | null): SponsorKind | null {
  const v = value?.trim().toUpperCase();
  if (v === 'SPONSORED') return 'SPONSORED';
  if (v === 'PARTNERSHIP' || v === 'PARTNER') return 'PARTNERSHIP';
  return null;
}

export function parseCsvSponsorFields(row: CsvHubColumns): {
  sponsoredBy: string | null;
  sponsorKind: SponsorKind | null;
  title: string | undefined;
} {
  let sponsoredBy = row.sponsored_by?.trim() || null;
  let sponsorKind = normalizeSponsorKind(row.sponsor_kind);
  let title = row.title;

  if (!sponsoredBy && title) {
    const extracted = extractSponsorFromText(title);
    if (extracted.sponsoredBy) {
      sponsoredBy = extracted.sponsoredBy;
      sponsorKind = sponsorKind ?? extracted.sponsorKind;
      title = extracted.cleanedText || title;
    }
  }

  return { sponsoredBy, sponsorKind, title };
}

type ParseDateFn = (value?: string) => Date | null;

export class CsvIngestCache {
  private hubs = new Map<string, { id: string; timezone: string | null }>();
  private hosts = new Map<string, string>();
  hubsCreated = 0;
  hostsCreated = 0;

  async resolveHub(
    slug: string,
    row: CsvHubColumns,
    parseDate: ParseDateFn,
    fallbackStart?: Date,
    fallbackEnd?: Date
  ): Promise<{ id: string; timezone: string | null }> {
    const cached = this.hubs.get(slug);
    if (cached) return cached;

    let hub = await prisma.eventHub.findUnique({
      where: { slug },
      select: { id: true, timezone: true },
    });

    if (!hub) {
      const name = row.hub_name?.trim() || slug;
      const start = parseDate(row.hub_start) || fallbackStart;
      const end = parseDate(row.hub_end) || fallbackEnd;
      if (!start || !end) {
        throw new Error(
          `Hub "${slug}" not found. Include hub_name, hub_start, and hub_end to create it.`
        );
      }
      hub = await prisma.eventHub.create({
        data: {
          slug,
          name,
          start,
          end,
          timezone: row.hub_timezone?.trim() || null,
          location: row.hub_location?.trim() || null,
          status: 'UPCOMING',
        },
        select: { id: true, timezone: true },
      });
      this.hubsCreated++;
    }

    const entry = { id: hub.id, timezone: hub.timezone };
    this.hubs.set(slug, entry);
    return entry;
  }

  async resolveHost(hubId: string, row: CsvHubColumns): Promise<string | null> {
    const hostSlug = row.host_slug?.trim();
    const cacheKey = hostSlug
      ? `${hubId}:slug:${hostSlug}`
      : `${hubId}:name:${row.host_name?.trim() || row.source?.trim() || ''}`;

    if (this.hosts.has(cacheKey)) {
      return this.hosts.get(cacheKey)!;
    }

    const result = await resolveOrCreateHostForIngest(hubId, {
      hostSlug: row.host_slug,
      hostName: row.host_name,
      source: row.source,
      websiteUrl: row.host_url,
    });

    if (!result) return null;

    if (result.created) this.hostsCreated++;
    this.hosts.set(cacheKey, result.id);
    if (hostSlug) {
      this.hosts.set(`${hubId}:slug:${hostSlug}`, result.id);
    }
    return result.id;
  }
}

/** Example CSV rows for festival hub bulk upload documentation. */
export const CSV_UPLOAD_TEMPLATE_ROWS = [
  {
    title: 'Leadership Breakfast',
    start: '2026-06-22T10:00:00',
    end: '2026-06-22T11:00:00',
    location: 'Carlton Hotel',
    url: 'https://example.com/iab/breakfast',
    description: 'Morning networking session',
    timezone: 'Europe/Paris',
    source: 'IAB',
    status: 'PENDING',
    tags: 'networking',
    hub_slug: 'cannes-2026',
    hub_name: 'Cannes Lions 2026',
    hub_start: '2026-06-22',
    hub_end: '2026-06-25',
    hub_timezone: 'Europe/Paris',
    host_slug: 'iab',
    host_name: 'IAB',
    host_url: 'https://www.iab.com',
    sponsored_by: 'Google',
    sponsor_kind: 'PARTNERSHIP',
  },
  {
    title: 'CTV Innovation Panel',
    start: '2026-06-22T14:00:00',
    end: '2026-06-22T15:00:00',
    location: 'Amazon Port',
    url: 'https://example.com/yahoo/ctv-panel',
    description: '',
    timezone: 'Europe/Paris',
    source: 'Yahoo',
    status: 'PENDING',
    tags: '',
    hub_slug: 'cannes-2026',
    hub_name: 'Cannes Lions 2026',
    hub_start: '2026-06-22',
    hub_end: '2026-06-25',
    hub_timezone: 'Europe/Paris',
    host_slug: 'yahoo',
    host_name: 'Yahoo',
    host_url: 'https://www.yahoo.com',
    sponsored_by: '',
    sponsor_kind: '',
  },
];
