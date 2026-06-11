# Event Hubs (Festival Hubs)

## Overview

Event Hubs model major festivals (Cannes Lions, CES, POSSIBLE) as a separate layer:

- **Hub** — the festival (e.g. `cannes-2026`)
- **Host** — company or org running side events (e.g. IAB, Yahoo)
- **Event** — individual schedulable items (existing `Event` model)

Hub-scoped events are excluded from the main calendar and FULL iCal feed by default (`hubId` set, `showOnMainCalendar: false`).

## Public routes

| Route | Description |
|-------|-------------|
| `/hubs` | Hub index |
| `/hubs/[slug]` | Hub home — host grid |
| `/hubs/[slug]/[hostSlug]` | Host timeline |

## Subscriptions

- Kind: `HUB` on `Subscription`
- Filter JSON: `{ "hubSlug": "cannes-2026", "hostSlugs": ["iab"], "tags": [] }`
- **Google Calendar (primary):** Sign in, subscribe on the hub or host page, connect Google Calendar. A dedicated calendar named after the festival (e.g. `Cannes Lions 2026`) is created and events sync automatically. Host-scoped subscriptions share the same festival calendar; only matching events sync.
- **iCal feed (secondary):** `GET /api/feed/hub?token=...&hub=cannes-2026` — available from subscribe modal “Other options”, subscriptions page, and per-event Download .ics
- Event titles in feeds and Google Calendar are prefixed with hub label, e.g. `[Cannes]`
- API: `POST /api/mine/gcal/hub/ensure`, `POST /api/mine/gcal/hub/sync`, `GET /api/mine/gcal/hub/status?hubSlug=`

## Admin

- **Festival Hubs** tab: status, hosts list, link to public page
- **Host events**: expand **Events (N)** under any host to view/edit published and pending events (opens the same edit modal as the Events tab)
- **Bulk fill**: under each host, use **Bulk fill fields** to set URL, location, or source for many events at once (`only fill empty` or `overwrite all`; respects All/Published/Pending scope). **Tags**: add tags (skips if already present) or remove specific tags (other tags unchanged)
- **Schedule import**: optional **Event page URL** is stored on each event’s `url` field; host name is stored as `source`
- CSV columns: `hub_slug`, `host_slug`
- Scrape POST body: `hubSlug`, `hostSlug`
- Assign event: `PATCH /api/admin/events/[id]/hub`
- List host events: `GET /api/admin/hub-hosts/[id]/events`
- Bulk update host events: `PATCH /api/admin/hub-hosts/[id]/events/bulk`

## Seed

```bash
npm run seed:cannes-hub
```

## Post-v1 follow-ups

1. **Main calendar spotlight** — single FullCalendar anchor for active hubs
2. **Explore map** — force-directed host constellation on hub home
3. **Public hub event submit** — pending queue per hub/host
4. **MonitoredUrl.hubHostId** — tie scrape URLs to hosts
