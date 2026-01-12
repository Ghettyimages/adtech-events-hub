'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Event, Tag } from '@prisma/client';
import { format } from 'date-fns';
import TagSelector from '@/components/TagSelector';
import { getDisplayName } from '@/lib/tags';
import { formatEventDateForDisplay } from '@/lib/events';

/**
 * Formats a date for display, handling all-day events correctly
 * Uses the shared formatEventDateForDisplay function for consistency
 */
function formatEventDate(date: Date | string, isAllDay: boolean, isEndDate: boolean = false): string {
  return formatEventDateForDisplay(date, isAllDay, isEndDate);
}

interface MonitoredUrl {
  id: string;
  url: string;
  name: string | null;
  enabled: boolean;
  lastChecked: Date | null;
  lastSuccess: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface EventFormData {
  title?: string;
  description?: string;
  url?: string;
  location?: string;
  start?: string;    // datetime-local formatted string
  end?: string;      // datetime-local formatted string
  timezone?: string;
  source?: string;
  country?: string;
  region?: string;
  city?: string;
}

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [pendingEvents, setPendingEvents] = useState<Event[]>([]);
  const [publishedEvents, setPublishedEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [eventViewMode, setEventViewMode] = useState<'pending' | 'published'>('pending');
  const [adminTab, setAdminTab] = useState<'events' | 'tags'>('events');
  
  // URL scraping state
  const [scrapeUrl, setScrapeUrl] = useState('');
  const [scrapeName, setScrapeName] = useState('');
  const [scraping, setScraping] = useState(false);
  const [scrapeResult, setScrapeResult] = useState<string | null>(null);
  const [enableMonitoring, setEnableMonitoring] = useState(false);
  const [monitoredUrls, setMonitoredUrls] = useState<MonitoredUrl[]>([]);
  const [extractedEvents, setExtractedEvents] = useState<any[]>([]);
  const [extractionMethod, setExtractionMethod] = useState<string | null>(null);

  // CSV upload state
  const [csvUploading, setCsvUploading] = useState(false);
  const [csvUploadResult, setCsvUploadResult] = useState<any>(null);
  const [publishImmediately, setPublishImmediately] = useState(false);

  // Edit event state
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [editFormData, setEditFormData] = useState<EventFormData>({});
  const [editSelectedTags, setEditSelectedTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [isAllDay, setIsAllDay] = useState(true); // Default to all-day events

  // Tags management state
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | null>(null);
  const [showTagModal, setShowTagModal] = useState(false);
  const [tagFormData, setTagFormData] = useState({
    name: '',
    displayName: '',
    description: '',
    color: '',
    keywords: '',
  });
  const [sortBy, setSortBy] = useState<'name' | 'usage' | 'created'>('name');

  // Check authentication and admin status
  useEffect(() => {
    if (status === 'loading') {
      return;
    }

    if (status === 'unauthenticated') {
      setLoading(false);
      router.push('/login?callbackUrl=/admin');
      return;
    }

    if (status === 'authenticated' && session) {
      // Check if user is admin
      const isAdmin = (session.user as any)?.isAdmin || false;
      if (!isAdmin) {
        setLoading(false);
        router.push('/');
        return;
      }
      // User is authenticated and is admin, load data
      fetchPendingEvents();
      fetchPublishedEvents();
      fetchMonitoredUrls();
    }
  }, [status, session, router]);

  // Fetch tags when Tags tab is active
  useEffect(() => {
    if (adminTab === 'tags') {
      fetchTags();
    }
  }, [adminTab, sortBy]);

  const fetchTags = async () => {
    setTagsLoading(true);
    try {
      const res = await fetch(`/api/tags?sort=${sortBy}`);
      if (!res.ok) throw new Error('Failed to fetch tags');
      const data = await res.json();
      setTags(data.tags || []);
    } catch (err: any) {
      setFeedback('error', err.message || 'Failed to fetch tags');
    } finally {
      setTagsLoading(false);
    }
  };

  const handleCreateTag = () => {
    setEditingTag(null);
    setTagFormData({
      name: '',
      displayName: '',
      description: '',
      color: '',
      keywords: '',
    });
    setShowTagModal(true);
  };

  const handleEditTag = (tag: Tag) => {
    setEditingTag(tag);
    // Parse keywords from JSON string to comma-separated string for input
    let keywordsStr = '';
    if (tag.keywords) {
      try {
        const keywords = JSON.parse(tag.keywords);
        keywordsStr = Array.isArray(keywords) ? keywords.join(', ') : '';
      } catch (e) {
        keywordsStr = '';
      }
    }
    setTagFormData({
      name: tag.name,
      displayName: tag.displayName || '',
      description: tag.description || '',
      color: tag.color || '',
      keywords: keywordsStr,
    });
    setShowTagModal(true);
  };

  const handleSaveTag = async () => {
    if (!tagFormData.name.trim()) {
      setFeedback('error', 'Tag name is required');
      return;
    }

    try {
      // Parse keywords from comma-separated string to array, then to JSON string
      let keywordsJson: string | null = null;
      if (tagFormData.keywords?.trim()) {
        const keywordsArray = tagFormData.keywords
          .split(',')
          .map((k) => k.trim())
          .filter((k) => k.length > 0);
        if (keywordsArray.length > 0) {
          keywordsJson = JSON.stringify(keywordsArray);
        }
      }

      const url = editingTag ? `/api/tags/${editingTag.id}` : '/api/tags';
      const method = editingTag ? 'PATCH' : 'POST';
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: tagFormData.name.trim(),
          displayName: tagFormData.displayName?.trim() || null,
          description: tagFormData.description?.trim() || null,
          color: tagFormData.color?.trim() || null,
          keywords: keywordsJson,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save tag');
      }

      await fetchTags();
      setEditingTag(null);
      setShowTagModal(false);
      setTagFormData({ name: '', displayName: '', description: '', color: '', keywords: '' });
      setFeedback('success', editingTag ? 'Tag updated successfully!' : 'Tag created successfully!');
    } catch (err: any) {
      setFeedback('error', err.message || 'Failed to save tag');
    }
  };

  const handleDeleteTag = async (tag: Tag) => {
    if (tag.usageCount > 0) {
      if (!confirm(`This tag is used by ${tag.usageCount} event(s). Are you sure you want to delete it? This will remove the tag from all events.`)) {
        return;
      }
    } else {
      if (!confirm(`Are you sure you want to delete the tag "${getDisplayName(tag)}"?`)) {
        return;
      }
    }

    try {
      const res = await fetch(`/api/tags/${tag.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to delete tag');
      }

      await fetchTags();
      setFeedback('success', 'Tag deleted successfully!');
    } catch (err: any) {
      setFeedback('error', err.message || 'Failed to delete tag');
    }
  };

  const setFeedback = (type: 'success' | 'error', message: string) => {
    if (type === 'success') {
      setSuccessMessage(message);
      setError(null);
    } else {
      setError(message);
      setSuccessMessage(null);
    }
    setTimeout(() => {
      setSuccessMessage(null);
      setError(null);
    }, 5000);
  };

  const fetchPendingEvents = async () => {
    try {
      const res = await fetch('/api/events?status=PENDING');
      if (!res.ok) throw new Error('Failed to fetch pending events');
      const data = await res.json();
      setPendingEvents(data.events);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchPublishedEvents = async () => {
    try {
      const res = await fetch('/api/events?status=PUBLISHED');
      if (!res.ok) throw new Error('Failed to fetch published events');
      const data = await res.json();
      setPublishedEvents(data.events);
    } catch (err: any) {
      console.error('Failed to fetch published events:', err);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const res = await fetch(`/api/events/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PUBLISHED' }),
      });

      if (!res.ok) throw new Error('Failed to approve event');

      // Remove from pending list
      setPendingEvents((prev) => prev.filter((e) => e.id !== id));

      // Trigger revalidation
      await fetch('/api/revalidate', { method: 'POST' });
      await fetchPublishedEvents(); // Refresh published events list
      setFeedback('success', 'Event approved and published!');
    } catch (err: any) {
      setFeedback('error', err.message);
    }
  };

  const handleReject = async (id: string) => {
    if (!confirm('Are you sure you want to reject this event?')) return;

    try {
      const res = await fetch(`/api/events/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to reject event');

      setPendingEvents((prev) => prev.filter((e) => e.id !== id));
      setFeedback('success', 'Event rejected and deleted.');
    } catch (err: any) {
      setFeedback('error', err.message);
    }
  };

  const fetchMonitoredUrls = async () => {
    try {
      const res = await fetch('/api/scrape?action=monitored');
      if (!res.ok) throw new Error('Failed to fetch monitored URLs');
      const data = await res.json();
      setMonitoredUrls(data.urls || []);
    } catch (err: any) {
      console.error('Failed to fetch monitored URLs:', err);
    }
  };

  const handleCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setCsvUploading(true);
    setCsvUploadResult(null);
    setError(null);
    setSuccessMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('publish', publishImmediately.toString());

      const response = await fetch('/api/events/upload-csv', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed');
      }

      setCsvUploadResult(result);
      setSuccessMessage(
        `✅ CSV uploaded successfully! ${result.stats.success} events processed, ${result.stats.errors} errors.`
      );

      // Refresh events list
      fetchPendingEvents();
      fetchPublishedEvents();

      // Clear file input
      event.target.value = '';
    } catch (err: any) {
      setError(err.message || 'Failed to upload CSV');
    } finally {
      setCsvUploading(false);
    }
  };

  const handleScrapeUrl = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!scrapeUrl.trim()) return;

    setScraping(true);
    setScrapeResult(null);
    setError(null);
    setSuccessMessage(null);
    setExtractedEvents([]);
    setExtractionMethod(null);

    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: scrapeUrl,
          name: scrapeName || undefined,
          enableMonitoring,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to scrape URL');

      const resultParts = [
        `✅ Scraped successfully using ${data.extractionMethod || 'agent'} method`,
        `Found ${data.eventsFound || 0} events`,
        data.eventsAdded ? `Added ${data.eventsAdded} new events (pending approval)` : '',
        data.eventsSkipped ? `${data.eventsSkipped} duplicates skipped` : '',
        data.skippedPastEvents ? `${data.skippedPastEvents} past events skipped` : '',
        enableMonitoring && data.monitoredUrl ? '✅ URL added to monitoring' : '',
      ].filter(Boolean);

      setScrapeResult(resultParts.join('\n'));
      setExtractedEvents(data.extractedEvents || []);
      setExtractionMethod(data.extractionMethod || null);
      if (enableMonitoring) await fetchMonitoredUrls();
      setScrapeUrl('');
      setScrapeName('');
      setEnableMonitoring(false);
      setFeedback('success', 'URL scraped successfully!');
      await fetchPendingEvents(); // Refresh pending events list
    } catch (err: any) {
      setFeedback('error', err.message || 'Failed to scrape URL');
      setExtractedEvents([]);
      setExtractionMethod(null);
    } finally {
      setScraping(false);
    }
  };

  const handleToggleMonitoring = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch('/api/scrape', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enabled: !enabled }),
      });

      if (!res.ok) throw new Error('Failed to update monitored URL');
      await fetchMonitoredUrls();
      setFeedback('success', 'Monitoring preference updated.');
    } catch (err: any) {
      setFeedback('error', err.message || 'Failed to update monitored URL');
    }
  };

  const handleDeleteMonitoredUrl = async (id: string) => {
    if (!confirm('Remove this monitored URL?')) return;

    try {
      const res = await fetch(`/api/scrape?id=${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete monitored URL');
      await fetchMonitoredUrls();
      setFeedback('success', 'Monitored URL removed.');
    } catch (err: any) {
      setFeedback('error', err.message || 'Failed to delete monitored URL');
    }
  };

  const handleEditEvent = (event: Event) => {
    setEditingEvent(event);
    
    // Parse tags from JSON string if present
    let tagsArray: string[] = [];
    if (event.tags) {
      try {
        const parsed = typeof event.tags === 'string' ? JSON.parse(event.tags) : event.tags;
        tagsArray = Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        console.error('Failed to parse tags:', e);
        tagsArray = [];
      }
    }
    setEditSelectedTags(tagsArray);
    
    // Determine if event is all-day: no timezone means all-day, or default to true for pending events
    const eventIsAllDay = event.timezone === null || event.timezone === '' || event.status === 'PENDING';
    setIsAllDay(eventIsAllDay);
    
    // Format dates based on all-day status
    const startDate = new Date(event.start);
    const endDate = new Date(event.end);
    
    let startFormatted: string;
    let endFormatted: string;
    
    if (eventIsAllDay) {
      // For all-day events, extract UTC date components to avoid timezone shifts
      // All-day events are stored with fixed UTC times (start: 12:00 UTC, end: 22:00 UTC) on inclusive calendar days
      const startYear = startDate.getUTCFullYear();
      const startMonth = startDate.getUTCMonth();
      const startDay = startDate.getUTCDate();
      
      const endYear = endDate.getUTCFullYear();
      const endMonth = endDate.getUTCMonth();
      const endDay = endDate.getUTCDate();
      
      // Format as YYYY-MM-DD using UTC components (inclusive end date, no adjustment needed)
      const startUTC = new Date(Date.UTC(startYear, startMonth, startDay));
      const endUTC = new Date(Date.UTC(endYear, endMonth, endDay));
      startFormatted = startUTC.toISOString().slice(0, 10);
      endFormatted = endUTC.toISOString().slice(0, 10);
    } else {
      // For timed events, use datetime-local format (YYYY-MM-DDTHH:mm)
      // Convert UTC to local time for the input
      // datetime-local inputs expect local time, so we format using local time methods
      const formatLocalDateTime = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
      };
      
      startFormatted = formatLocalDateTime(startDate);
      endFormatted = formatLocalDateTime(endDate);
    }
    
    setEditFormData({
      title: event.title,
      description: event.description || '',
      url: event.url || '',
      location: event.location || '',
      start: startFormatted,
      end: endFormatted,
      timezone: event.timezone || '',
      source: event.source || '',
      country: event.country || '',
      region: event.region || '',
      city: event.city || '',
    });
  };

  const handleSaveEdit = async (andApprove: boolean = false) => {
    if (!editingEvent) return;

    setSaving(true);
    try {
      // Convert datetime-local to ISO string
      const updateData: any = {};

      // Build update data object - only include fields that are defined
      // Title is required
      if (editFormData.title !== undefined) {
        if (!editFormData.title || editFormData.title.trim() === '') {
          throw new Error('Title is required');
        }
        updateData.title = editFormData.title.trim();
      }
      
      // Description is optional - send null if empty, undefined if not provided
      if (editFormData.description !== undefined) {
        const trimmed = editFormData.description?.trim();
        updateData.description = trimmed && trimmed.length > 0 ? trimmed : null;
      }
      
      // URL - validation schema expects empty string, valid URL, or null
      if (editFormData.url !== undefined) {
        const urlValue = editFormData.url?.trim() || '';
        updateData.url = urlValue.length > 0 ? urlValue : null;
      }
      
      // Location is optional - send null if empty
      if (editFormData.location !== undefined) {
        const trimmed = editFormData.location?.trim();
        updateData.location = trimmed && trimmed.length > 0 ? trimmed : null;
      }
      
      // Source is optional - send null if empty
      if (editFormData.source !== undefined) {
        const trimmed = editFormData.source?.trim();
        updateData.source = trimmed && trimmed.length > 0 ? trimmed : null;
      }
      
      // Handle location fields
      if (editFormData.country !== undefined) {
        const trimmed = editFormData.country?.trim();
        updateData.country = trimmed && trimmed.length > 0 ? trimmed : null;
      }
      if (editFormData.region !== undefined) {
        const trimmed = editFormData.region?.trim();
        updateData.region = trimmed && trimmed.length > 0 ? trimmed : null;
      }
      if (editFormData.city !== undefined) {
        const trimmed = editFormData.city?.trim();
        updateData.city = trimmed && trimmed.length > 0 ? trimmed : null;
      }
      
      // Handle tags - send as array, API will convert to JSON string
      if (editSelectedTags.length > 0) {
        updateData.tags = editSelectedTags;
      } else {
        updateData.tags = null;
      }

      // Handle dates - convert based on all-day status
      // For all-day events: date-only format "YYYY-MM-DD" -> start of day / end of day
      // For timed events: datetime-local format "YYYY-MM-DDTHH:mm" -> ISO with time
      const convertToISO = (dateValue: string, isStart: boolean): string => {
        if (!dateValue || !dateValue.trim()) {
          throw new Error(`${isStart ? 'Start' : 'End'} date is required`);
        }
        
        if (isAllDay) {
          // For all-day events, date-only format: "YYYY-MM-DD"
          // Store with fixed UTC times: start at 12:00 UTC, end at 22:00 UTC on inclusive calendar days
          // This ensures the date displays correctly regardless of user's timezone
          const [year, month, day] = dateValue.split('-').map(Number);
          
          if (isStart) {
            // Start: Store at 12:00 UTC on the selected date
            const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
            return date.toISOString();
          } else {
            // End: Store at 22:00 UTC on the selected date (inclusive end date)
            const date = new Date(Date.UTC(year, month - 1, day, 22, 0, 0, 0));
            return date.toISOString();
          }
        } else {
          // For timed events, datetime-local format: "YYYY-MM-DDTHH:mm"
          // JavaScript Date constructor interprets this as local time
          const date = new Date(dateValue);
          if (isNaN(date.getTime())) {
            throw new Error('Invalid date/time format');
          }
          // Return ISO string (this will include timezone offset)
          return date.toISOString();
        }
      };

      if (editFormData.start !== undefined && editFormData.start !== null && editFormData.start !== '') {
        updateData.start = convertToISO(editFormData.start, true);
      } else {
        throw new Error('Start date is required');
      }
      
      if (editFormData.end !== undefined && editFormData.end !== null && editFormData.end !== '') {
        updateData.end = convertToISO(editFormData.end, false);
      } else {
        throw new Error('End date is required');
      }
      
      // Set timezone to null for all-day events, otherwise use the provided timezone
      if (isAllDay) {
        updateData.timezone = null;
      } else if (editFormData.timezone !== undefined) {
        const trimmed = editFormData.timezone?.trim();
        updateData.timezone = trimmed && trimmed.length > 0 ? trimmed : null;
      }
      
      // Validate that end is after start
      if (updateData.start && updateData.end) {
        const start = new Date(updateData.start);
        const end = new Date(updateData.end);
        if (end <= start) {
          throw new Error('End date must be after start date');
        }
      }

      // If approving, set status to PUBLISHED
      if (andApprove) {
        updateData.status = 'PUBLISHED';
      }

      console.log('=== UPDATE REQUEST ===');
      console.log('Event ID:', editingEvent.id);
      console.log('Update Data:', JSON.stringify(updateData, null, 2));
      console.log('=====================');

      const res = await fetch(`/api/events/${editingEvent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      });

      let responseData: any = {};
      const contentType = res.headers.get('content-type');
      
      if (contentType && contentType.includes('application/json')) {
        try {
          responseData = await res.json();
          console.log('Response data:', JSON.stringify(responseData, null, 2));
        } catch (parseError) {
          console.error('Failed to parse JSON response:', parseError);
          const text = await res.text();
          console.error('Response text:', text);
          throw new Error(`Server error (${res.status}): ${text || res.statusText}`);
        }
      } else {
        const text = await res.text();
        console.error('Non-JSON response:', text);
        throw new Error(`Server error (${res.status}): ${text || res.statusText}`);
      }

      if (!res.ok) {
        console.error('=== UPDATE FAILED ===');
        console.error('Status:', res.status);
        console.error('Full Response Object:', responseData);
        console.error('Response JSON:', JSON.stringify(responseData, null, 2));
        console.error('====================');
        
        let errorMessage = 'Failed to update event';
        
        if (responseData.error) {
          errorMessage = responseData.error;
        }
        
        // Handle Zod validation errors
        if (responseData.details && Array.isArray(responseData.details) && responseData.details.length > 0) {
          console.error('Validation error details:', responseData.details);
          const errors = responseData.details.map((err: any) => {
            const path = err.path?.join('.') || 'unknown field';
            const code = err.code || 'unknown';
            return `${path} (${code}): ${err.message}`;
          }).join('; ');
          errorMessage = `Validation errors: ${errors}`;
        } else if (responseData.message) {
          errorMessage = responseData.message;
        } else if (Object.keys(responseData).length > 0) {
          errorMessage = JSON.stringify(responseData, null, 2);
        }
        
        console.error('Final error message:', errorMessage);
        throw new Error(errorMessage);
      }

      console.log('Update successful:', responseData);

      await fetchPublishedEvents();
      await fetchPendingEvents();
      await fetch('/api/revalidate', { method: 'POST' });
      setEditingEvent(null);
      setEditFormData({});
      setEditSelectedTags([]);
      setIsAllDay(true); // Reset to default
      setFeedback('success', andApprove ? 'Event updated and approved!' : 'Event updated successfully!');
    } catch (err: any) {
      console.error('Error in handleSaveEdit:', err);
      setFeedback('error', err.message || 'Failed to update event');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!confirm('Are you sure you want to delete this event? This action cannot be undone.')) return;

    try {
      const res = await fetch(`/api/events/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) throw new Error('Failed to delete event');

      await fetchPublishedEvents();
      await fetch('/api/revalidate', { method: 'POST' });
      setFeedback('success', 'Event deleted successfully.');
    } catch (err: any) {
      setFeedback('error', err.message || 'Failed to delete event');
    }
  };

  // Show loading while checking authentication or loading data
  if (status === 'loading' || (status === 'authenticated' && loading)) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center text-xl text-gray-600">Loading...</div>
      </div>
    );
  }

  // If not authenticated, redirect is happening (show nothing)
  if (status === 'unauthenticated') {
    return null;
  }

  // If authenticated but not admin, redirect is happening (show nothing)
  if (status === 'authenticated' && session && !((session.user as any)?.isAdmin)) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-4 text-gray-900 dark:text-white">
          Admin Dashboard
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-400">
          Manage events, scrape URLs, and monitor sources
        </p>
      </div>

      {(error || successMessage || scrapeResult) && (
        <div className="mb-6 space-y-2">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
              Error: {error}
            </div>
          )}
          {successMessage && (
            <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
              {successMessage}
            </div>
          )}
          {scrapeResult && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg whitespace-pre-line">
              {scrapeResult}
            </div>
          )}
        </div>
      )}

      {/* URL Scraping Section */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-8 shadow-md">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">
          🔍 Scrape Events from URL
        </h2>
        <form onSubmit={handleScrapeUrl} className="space-y-4">
          <div>
            <label htmlFor="scrape-url" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              URL to Scrape
            </label>
            <input
              type="url"
              id="scrape-url"
              value={scrapeUrl}
              onChange={(e) => setScrapeUrl(e.target.value)}
              placeholder="https://example.com/events"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              required
            />
          </div>
          <div>
            <label htmlFor="scrape-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Source Name (optional)
            </label>
            <input
              type="text"
              id="scrape-name"
              value={scrapeName}
              onChange={(e) => setScrapeName(e.target.value)}
              placeholder="e.g., MediaPost Events"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="enable-monitoring"
              checked={enableMonitoring}
              onChange={(e) => setEnableMonitoring(e.target.checked)}
              className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <label htmlFor="enable-monitoring" className="text-sm text-gray-700 dark:text-gray-300">
              Enable automatic monitoring (checks this URL daily for updates)
            </label>
          </div>
          <button
            type="submit"
            disabled={scraping}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {scraping ? 'Scraping…' : 'Scrape URL'}
          </button>
        </form>
      </div>

      {/* CSV Upload Section */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-8 shadow-md">
        <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">
          📤 Upload Events from CSV
        </h2>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            CSV File Format
          </label>
          <div className="text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-700 p-3 rounded border border-gray-200 dark:border-gray-600">
            <p className="mb-2">
              Required columns: <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">title</code>, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">start</code>
            </p>
            <p className="mb-2">
              Optional columns: <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">end</code>, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">location</code>, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">url</code>, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">description</code>, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">timezone</code>, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">source</code>, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">status</code>, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">tags</code>, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">country</code>, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">region</code>, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">city</code>, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">all_day</code>
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              Date formats: YYYY-MM-DD, MM/DD/YYYY, or ISO format. Tags should be comma-separated.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">all_day</code> column: Use <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">true</code> or <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">false</code> to explicitly control all-day status. If omitted, auto-detects from date format (no time = all-day).
            </p>
          </div>
        </div>

        <div className="mb-4">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={publishImmediately}
              onChange={(e) => setPublishImmediately(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Publish events immediately (otherwise they'll be PENDING)
            </span>
          </label>
        </div>

        <div className="flex items-center space-x-4 mb-4">
          <label className="flex-1">
            <input
              type="file"
              accept=".csv"
              onChange={handleCsvUpload}
              disabled={csvUploading}
              className="block w-full text-sm text-gray-500 dark:text-gray-400
                file:mr-4 file:py-2 file:px-4
                file:rounded-full file:border-0
                file:text-sm file:font-semibold
                file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900 dark:file:text-blue-200
                hover:file:bg-blue-100 dark:hover:file:bg-blue-800
                disabled:opacity-50 disabled:cursor-not-allowed
                cursor-pointer"
            />
          </label>
          <a
            href="/api/events/export-csv"
            download
            className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-600 transition"
          >
            📥 Download CSV Template
          </a>
        </div>

        {csvUploading && (
          <div className="mt-4 text-sm text-blue-600 dark:text-blue-400">
            ⏳ Uploading and processing CSV...
          </div>
        )}

        {csvUploadResult && (
          <div className={`mt-4 p-4 rounded border ${
            csvUploadResult.stats.errors > 0 
              ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' 
              : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
          }`}>
            <div className="text-sm">
              <p className="font-semibold mb-2 text-gray-900 dark:text-white">
                {csvUploadResult.stats.errors === 0 ? '✅' : '⚠️'} Upload Complete
              </p>
              <p className="text-gray-700 dark:text-gray-300">Total rows: {csvUploadResult.stats.total}</p>
              <p className="text-green-700 dark:text-green-400">Success: {csvUploadResult.stats.success}</p>
              {csvUploadResult.stats.errors > 0 && (
                <p className="text-yellow-700 dark:text-yellow-400">Errors: {csvUploadResult.stats.errors}</p>
              )}
            </div>
            
            {csvUploadResult.errors && csvUploadResult.errors.length > 0 && (
              <details className="mt-2">
                <summary className="text-sm font-medium cursor-pointer text-gray-700 dark:text-gray-300">
                  View errors ({csvUploadResult.errors.length})
                </summary>
                <ul className="mt-2 text-xs text-gray-600 dark:text-gray-400 list-disc list-inside space-y-1 max-h-40 overflow-y-auto">
                  {csvUploadResult.errors.map((err: string, idx: number) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
          <p>💡 Tip: Download a sample CSV from your existing events to see the format.</p>
        </div>
      </div>

      {/* Extracted Events Preview Section */}
      {extractedEvents.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-8 shadow-md">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              📋 Extracted Events Preview ({extractedEvents.length})
            </h2>
            {extractionMethod && (
              <span className="text-sm px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full">
                Method: {extractionMethod}
              </span>
            )}
          </div>
          <div className="space-y-4">
            {extractedEvents.map((event, index) => (
              <div
                key={index}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                      {event.title}
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-600 dark:text-gray-400">
                      {event.start && (
                        <div>
                          <strong>Start:</strong>{' '}
                          {formatEventDate(event.start, !event.timezone, false)}
                          {event.date_status && (
                            <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                              event.date_status === 'confirmed'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                            }`}>
                              {event.date_status}
                            </span>
                          )}
                        </div>
                      )}
                      {event.end && (
                        <div>
                          <strong>End:</strong> {formatEventDate(event.end, !event.timezone, true)}
                        </div>
                      )}
                      {event.location && (
                        <div>
                          <strong>Location:</strong> {event.location}
                          {event.location_status && (
                            <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                              event.location_status === 'confirmed'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                            }`}>
                              {event.location_status}
                            </span>
                          )}
                        </div>
                      )}
                      {event.source && (
                        <div>
                          <strong>Source:</strong> {event.source}
                        </div>
                      )}
                      {event.url && (
                        <div className="md:col-span-2">
                          <strong>Link:</strong>{' '}
                          <a
                            href={event.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline break-all"
                          >
                            {event.url}
                          </a>
                        </div>
                      )}
                      {event.evidence && (
                        <div className="md:col-span-2 text-xs text-gray-500 dark:text-gray-500">
                          <strong>Date Evidence:</strong> {event.evidence}
                        </div>
                      )}
                      {event.location_evidence && (
                        <div className="md:col-span-2 text-xs text-gray-500 dark:text-gray-500">
                          <strong>Location Evidence:</strong> {event.location_evidence}
                        </div>
                      )}
                    </div>
                    {event.description && (
                      <div className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                        <strong>Description:</strong>
                        <p className="mt-1 whitespace-pre-wrap">{event.description}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              ℹ️ These events have been automatically saved as pending and are available for approval below.
            </p>
          </div>
        </div>
      )}

      {/* Monitored URLs Section */}
      {monitoredUrls.length > 0 && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 mb-8 shadow-md">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-4">📡 Monitored URLs</h2>
          <div className="space-y-4">
            {monitoredUrls.map((url) => (
              <div
                key={url.id}
                className="border border-gray-200 dark:border-gray-700 rounded-lg p-4"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      {url.name || url.url}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 break-all">{url.url}</p>
                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-500 space-y-1">
                      {url.lastChecked && (
                        <p>Last checked: {format(new Date(url.lastChecked), 'PPpp')}</p>
                      )}
                      {url.lastSuccess && (
                        <p className="text-green-600">Last success: {format(new Date(url.lastSuccess), 'PPpp')}</p>
                      )}
                      {url.lastError && (
                        <p className="text-red-600">Last error: {url.lastError}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleToggleMonitoring(url.id, url.enabled)}
                      className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                        url.enabled
                          ? 'bg-green-600 text-white hover:bg-green-700'
                          : 'bg-gray-300 text-gray-700 hover:bg-gray-400 dark:bg-gray-600 dark:text-white'
                      }`}
                    >
                      {url.enabled ? '✓ Enabled' : 'Disabled'}
                    </button>
                    <button
                      onClick={() => handleDeleteMonitoredUrl(url.id)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-semibold"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Tab Navigation */}
      <div className="mb-6">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 text-sm font-medium shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <button
            onClick={() => setAdminTab('events')}
            className={`rounded-md px-4 py-2 transition ${
              adminTab === 'events'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
          >
            📅 Events
          </button>
          <button
            onClick={() => setAdminTab('tags')}
            className={`rounded-md px-4 py-2 transition ${
              adminTab === 'tags'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}
          >
            🏷️ Tags
          </button>
        </div>
      </div>

      {/* Events Tab Content */}
      {adminTab === 'events' && (
        <>
          {/* Events View Toggle */}
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">
              {eventViewMode === 'pending' ? '⏳ Pending Events' : '✅ Published Events'}
            </h2>
            <div className="flex gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
              <button
                onClick={() => setEventViewMode('pending')}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
                  eventViewMode === 'pending'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Pending ({pendingEvents.length})
              </button>
              <button
                onClick={() => setEventViewMode('published')}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition ${
                  eventViewMode === 'published'
                    ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Published ({publishedEvents.length})
              </button>
            </div>
          </div>

      {/* Published Events Section */}
      {eventViewMode === 'published' && (
        <div className="mb-8">
        {publishedEvents.length === 0 ? (
          <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
            <p className="text-gray-600 dark:text-gray-400 text-lg">
              No published events yet.
            </p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                      Title
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                      Start
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                      End
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                      Location
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                      Source
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {publishedEvents.map((event) => (
                    <tr key={event.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/60">
                      <td className="px-4 py-4 whitespace-normal text-sm font-medium text-gray-900 dark:text-gray-100">
                        <div className="flex items-center gap-2">
                          <span>{event.title}</span>
                          {'subscribers' in event && typeof event.subscribers === 'number' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                              👥 {event.subscribers}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                        {formatEventDate(event.start, !event.timezone, false)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                        {formatEventDate(event.end, !event.timezone, true)}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                        {event.location || '—'}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                        {event.source || '—'}
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap text-sm text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleEditEvent(event)}
                            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-xs font-semibold"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteEvent(event.id)}
                            className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-xs font-semibold"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        </div>
      )}

      {/* Pending Events Section */}
      {eventViewMode === 'pending' && (
        <div className="mb-8">
          {pendingEvents.length === 0 ? (
            <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
              <p className="text-gray-600 dark:text-gray-400 text-lg">
                No pending events to review.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {pendingEvents.map((event) => (
                <div
                  key={event.id}
                  className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 shadow-md"
                >
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                          {event.title}
                        </h2>
                        {'subscribers' in event && typeof event.subscribers === 'number' && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                            👥 {event.subscribers} {event.subscribers === 1 ? 'subscriber' : 'subscribers'}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                        <p>
                          <strong>Start:</strong> {formatEventDate(event.start, !event.timezone, false)}
                        </p>
                        <p>
                          <strong>End:</strong> {formatEventDate(event.end, !event.timezone, true)}
                        </p>
                        {event.location && (
                          <p>
                            <strong>Location:</strong> {event.location}
                          </p>
                        )}
                        {event.timezone && (
                          <p>
                            <strong>Timezone:</strong> {event.timezone}
                          </p>
                        )}
                        {event.source && (
                          <p>
                            <strong>Source:</strong> {event.source}
                          </p>
                        )}
                        {event.tags && (() => {
                          try {
                            const tagsArray = typeof event.tags === 'string' ? JSON.parse(event.tags) : event.tags;
                            return Array.isArray(tagsArray) && tagsArray.length > 0 ? (
                              <p>
                                <strong>Tags:</strong>{' '}
                                <span className="flex flex-wrap gap-1 mt-1">
                                  {tagsArray.map((tag: string) => (
                                    <span
                                      key={tag}
                                      className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                                    >
                                      {tag}
                                    </span>
                                  ))}
                                </span>
                              </p>
                            ) : null;
                          } catch {
                            return null;
                          }
                        })()}
                        {event.url && (
                          <p>
                            <strong>URL:</strong>{' '}
                            <a
                              href={event.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline break-all"
                            >
                              {event.url}
                            </a>
                          </p>
                        )}
                      </div>
                      {event.description && (
                        <div className="mt-4">
                          <strong className="text-sm text-gray-700 dark:text-gray-300">
                            Description:
                          </strong>
                          <p className="text-gray-700 dark:text-gray-300 mt-1 whitespace-pre-wrap">
                            {event.description}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4 border-t">
                    <button
                      onClick={() => handleEditEvent(event)}
                      className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
                    >
                      ✏️ Edit
                    </button>
                    <button
                      onClick={() => handleApprove(event.id)}
                      className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold"
                    >
                      ✅ Approve
                    </button>
                    <button
                      onClick={() => handleReject(event.id)}
                      className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-semibold"
                    >
                      ❌ Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
        </>
      )}

      {/* Tags Tab Content */}
      {adminTab === 'tags' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-semibold text-gray-900 dark:text-white">🏷️ Tag Management</h2>
            <div className="flex gap-3">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'name' | 'usage' | 'created')}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="name">Sort by Name</option>
                <option value="usage">Sort by Usage</option>
                <option value="created">Sort by Created Date</option>
              </select>
              <button
                onClick={handleCreateTag}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
              >
                + Create New Tag
              </button>
            </div>
          </div>

          {tagsLoading ? (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
              <p className="text-gray-600 dark:text-gray-400">Loading tags...</p>
            </div>
          ) : tags.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
              <p className="text-gray-600 dark:text-gray-400 text-lg mb-4">No tags found.</p>
              <button
                onClick={handleCreateTag}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
              >
                Create Your First Tag
              </button>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-900">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                        Tag Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                        Display Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                        Usage Count
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                        Description
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-300">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {tags.map((tag) => (
                      <tr key={tag.id} className="hover:bg-gray-50 dark:hover:bg-gray-900/60">
                        <td className="px-4 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {tag.color && (
                              <span
                                className="h-4 w-4 rounded-full"
                                style={{ backgroundColor: tag.color }}
                              />
                            )}
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {tag.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                          {tag.displayName || '—'}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                          <span className={`font-semibold ${tag.usageCount > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}>
                            {tag.usageCount}
                          </span>
                          <span className="text-gray-500 ml-1">event(s)</span>
                        </td>
                        <td className="px-4 py-4 text-sm text-gray-700 dark:text-gray-300 max-w-xs truncate">
                          {tag.description || '—'}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap text-sm text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => handleEditTag(tag)}
                              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-xs font-semibold"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteTag(tag)}
                              className="px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-xs font-semibold"
                              disabled={tag.usageCount > 0}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit/Create Tag Modal */}
      {showTagModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  {editingTag ? 'Edit Tag' : 'Create New Tag'}
                </h2>
                <button
                  onClick={() => {
                    setEditingTag(null);
                    setShowTagModal(false);
                    setTagFormData({ name: '', displayName: '', description: '', color: '', keywords: '' });
                  }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
                >
                  ×
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveTag();
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Tag Name *
                  </label>
                  <input
                    type="text"
                    value={tagFormData.name}
                    onChange={(e) => setTagFormData({ ...tagFormData, name: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    required
                    placeholder="e.g., adtech, programmatic"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Will be normalized (lowercase, hyphenated)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Display Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={tagFormData.displayName}
                    onChange={(e) => setTagFormData({ ...tagFormData, displayName: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="e.g., AdTech"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Friendly name for display (uses tag name if not set)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Description (Optional)
                  </label>
                  <textarea
                    value={tagFormData.description}
                    onChange={(e) => setTagFormData({ ...tagFormData, description: e.target.value })}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="Describe what this tag represents..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Color (Optional)
                  </label>
                  <div className="flex gap-3 items-center">
                    <input
                      type="color"
                      value={tagFormData.color || '#3b82f6'}
                      onChange={(e) => setTagFormData({ ...tagFormData, color: e.target.value })}
                      className="h-10 w-20 rounded border border-gray-300 dark:border-gray-600 cursor-pointer"
                    />
                    <input
                      type="text"
                      value={tagFormData.color}
                      onChange={(e) => setTagFormData({ ...tagFormData, color: e.target.value })}
                      className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                      placeholder="#3b82f6"
                      pattern="^#[0-9A-Fa-f]{6}$"
                    />
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Hex color code for tag display (e.g., #3b82f6)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Keywords (Optional)
                  </label>
                  <input
                    type="text"
                    value={tagFormData.keywords}
                    onChange={(e) => setTagFormData({ ...tagFormData, keywords: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="adtech, ad tech, advertising technology"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Comma-separated keywords for automatic tag extraction (e.g., "adtech, ad tech, advertising technology")
                  </p>
                </div>

                <div className="flex gap-3 pt-4 border-t">
                  <button
                    type="submit"
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
                  >
                    {editingTag ? 'Update Tag' : 'Create Tag'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTag(null);
                      setShowTagModal(false);
                      setTagFormData({ name: '', displayName: '', description: '', color: '', keywords: '' });
                    }}
                    className="px-6 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-500 transition font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Edit Event Modal */}
      {editingEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Edit Event</h2>
                <button
                  onClick={() => {
                    setEditingEvent(null);
                    setEditFormData({});
                    setEditSelectedTags([]);
                    setIsAllDay(true); // Reset to default
                  }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl"
                >
                  ×
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSaveEdit();
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Title *
                  </label>
                  <input
                    type="text"
                    value={editFormData.title || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Description
                  </label>
                  <textarea
                    value={editFormData.description || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                    rows={4}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  />
                </div>

                <div>
                  <label className="flex items-center mb-4">
                    <input
                      type="checkbox"
                      checked={isAllDay}
                      onChange={(e) => {
                        setIsAllDay(e.target.checked);
                        // Clear time values when switching to all-day
                        if (e.target.checked && editFormData.start) {
                          // Extract date part only (YYYY-MM-DD)
                          const startDate = editFormData.start.split('T')[0];
                          const endDate = editFormData.end?.split('T')[0] || '';
                          setEditFormData((prev) => ({
                            ...prev,
                            start: startDate,
                            end: endDate,
                          }));
                        }
                      }}
                      className="mr-2 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      All-day event
                    </span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {isAllDay ? 'Start Date *' : 'Start Date & Time *'}
                    </label>
                    <input
                      type={isAllDay ? 'date' : 'datetime-local'}
                      value={editFormData.start || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, start: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {isAllDay ? 'End Date *' : 'End Date & Time *'}
                    </label>
                    <input
                      type={isAllDay ? 'date' : 'datetime-local'}
                      value={editFormData.end || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, end: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Location
                  </label>
                  <input
                    type="text"
                    value={editFormData.location || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, location: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    URL
                  </label>
                  <input
                    type="url"
                    value={editFormData.url || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, url: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Source
                  </label>
                  <input
                    type="text"
                    value={editFormData.source || ''}
                    onChange={(e) => setEditFormData({ ...editFormData, source: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  />
                </div>

                {!isAllDay && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Timezone
                    </label>
                    <select
                      value={editFormData.timezone || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, timezone: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    >
                      <option value="America/New_York">Eastern Time (ET)</option>
                      <option value="America/Chicago">Central Time (CT)</option>
                      <option value="America/Denver">Mountain Time (MT)</option>
                      <option value="America/Los_Angeles">Pacific Time (PT)</option>
                      <option value="Europe/London">London (GMT)</option>
                      <option value="Europe/Paris">Paris (CET)</option>
                      <option value="Asia/Tokyo">Tokyo (JST)</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </div>
                )}

                {/* Tags Section */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Tags
                  </label>
                  <TagSelector
                    selectedTags={editSelectedTags}
                    onChange={setEditSelectedTags}
                    placeholder="Select tags..."
                    allowCustom={true}
                  />
                </div>

                {/* Structured Location Fields */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Country
                    </label>
                    <input
                      type="text"
                      value={editFormData.country || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, country: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Region/State
                    </label>
                    <input
                      type="text"
                      value={editFormData.region || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, region: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      City
                    </label>
                    <input
                      type="text"
                      value={editFormData.city || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, city: e.target.value })}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4 border-t">
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                  {editingEvent?.status === 'PENDING' && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        handleSaveEdit(true);
                      }}
                      disabled={saving}
                      className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {saving ? 'Saving...' : 'Save & Approve'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingEvent(null);
                      setEditFormData({});
                      setEditSelectedTags([]);
                      setIsAllDay(true); // Reset to default
                    }}
                    className="px-6 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-500 transition font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
