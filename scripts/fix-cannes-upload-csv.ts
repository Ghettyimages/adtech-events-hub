/**
 * Fix Cannes 2026 upload CSV, export Excel with time-issue highlights,
 * and include a sheet of live hub hosts from the database.
 *
 * Run: npx tsx scripts/fix-cannes-upload-csv.ts
 */
import { config } from 'dotenv';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import Papa from 'papaparse';
import ExcelJS from 'exceljs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ROOT = process.cwd();
for (const f of ['.env', '.env.local']) {
  const p = resolve(ROOT, f);
  if (existsSync(p)) config({ path: p, override: true });
}

const INPUT = resolve(
  ROOT,
  'data/copy-events-upload-template-cannes-2026-digital-voice.csv'
);
const OUT_CSV = resolve(
  ROOT,
  'data/copy-events-upload-template-cannes-2026-digital-voice-fixed.csv'
);
const OUT_XLSX = resolve(
  ROOT,
  'data/copy-events-upload-template-cannes-2026-digital-voice-fixed.xlsx'
);

const HEADERS = [
  'title',
  'start',
  'end',
  'location',
  'url',
  'description',
  'timezone',
  'source',
  'status',
  'tags',
  'hub_slug',
  'hub_name',
  'hub_start',
  'hub_end',
  'hub_timezone',
  'host_slug',
  'host_name',
  'host_url',
  'sponsored_by',
  'sponsor_kind',
  'time_issue_notes',
] as const;

type Row = Record<(typeof HEADERS)[number], string>;

interface TimeIssue {
  field: 'start' | 'end';
  note: string;
}

function parseRow(raw: Record<string, string>): Row {
  const row = {} as Row;
  for (const h of HEADERS) {
    if (h === 'time_issue_notes') {
      row[h] = '';
      continue;
    }
    row[h] = (raw[h] ?? '').trim();
  }
  return row;
}

function normalizeStatus(status: string): string {
  const s = status.trim().toLowerCase();
  if (s === 'published') return 'PUBLISHED';
  if (s === 'needs_review') return 'PENDING';
  if (s === 'pending') return 'PENDING';
  return status.toUpperCase() === 'PUBLISHED' ? 'PUBLISHED' : 'PENDING';
}

function buildLiveSlugLookup(
  liveHosts: Array<{ slug: string; name: string; sourceAlias: string | null }>
) {
  const bySlug = new Map<string, string>();
  const byName = new Map<string, string>();

  for (const h of liveHosts) {
    bySlug.set(slugKey(h.slug), h.slug);
    byName.set(nameKey(h.name), h.slug);
    if (h.sourceAlias) byName.set(nameKey(h.sourceAlias), h.slug);
  }

  return { bySlug, byName };
}

function alignSlugToLive(
  slug: string,
  name: string,
  lookup: ReturnType<typeof buildLiveSlugLookup>
): string {
  if (!slug) return slug;
  return (
    lookup.bySlug.get(slugKey(slug)) ??
    lookup.byName.get(nameKey(name)) ??
    slug
  );
}

function mergeHostName(slug: string, name: string): string {
  if (slug === 'microsoft-beach-house') return 'Microsoft';
  if (slug === 'adweek-house') return 'ADWEEK';
  return name;
}

function detectTimeIssues(row: Row): TimeIssue[] {
  const issues: TimeIssue[] = [];
  const start = row.start.trim();
  const end = row.end.trim();

  if (!start) {
    issues.push({ field: 'start', note: 'Missing start date/time' });
    return issues;
  }

  if (/T\d{2}:\d{2}:\d{2}/.test(start)) {
    const mins = Number(start.match(/T(\d{2}):(\d{2})/)?.[2]);
    if (mins > 59) {
      issues.push({ field: 'start', note: 'Invalid minutes in start time' });
    }
  }

  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) {
    issues.push({ field: 'start', note: 'Unparseable start datetime' });
  }

  if (!end) {
    if (start) issues.push({ field: 'end', note: 'Missing end time' });
    return issues;
  }

  const endDate = new Date(end);
  if (Number.isNaN(endDate.getTime())) {
    issues.push({ field: 'end', note: 'Unparseable end datetime' });
    return issues;
  }

  if (!Number.isNaN(startDate.getTime()) && endDate < startDate) {
    issues.push({
      field: 'end',
      note: 'End is before start (likely needs next-day end time)',
    });
  }

  return issues;
}

function fixDigidayStart(start: string): string {
  if (start.includes('T43:75')) return '2026-06-23T10:45:00';
  if (start === '2026-06-23T06:25:00') return '2026-06-23T06:25:00';
  return start;
}

function fixOvernightEnd(start: string, end: string): string {
  if (!start || !end) return end;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return end;
  if (e >= s) return end;

  const next = new Date(e);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().replace('.000Z', '');
}

function mergeHostSlug(slug: string): string {
  if (slug === 'microsoft-beach-house') return 'microsoft';
  if (slug === 'adweek-house') return 'adweek';
  return slug;
}

function applyRowFixes(
  row: Row,
  liveLookup?: ReturnType<typeof buildLiveSlugLookup>
): Row {
  const out = { ...row };
  const title = out.title;
  const titleLower = title.toLowerCase();
  const hostSlug = out.host_slug;

  out.status = normalizeStatus(out.status);
  out.host_slug = mergeHostSlug(out.host_slug);
  out.host_name = mergeHostName(hostSlug, out.host_name);

  if (liveLookup) {
    out.host_slug = alignSlugToLive(out.host_slug, out.host_name, liveLookup);
  }

  if (title.includes("TWIPN Women's Leadership Breakfast")) {
    out.host_slug = 'twipn';
    out.host_name = 'The Women in Programmatic Network';
    out.sponsored_by = 'EX.CO & IntentIQ';
    out.sponsor_kind = 'PARTNERSHIP';
  }

  if (titleLower.includes('commerce connections presented by smg')) {
    out.sponsored_by = out.sponsored_by || 'SMG';
    out.sponsor_kind = out.sponsor_kind || 'SPONSORED';
  }

  if (titleLower.startsWith('gelato on the croisette')) {
    out.host_slug = 'the-media-trust';
    out.host_name = 'The Media Trust';
    out.sponsored_by = 'Index Exchange & Assertive Yield';
    out.sponsor_kind = 'PARTNERSHIP';
  }

  if (titleLower.includes('get sh*t done x cannes')) {
    out.sponsored_by = 'Bauer Media & Badberries';
    out.sponsor_kind = 'PARTNERSHIP';
  }

  if (titleLower.includes('samsung x glance')) {
    out.sponsored_by = out.sponsored_by || 'Samsung & Glance';
    out.sponsor_kind = out.sponsor_kind || 'PARTNERSHIP';
  }

  if (title.includes('Strong Women Walk: Saint-Honorat')) {
    out.sponsored_by = 'Optima';
    out.sponsor_kind = 'SPONSORED';
    out.host_slug = 'playwell-co';
    out.host_name = 'Playwell Co';
  }

  out.start = fixDigidayStart(out.start);

  if (
    titleLower.includes('from data to goals: the world cup in cannes') ||
    titleLower.includes("triplelift's late night party") ||
    titleLower.includes('tiesto live at cannes lions')
  ) {
    out.end = fixOvernightEnd(out.start, out.end);
  }

  const issues = detectTimeIssues(out);
  out.time_issue_notes = issues.map((i) => `${i.field}: ${i.note}`).join('; ');

  return out;
}

async function fetchLiveHosts() {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL not set — live hosts sheet will be empty.');
    return [] as Array<{ slug: string; name: string; sourceAlias: string | null }>;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const hub = await prisma.eventHub.findUnique({
      where: { slug: 'cannes-2026' },
      include: {
        hosts: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { slug: true, name: true, sourceAlias: true },
        },
      },
    });
    return hub?.hosts ?? [];
  } finally {
    await prisma.$disconnect();
  }
}

function slugKey(slug: string): string {
  return slug.trim().toLowerCase();
}

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function compareHosts(
  sheetHosts: Array<{ slug: string; name: string }>,
  liveHosts: Array<{ slug: string; name: string; sourceAlias: string | null }>
) {
  const sheetSlugKeys = new Map<string, { slug: string; name: string }>();
  for (const h of sheetHosts) {
    if (!h.slug) continue;
    sheetSlugKeys.set(slugKey(h.slug), h);
  }

  const liveSlugKeys = new Map(liveHosts.map((h) => [slugKey(h.slug), h]));
  const liveNameKeys = new Map<string, typeof liveHosts[number]>();
  for (const h of liveHosts) {
    liveNameKeys.set(nameKey(h.name), h);
    if (h.sourceAlias) liveNameKeys.set(nameKey(h.sourceAlias), h);
  }

  const onlyInSheet: Array<{
    slug: string;
    name: string;
    possibleLiveMatch?: string;
  }> = [];
  const matchedLiveSlugs = new Set<string>();

  for (const [key, h] of sheetSlugKeys) {
    if (liveSlugKeys.has(key)) {
      matchedLiveSlugs.add(key);
      continue;
    }
    const byName = liveNameKeys.get(nameKey(h.name));
    onlyInSheet.push({
      slug: h.slug,
      name: h.name,
      possibleLiveMatch: byName
        ? `${byName.slug} (${byName.name})`
        : undefined,
    });
  }

  const onlyLive = liveHosts.filter((h) => !matchedLiveSlugs.has(slugKey(h.slug)));

  const exactSlugMatches = liveHosts.filter((h) => sheetSlugKeys.has(slugKey(h.slug)));

  return { onlyInSheet, onlyLive, exactSlugMatches };
}

async function main() {
  if (!existsSync(INPUT)) {
    console.error(`Input not found: ${INPUT}`);
    process.exit(1);
  }

  const text = readFileSync(INPUT, 'utf8');
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const liveHosts = await fetchLiveHosts();
  const liveLookup = buildLiveSlugLookup(liveHosts);

  const rows = parsed.data
    .map(parseRow)
    .map((row) => applyRowFixes(row, liveLookup));
  const sheetHostMap = new Map<string, { slug: string; name: string }>();
  for (const r of rows) {
    if (!r.host_slug) continue;
    sheetHostMap.set(r.host_slug, { slug: r.host_slug, name: r.host_name });
  }
  const sheetHosts = [...sheetHostMap.values()];
  const comparison = compareHosts(sheetHosts, liveHosts);
  const sheetSlugKeys = new Set(sheetHosts.map((h) => slugKey(h.slug)));

  const csvBody = Papa.unparse(
    rows.map((r) => {
      const o: Record<string, string> = {};
      for (const h of HEADERS) o[h] = r[h] ?? '';
      return o;
    }),
    { columns: [...HEADERS] }
  );
  writeFileSync(OUT_CSV, csvBody, 'utf8');

  const wb = new ExcelJS.Workbook();
  const eventsSheet = wb.addWorksheet('events-upload-template');
  const hostsSheet = wb.addWorksheet('slug-host-source');
  const compareSheet = wb.addWorksheet('host-comparison');

  const yellowFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFFF00' },
  };

  eventsSheet.addRow([...HEADERS]);
  const headerRow = eventsSheet.getRow(1);
  headerRow.font = { bold: true };

  const startCol = HEADERS.indexOf('start') + 1;
  const endCol = HEADERS.indexOf('end') + 1;
  const notesCol = HEADERS.indexOf('time_issue_notes') + 1;

  for (const row of rows) {
    const values = HEADERS.map((h) => row[h] ?? '');
    const excelRow = eventsSheet.addRow(values);
    const issues = detectTimeIssues(row);
    for (const issue of issues) {
      const col = issue.field === 'start' ? startCol : endCol;
      excelRow.getCell(col).fill = yellowFill;
    }
    if (issues.length > 0) {
      excelRow.getCell(notesCol).fill = yellowFill;
    }
  }

  eventsSheet.columns = HEADERS.map((h) => ({
    header: h,
    key: h,
    width: h === 'description' ? 48 : h === 'title' ? 36 : 18,
  }));

  hostsSheet.addRow(['host_slug', 'host_name', 'source_alias', 'in_upload_sheet']);
  hostsSheet.getRow(1).font = { bold: true };
  for (const h of liveHosts) {
    const inSheet =
      sheetSlugKeys.has(slugKey(h.slug)) ||
      sheetHosts.some((s) => nameKey(s.name) === nameKey(h.name));
    hostsSheet.addRow([
      h.slug,
      h.name,
      h.sourceAlias ?? '',
      inSheet ? 'yes' : 'no',
    ]);
  }

  compareSheet.addRow(['category', 'host_slug', 'host_name', 'notes']);
  compareSheet.getRow(1).font = { bold: true };
  for (const h of comparison.exactSlugMatches) {
    compareSheet.addRow([
      'exact_slug_match',
      h.slug,
      h.name,
      'Sheet uses same slug — will reuse live host on upload',
    ]);
  }
  for (const h of comparison.onlyInSheet.sort((a, b) =>
    a.slug.localeCompare(b.slug)
  )) {
    compareSheet.addRow([
      'new_in_sheet_only',
      h.slug,
      h.name,
      h.possibleLiveMatch
        ? `Possible live match by name: ${h.possibleLiveMatch}`
        : 'Will create a new host on upload unless matched by name/alias',
    ]);
  }
  for (const h of comparison.onlyLive) {
    const inSheetByName = sheetHosts.find(
      (s) => nameKey(s.name) === nameKey(h.name)
    );
    compareSheet.addRow([
      'live_only_not_in_sheet',
      h.slug,
      h.name,
      inSheetByName
        ? `Sheet uses different slug: ${inSheetByName.slug}`
        : h.sourceAlias
          ? `sourceAlias: ${h.sourceAlias}`
          : 'Not referenced in upload sheet',
    ]);
  }

  compareSheet.columns = [
    { width: 24 },
    { width: 28 },
    { width: 36 },
    { width: 48 },
  ];

  await wb.xlsx.writeFile(OUT_XLSX);

  const issueCount = rows.filter((r) => r.time_issue_notes).length;
  console.log(`Fixed CSV: ${OUT_CSV}`);
  console.log(`Excel (yellow = time issues): ${OUT_XLSX}`);
  console.log(`Rows: ${rows.length}`);
  console.log(`Unique host_slug in sheet: ${sheetHosts.length}`);
  console.log(`Live hosts in DB: ${liveHosts.length}`);
  console.log(`Exact slug matches with live: ${comparison.exactSlugMatches.length}`);
  console.log(`New hosts in sheet (not live yet): ${comparison.onlyInSheet.length}`);
  console.log(`Live hosts not in sheet: ${comparison.onlyLive.length}`);
  console.log(`Rows with remaining time issues (highlighted): ${issueCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
