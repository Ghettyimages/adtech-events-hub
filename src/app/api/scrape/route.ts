/**
 * API endpoint for scraping URLs and managing monitored URLs
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { scrapeUrlGeneric } from '@/lib/scraper';
import { extractEventsFromUrl } from '@/lib/extractor/agent';
import { normalize_events, upsert_events } from '@/lib/tools';

// GET: List all monitored URLs
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    if (action === 'monitored') {
      const urls = await prisma.monitoredUrl.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return NextResponse.json({ urls });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('Error fetching monitored URLs:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, { status: 500 });
  }
}

// POST: Scrape a URL or add to monitored URLs
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      url,
      name,
      action,
      enableMonitoring,
      skipPastEvents = true,
    } = body;

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }
    const domain = new URL(url).hostname.replace('www.', '');
    const sourceName = name || domain;
    const defaultTimezone = process.env.DEFAULT_TIMEZONE || 'America/New_York';
    const forceGeneric = action === 'generic';

    let extractionMethod: 'agent' | 'generic' = forceGeneric ? 'generic' : 'agent';
    let agentError: string | null = null;
    let extractedEvents: any[] = [];

    if (!forceGeneric) {
      try {
        const agentResult = await extractEventsFromUrl(url, sourceName);
        extractedEvents = agentResult.events || [];
      } catch (error: any) {
        agentError = error?.message || 'Unknown agent error';
        extractionMethod = 'generic';
        console.warn('AI agent extraction failed, falling back to generic scraper:', error);
      }
    }

    if (extractionMethod === 'generic') {
      const fallbackEvents = await scrapeUrlGeneric(url, sourceName);
      extractedEvents = fallbackEvents;
    } else if (!extractedEvents || extractedEvents.length === 0) {
      const fallbackEvents = await scrapeUrlGeneric(url, sourceName);
      if (fallbackEvents.length > 0) {
        extractionMethod = 'generic';
        extractedEvents = fallbackEvents;
      }
    }

    if (!extractedEvents || extractedEvents.length === 0) {
      const message = 'No events found on this page';

      if (enableMonitoring) {
        await prisma.monitoredUrl.upsert({
          where: { url },
          create: {
            url,
            name: name || sourceName,
            enabled: true,
            lastChecked: new Date(),
            lastSuccess: null,
            lastError: message,
          },
          update: {
            name: name || sourceName,
            lastChecked: new Date(),
            lastSuccess: null,
            lastError: message,
          },
        });
      }

      return NextResponse.json({
        success: true,
        extractionMethod,
        eventsFound: 0,
        message,
        agentError,
      });
    }

    const normalizationResult = await normalize_events({
      events: extractedEvents,
      defaultTimezone,
    });

    if (!normalizationResult.ok || normalizationResult.count === 0) {
      return NextResponse.json({
        success: true,
        extractionMethod,
        eventsFound: 0,
        message: 'No events could be normalized from this page',
        agentError,
        extractedEvents: [], // Empty array for consistency
      });
    }

    const now = new Date();
    const filteredEvents = skipPastEvents
      ? normalizationResult.events.filter((event) => {
          const endDate = new Date(event.end || event.start || "");
          return !isNaN(endDate.getTime()) && endDate >= now;
        })
      : normalizationResult.events;

    const pastEventsSkipped = normalizationResult.events.length - filteredEvents.length;

    if (filteredEvents.length === 0) {
      const message = skipPastEvents
        ? 'Only past events were found on this page'
        : 'No events available after filtering';

      if (enableMonitoring) {
        await prisma.monitoredUrl.upsert({
          where: { url },
          create: {
            url,
            name: name || sourceName,
            enabled: true,
            lastChecked: new Date(),
            lastSuccess: null,
            lastError: message,
          },
          update: {
            name: name || sourceName,
            lastChecked: new Date(),
            lastSuccess: null,
            lastError: message,
          },
        });
      }

      return NextResponse.json({
        success: true,
        extractionMethod,
        eventsFound: 0,
        rawEventsFound: normalizationResult.count,
        message,
        skippedPastEvents: pastEventsSkipped,
        agentError,
      });
    }

    // Return extracted events for preview before saving
    const eventsForPreview = filteredEvents.map((event) => ({
      title: event.title,
      start: event.start,
      end: event.end,
      location: event.location,
      url: event.url,
      description: event.description,
      source: event.source,
      date_status: event.date_status,
      location_status: event.location_status,
      evidence: event.evidence,
      location_evidence: event.location_evidence,
    }));

    const upsertResult = await upsert_events({
      events: filteredEvents,
      publish: false,
    });

    const successCount = upsertResult.created || 0;
    const skipCount = upsertResult.skipped || 0;
    const errorCount = upsertResult.errors || 0;

    let monitoredUrl = null;
    if (enableMonitoring) {
      monitoredUrl = await prisma.monitoredUrl.upsert({
        where: { url },
        create: {
          url,
          name: name || sourceName,
          enabled: true,
          lastChecked: new Date(),
          lastSuccess: successCount > 0 ? new Date() : null,
          lastError: successCount === 0 ? 'No new events added' : null,
        },
        update: {
          name: name || sourceName,
          lastChecked: new Date(),
          lastSuccess: successCount > 0 ? new Date() : null,
          lastError: successCount === 0 ? 'No new events added' : null,
        },
      });
    }

    return NextResponse.json({
      success: true,
      extractionMethod,
      eventsFound: normalizationResult.count,
      rawEventsFound: extractedEvents.length,
      eventsAdded: successCount,
      eventsSkipped: skipCount,
      eventsErrored: errorCount,
      skippedPastEvents: pastEventsSkipped,
      monitoredUrl,
      agentError,
      appliedFilters: {
        skipPastEvents,
      },
      extractedEvents: eventsForPreview, // Include events for preview
    });
  } catch (error: any) {
    console.error('Error scraping URL:', error);
    return NextResponse.json(
      { 
        error: error.message || 'Failed to scrape URL',
        details: error.stack || error.toString()
      },
      { status: 500 }
    );
  }
}

// DELETE: Remove monitored URL
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    await prisma.monitoredUrl.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting monitored URL:', error);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}

// PATCH: Update monitored URL (enable/disable)
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, enabled } = body;

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    const updated = await prisma.monitoredUrl.update({
      where: { id },
      data: { enabled: enabled !== undefined ? enabled : undefined },
    });

    return NextResponse.json({ success: true, url: updated });
  } catch (error: any) {
    console.error('Error updating monitored URL:', error);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

