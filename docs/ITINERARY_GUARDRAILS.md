# My Itinerary — Guardrails & API Spec

Personal named collections (e.g. **My Cannes 2026 Itinerary**) separate from festival hub subscriptions. Users add events, hosts, or entire hubs; optional dedicated Google Calendar sync.

## Constants

Defined in `src/lib/itineraryConstants.ts`:

| Constant | Value | Purpose |
|----------|-------|---------|
| `MAX_PER_USER` | 10 | Hard cap on itineraries per user |
| `MAX_GCAL_CONNECTED` | 5 | Hard cap on itineraries with `gcalSyncEnabled` |
| `MAX_EVENTS` | 500 | Resolved event cap per itinerary |
| `MAX_GCAL_UPSERTS_PER_REQUEST` | 10 | Inline GCal sync before queueing |
| `SYNC_BATCH_SIZE` | 25 | Events per chunk during sync (150ms pause) |
| `CRON_TAKE` | 50 | Pending itineraries per cron run |
| `PREVIEW_CONFIRM_THRESHOLD` | 20 | Require `confirmLargeAdd` when adding more events |
| `MAX_VISIBLE_OVERLAP_COLUMNS` | 3 | Timeline UI column cap |
| `MIN_EVENT_BLOCK_HEIGHT_PX` | 44 | Minimum touch target in timeline |
| `ITINERARY_GCAL_PREFIX` | `TMC: ` | Google Calendar summary prefix |

## Festival hub GCal rule

**Hub-scoped events sync to Google Calendar only when `temporalKind === TIMED`.**

- Enforced in `isHubGcalSyncableEvent` / `isItineraryGcalSyncableEvent` (`src/lib/itinerary.ts`)
- Applied in `computeHubEventsToSync`, `syncHubEventIfConnected`, itinerary resolver with `syncableOnly: true`
- All-day events remain visible in hub UI and itinerary timeline (banner row); not pushed to GCal

## Data model

```
Itinerary
  userId, name, slug (unique per user)
  optionalHubId → EventHub (timezone defaults)
  gcalCalendarId, gcalSyncEnabled, gcalSyncPending, gcalLastSyncedAt, ...

ItineraryItem
  kind: EVENT | HOST | HUB
  eventId | hubHostId | hubId (one set per kind)

ItineraryExclusion
  itineraryId + eventId — opt out one event from a host/hub bundle
```

## API routes

### `GET /api/itineraries`

**Response:**
```json
{
  "itineraries": [
    {
      "id": "cuid",
      "name": "My Cannes 2026 Itinerary",
      "slug": "my-cannes-2026-itinerary",
      "optionalHubId": "cuid|null",
      "hubSlug": "cannes-2026|null",
      "hubName": "Cannes Lions 2026|null",
      "hubTimezone": "Europe/Paris|null",
      "eventCount": 47,
      "timedEventCount": 42,
      "gcalSyncEnabled": true,
      "gcalSyncPending": false,
      "gcalLastSyncError": null,
      "createdAt": "ISO",
      "updatedAt": "ISO"
    }
  ]
}
```

### `POST /api/itineraries`

**Body:** `{ "name": string, "hubSlug"?: string }`

**Errors:**
- `400 ITINERARY_LIMIT` — at `MAX_PER_USER`

### `GET /api/itineraries/[id]` (id or slug)

**Response:**
```json
{
  "itinerary": { /* summary fields + gcalCalendarId */ },
  "items": [
    {
      "id": "cuid",
      "kind": "HOST",
      "eventId": null,
      "hubHostId": "cuid",
      "hubId": null,
      "label": "IAB",
      "createdAt": "ISO"
    }
  ],
  "exclusionCount": 2
}
```

### `GET /api/itineraries/[id]/preview-add`

**Query:** `kind=EVENT&eventId=` | `kind=HOST&hubHostId=` | `kind=HUB&hubId=`

**Response (`ItineraryPreviewAddResponse`):**
```json
{
  "kind": "HOST",
  "newEventCount": 47,
  "newTimedEventCount": 42,
  "allDayExcludedCount": 5,
  "totalAfter": 89,
  "exceedsCap": false,
  "requiresConfirm": true,
  "maxEvents": 500
}
```

### `POST /api/itineraries/[id]/items`

**Body:**
```json
{
  "kind": "EVENT|HOST|HUB",
  "eventId"?: "cuid",
  "hubHostId"?: "cuid",
  "hubId"?: "cuid",
  "confirmLargeAdd"?: true
}
```

**Errors:**
- `400 ITINERARY_CAP` — would exceed `MAX_EVENTS`
- `400 CONFIRM_REQUIRED` — `newEventCount >= PREVIEW_CONFIRM_THRESHOLD` without confirm

**Success:**
```json
{
  "item": { /* ItineraryItem */ },
  "preview": { /* preview object */ },
  "eventCount": 89,
  "gcalSynced": false,
  "syncing": true
}
```

### `GET /api/itineraries/[id]/events?day=YYYY-MM-DD`

**Response (`ItineraryEventsResponse`):**
```json
{
  "itineraryId": "cuid",
  "displayTimezone": "Europe/Paris",
  "day": "2026-06-18|null",
  "events": [ /* ItineraryEventRow */ ],
  "stats": { "total": 47, "timed": 42, "allDay": 5 }
}
```

`ItineraryEventRow` includes `gcalSyncable: boolean`.

### `POST /api/itineraries/[id]/exclude`

**Body:** `{ "eventId": "cuid" }`

### `POST /api/itineraries/[id]/subscribe`

Provisions GCal (`TMC: {name}`), full sync. Requires terms if not accepted.

**Response:**
```json
{
  "success": true,
  "gcalConnected": true,
  "gcalSynced": true,
  "syncing": false,
  "stats": { "synced": 42, "removed": 0, "errors": [] },
  "message": "Synced 42 timed event(s) to Google Calendar."
}
```

### GCal maintenance

| Route | Body / query |
|-------|----------------|
| `POST /api/mine/gcal/itinerary/ensure` | `{ itineraryId }` |
| `POST /api/mine/gcal/itinerary/sync` | `{ itineraryId }` |
| `GET /api/mine/gcal/itinerary/status?itineraryId=` | — |

**Status response (`ItineraryGcalStatusResponse`):**
```json
{
  "itineraryId": "cuid",
  "itinerarySlug": "my-cannes-2026-itinerary",
  "itineraryName": "My Cannes 2026 Itinerary",
  "gcalConnected": true,
  "gcalProvisioned": true,
  "sync": {
    "enabled": true,
    "pending": false,
    "calendarId": "google-id",
    "lastSyncedAt": "ISO|null",
    "lastSyncError": null
  },
  "eventCount": 42,
  "timedEventCount": 42,
  "syncedEventIds": ["cuid", "..."]
}
```

## Sync behavior

1. **Subscribe** — provision calendar, set `gcalSyncPending`, full reconcile
2. **Add item** — if `newEventCount > MAX_GCAL_UPSERTS_PER_REQUEST`, queue; else incremental upsert
3. **Remove item / exclude** — full reconcile on that itinerary calendar
4. **Cron** — `gcalSyncPending` itineraries, `take: CRON_TAKE`
5. **Orphan cleanup** — `UserEventSync` rows not in resolved set are deleted from GCal

## UI surfaces

| Route | Description |
|-------|-------------|
| `/itinerary` | List + create |
| `/itinerary/[slug]` | Sources, subscribe, agenda/timeline |

**Add to itinerary** on hub home (hub), host page (host), host timeline + event card (event).

## Decision matrix

| Scenario | Block | Warn + confirm | Silent OK |
|----------|-------|----------------|-----------|
| Add 1 event | | | ✓ |
| Add host (+47) | | ✓ if ≥20 | |
| Add hub over cap | ✓ | | |
| 6th GCal itinerary | ✓ | | |
| 4 overlapping events | | | ✓ (collapse +N) |
| All-day hub event → GCal | ✓ (excluded) | | |

## Related docs

- [EVENT_HUBS.md](./EVENT_HUBS.md) — festival hub subscriptions (separate from itineraries)
