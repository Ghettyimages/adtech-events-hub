# Event Watch trust audit

The automated extractor treats model output as a proposal. It checks the event title, date range and clock evidence against the captured source before queueing an event. Use the evidence link on a review item to verify the actual page used, even when the event has a separate registration URL.

- Date-only ranges remain all-day through storage, the calendar, Google Calendar and iCalendar. The end date displayed to the user is inclusive; the calendar export end is exclusive. A missing year, an invalid date, or an ambiguous clock/timezone leaves the event unverified. An organizer's multi-day operating hours are not treated as one continuous event.
- A new edition or shared link does not by itself prove a match. Ambiguous matches stay in review and cannot be published from the Event Watch approval control. Published events are updated only by explicit approval; a stale proposal cannot overwrite a newer edit.
- Lightweight checks compare the monitored content to its last processed baseline. Changes to event links and structured data are included. A full verification bypasses conditional validators. If linked-page monitoring is enabled, selected detail pages are fetched and extracted separately. An incomplete scan preserves the previous successful baseline.
- Scan results distinguish verified no-change checks, incomplete checks, retrieval failures, and review proposals. Date comparison uses source dates, not a synthetic 8 AM–6 PM range.

## Verification

Run `npm run test:event-watch:trust`, `npx tsc --noEmit`, and ESLint on the changed TypeScript files. The regression suite includes the Advertising Week New York September 27–30, 2027 pasted example, source date conflicts, invalid dates, DST, reused URLs, content fingerprinting, incomplete checks, approval decisions, and scan-history display.

A spot check against the [IAB organizer page](https://www.iab.com/events/2027-iab-annual-leadership-meeting/) verified the February 1–3, 2027 range with the evidence guard. That check verifies the date comparison for one captured page; it does not measure extraction coverage or confirm a scheduled scan.

## Preview acceptance

1. Verify the preview is linked to the staging database. Add a controlled source with one date-only event and one timed event with an explicit timezone. Scan twice, and verify that the second check skips extraction. Change the date and registration link; confirm one review proposal with the original source evidence.
2. Test a blocked or incomplete source, a linked-page-only change, and a reused URL from an earlier edition. Confirm that none advances the successful baseline or overwrites a published record. Exercise approval and rejection, including an edit to a record after a proposal was created.
3. Verify the separate GitHub Actions workflow on `chore/event-watch-testing-scheduler` targets the protected testing URL. It uses `EVENT_WATCH_TESTING_URL`, `EVENT_WATCH_CRON_SECRET` and `VERCEL_AUTOMATION_BYPASS_SECRET`. Configure these directly in GitHub if missing. Review and merge only the scheduler workflow to the default branch when approved, then verify an actual scheduled run in GitHub Actions and Event Watch history.

The default branch has not been changed by this audit. A passing local suite is not a substitute for a real staging scan, review transaction, and scheduled check. Sources whose date evidence is unclear may require a source-specific adapter or manual review. A source's own published facts can still be wrong or later change.
