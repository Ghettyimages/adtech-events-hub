# AdTech Events Hub 🎯

The one-stop-shop for all AdTech and media events. A production-ready MVP for discovering, submitting, and subscribing to industry events.

## ✨ Features

- **📅 Interactive Calendar**: Browse and filter events with FullCalendar integration
- **🔗 iCal Feed**: Public feed that users can subscribe to in any calendar app
- **📆 Add to Google Calendar**: One-click button per event to add to Google Calendar
- **📝 Event Submission**: Community-driven form for submitting events (pending approval)
- **👨‍💼 Simple Admin**: Review and approve pending submissions
- **🔄 Auto-refresh**: Scheduled job to refresh feed/site weekly

## 🛠️ Tech Stack

- **Framework**: Next.js 15 (App Router) + TypeScript
- **UI**: FullCalendar + Tailwind CSS
- **Database**: SQLite via Prisma
- **Feed Generation**: ical-generator
- **Validation**: Zod
- **Lint/Format**: ESLint + Prettier
- **Deployment**: Vercel, Render, Fly.io, or any Node.js 18+ platform

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

1. **Clone and install dependencies**

```bash
npm install
```

2. **Set up environment variables**

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL="file:./dev.db"
SITE_URL="http://localhost:3000"
DEFAULT_TIMEZONE="America/New_York"
```

3. **Initialize the database**

```bash
npm run prisma:generate
npm run prisma:migrate
```

4. **Seed sample data (optional)**

```bash
npm run seed data/sample-events.csv
```

5. **Start the development server**

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) 🎉

## 📁 Project Structure

```
.
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with header/footer
│   │   ├── page.tsx                # Home: Calendar view
│   │   ├── submit/page.tsx         # Submit event form
│   │   ├── admin/page.tsx          # Admin approval page (no auth yet)
│   │   └── api/
│   │       ├── events/route.ts     # GET (list), POST (create)
│   │       ├── events/[id]/route.ts # GET, PATCH, DELETE
│   │       ├── feed/route.ts       # iCal feed generation
│   │       └── revalidate/route.ts # POST to trigger revalidation
│   ├── components/
│   │   ├── Calendar.tsx            # FullCalendar wrapper
│   │   ├── EventCard.tsx           # Event detail modal
│   │   ├── AddToCalendarLink.tsx   # Google Calendar + .ics download
│   │   └── SubmitEventForm.tsx     # Event submission form
│   └── lib/
│       ├── db.ts                   # Prisma client
│       ├── events.ts               # Event helpers
│       └── validation.ts           # Zod schemas
├── prisma/
│   └── schema.prisma               # Database schema
├── scripts/
│   ├── seed-from-csv.ts            # Import events from CSV
│   └── cron-refresh.ts             # Scheduled refresh hook
└── .github/workflows/
    └── weekly-refresh.yml          # GitHub Actions workflow
```

## 📡 API Endpoints

### GET `/api/events`
Fetch all published events (default) or pending events.

**Query Parameters:**
- `status` (optional): `PUBLISHED` or `PENDING`

**Response:**
```json
{
  "events": [
    {
      "id": "clx...",
      "title": "AdTech Summit 2025",
      "start": "2025-11-15T09:00:00Z",
      "end": "2025-11-15T17:00:00Z",
      "location": "New York, NY",
      "url": "https://example.com",
      "description": "...",
      "timezone": "America/New_York",
      "source": "AdTech Summit",
      "status": "PUBLISHED",
      "createdAt": "2025-10-30T...",
      "updatedAt": "2025-10-30T..."
    }
  ]
}
```

### POST `/api/events`
Create a new event (pending approval).

**Request Body:**
```json
{
  "title": "My Event",
  "start": "2025-12-01T10:00:00Z",
  "end": "2025-12-01T12:00:00Z",
  "location": "Virtual",
  "url": "https://example.com",
  "description": "Event description",
  "timezone": "America/New_York",
  "source": "Company Name"
}
```

### GET `/api/events/[id]`
Fetch a single event by ID.

### PATCH `/api/events/[id]`
Update event status (PUBLISHED or PENDING).

**Request Body:**
```json
{
  "status": "PUBLISHED"
}
```

### DELETE `/api/events/[id]`
Delete an event (reject submission).

### GET `/api/feed`
Download iCal feed of all published events.

**Response Headers:**
- `Content-Type: text/calendar; charset=utf-8`
- `Content-Disposition: attachment; filename="adtech-events.ics"`

### POST `/api/revalidate`
Trigger Next.js revalidation to refresh the calendar.

## 📆 Subscribe to Calendar

### Google Calendar

1. Click the "Subscribe in Google Calendar" button on the home page, or
2. Manually add the feed URL:
   - Go to Google Calendar → Settings → Add calendar → From URL
   - Enter: `webcal://your-domain.com/api/feed`

### Apple Calendar / Outlook

1. Download the `.ics` file from `/api/feed`
2. Import into your calendar app

## 🌱 Seeding Events

### From CSV

Create a CSV file with the following columns:

```csv
title,start,end,location,url,description,timezone,source,status
```

**Example:**

```csv
AdTech Summit 2025,2025-11-15T09:00:00Z,2025-11-15T17:00:00Z,New York NY,https://example.com,Description here,America/New_York,IAB,PUBLISHED
```

**Run the seed script:**

```bash
npm run seed data/your-events.csv
```

## 🔐 Admin Access

⚠️ **Note**: The `/admin` page currently has **no authentication**. Implement auth (e.g., NextAuth.js, Clerk) before deploying to production.

**Admin workflow:**
1. Visit `/admin`
2. Review pending events
3. Click "Approve" to publish or "Reject" to delete
4. Calendar auto-revalidates after approval

## 🚢 Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Import project in Vercel
3. Set environment variables:
   - `DATABASE_URL` → Use Vercel Postgres or Turso for production
   - `SITE_URL` → Your production URL
   - `DEFAULT_TIMEZONE` → Your default timezone
4. Deploy!

**GitHub Actions:**
- Set `SITE_URL` as a repository secret
- The weekly refresh workflow will trigger revalidation every Monday at 7am UTC

### Render / Fly.io

1. Set up your platform account
2. Configure build command: `npm run build`
3. Configure start command: `npm start`
4. Set environment variables
5. For SQLite in production, ensure persistent storage is configured

## 🧪 Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run lint` - Run ESLint
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Run database migrations
- `npm run seed` - Seed events from CSV

### Database Management

**Create a migration:**
```bash
npx prisma migrate dev --name your_migration_name
```

**Reset database:**
```bash
npx prisma migrate reset
```

**Open Prisma Studio:**
```bash
npx prisma studio
```

## 🗺️ Roadmap

### Phase 2 (Not Yet Implemented)

- [ ] **Authentication**: Add NextAuth.js or Clerk for admin panel
- [ ] **Event Categories**: Filter by conference, webinar, networking, etc.
- [ ] **Regional Filters**: Filter events by region/country
- [ ] **File Uploads**: Allow event logos/images
- [ ] **Email Notifications**: Alert admins of new submissions
- [ ] **Webhook Integration**: Send notifications to Slack/Discord
- [ ] **AI Assistant**: Use AI to suggest canonical titles/descriptions
- [ ] **Event Scraping**: Automated ingestion from external sources
- [ ] **User Accounts**: Let users save favorite events
- [ ] **Advanced Search**: Full-text search with filters
- [ ] **Analytics**: Track event views and subscriptions
- [ ] **API Rate Limiting**: Protect public endpoints

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - feel free to use this project for your own events hub!

## 🐛 Known Issues / TODOs

- [ ] Admin panel needs authentication
- [ ] CSV parser is basic (doesn't handle commas in quoted fields)
- [ ] No email notifications yet
- [ ] No event moderation workflow beyond approve/reject
- [ ] Revalidate endpoint has no auth token check
- [ ] Mobile calendar view could be improved

## 💬 Support

For questions or issues, please open a GitHub issue or reach out to the maintainers.

---

Built with ❤️ for the AdTech community
