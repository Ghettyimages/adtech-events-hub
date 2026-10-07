# Event Watch

Event Watch checks official sources, saves every check, and queues new events or proposed updates for admin review. Published events change only when an admin approves a proposal.

## What a check does

An ordinary check is lightweight:

1. Send `If-None-Match` or `If-Modified-Since` from the last **successfully extracted** version, when the source provided those validators.
2. Otherwise download the page, remove navigation, ads, cookie banners, and tracking parameters, and hash the remaining event content.
3. Skip AI extraction when that hash matches the last successful extraction, or when the server returns HTTP 304 for a source that does not need a browser and already has a processed baseline.
4. A browser-rendered agenda is hashed from the rendered page. A static HTML shell or a 304 of that shell is not treated as proof that the agenda is unchanged.
5. If linked event pages are enabled for the source, an unchanged listing does not skip extraction while those pages are unchecked or their content changed. Detail checks are capped at 8 pages, two at a time.

Full extraction still runs on a schedule even when the hash matches, so a missed change can be caught. The default is **7 days** (`fullVerificationIntervalMs`, 604800000). Force full scan bypasses the hash and validators for one check. It still uses the normal authentication, source limits, and the lock that prevents two checks of the same source at once.

A failed or incomplete extraction does not move the processed baseline. The next check cannot skip just because the failed attempt already downloaded the page.

Missing fields are not treated as deletions. An agenda that returns no events does not cancel or delete calendar events.

## Review

New events use the existing pending-event queue. Changes to existing events show the field, the previous value, and the proposed value. Approving writes only those fields. If the event was edited after the proposal was created, approval is refused until the source is checked again. Rejecting leaves the published event as it is. The same rejected proposal is not opened again. A later, different proposal can be reviewed.

The first time a source is tied to an existing event, that check establishes a baseline. If the source and the calendar already disagree, the review item is a discrepancy, not a claim that the source just changed.

Checks saved before this history existed are labeled as earlier checks. Their before/after details were not reconstructed.

## Scheduler

Vercel Cron runs against production deployments, so it does not call the Event Watch preview. The testing scheduler is a GitHub Actions workflow on `main` that calls the preview endpoint every six hours. Each source still uses its own interval, and only enabled sources that are due and inside their stop date are selected.

Automatic scheduling is not active until that workflow is on `main` and the secrets below exist. Do not turn off Vercel Deployment Protection.

### GitHub Actions secrets

Set these on the repository (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `EVENT_WATCH_TESTING_URL` | `https://<preview-host>/api/cron/event-watch` |
| `EVENT_WATCH_CRON_SECRET` | The preview `CRON_SECRET` |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Protection Bypass for Automation for the Vercel project |

The workflow allows only `https` URLs on `*.vercel.app` and does not follow redirects, so the secret is not sent to another host.

Preview and staging runtime and migrations use `STORAGE_DATABASE_URL`. If that value is missing, or if it is the same as `DATABASE_URL`, the app throws instead of using the production database. Approvals on preview/staging do not queue Google Calendar sync.

## Coverage limits

Compared fields are title, dates, times, all-day versus timed, timezone, location, city, region, country, event URL, and description. Price, speakers, and sponsors are not compared. Sources that share an agenda URL and have no event id or dedicated URL are kept apart by title and edition, and same-named sessions are flagged for review instead of merged.
