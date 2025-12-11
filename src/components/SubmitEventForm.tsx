'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { CreateEventInput } from '@/lib/validation';
import { parseLocationString } from '@/lib/extractor/locationExtractor';
import TagSelector from './TagSelector';

const US_STATES = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
  { value: 'DC', label: 'District of Columbia' },
];

const COUNTRIES = [
  { value: 'US', label: 'United States' },
  { value: 'CA', label: 'Canada' },
  { value: 'UK', label: 'United Kingdom' },
  { value: 'AU', label: 'Australia' },
  { value: 'DE', label: 'Germany' },
  { value: 'FR', label: 'France' },
  { value: 'IT', label: 'Italy' },
  { value: 'ES', label: 'Spain' },
  { value: 'NL', label: 'Netherlands' },
  { value: 'BE', label: 'Belgium' },
  { value: 'CH', label: 'Switzerland' },
  { value: 'AT', label: 'Austria' },
  { value: 'IE', label: 'Ireland' },
  { value: 'SG', label: 'Singapore' },
  { value: 'JP', label: 'Japan' },
  { value: 'IN', label: 'India' },
  { value: 'BR', label: 'Brazil' },
  { value: 'MX', label: 'Mexico' },
  { value: 'OTHER', label: 'Other' },
];

export default function SubmitEventForm() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [formData, setFormData] = useState<CreateEventInput>({
    title: '',
    description: '',
    url: '',
    location: '',
    start: '',
    end: '',
    timezone: process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || 'America/New_York',
    source: '',
    tags: [],
    country: 'US',
    region: '',
    city: '',
  });

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAllDay, setIsAllDay] = useState(true); // Default to all-day events

  // Auto-populate structured location from location string
  useEffect(() => {
    if (formData.location && formData.location.trim()) {
      const parsed = parseLocationString(formData.location);
      if (parsed.city || parsed.region || parsed.country) {
        setFormData((prev) => ({
          ...prev,
          city: prev.city || parsed.city || '',
          region: prev.region || parsed.region || '',
          country: prev.country || parsed.country || 'US',
        }));
      }
    }
  }, [formData.location]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Check authentication
    if (status !== 'authenticated' || !session) {
      router.push(`/login?callbackUrl=${encodeURIComponent('/submit')}`);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      // Ensure at least one tag is selected
      if (selectedTags.length === 0) {
        throw new Error('Please select at least one tag');
      }

      // Convert date or datetime to ISO datetime format
      // For all-day events: date-only format "2025-01-15" -> start of day / end of day
      // For timed events: datetime-local format "2025-01-15T10:00" -> ISO with time
      const convertToISO = (dateValue: string, isStart: boolean): string => {
        if (!dateValue || !dateValue.trim()) {
          throw new Error(`${isStart ? 'Start' : 'End'} date is required`);
        }
        
        if (isAllDay) {
          // For all-day events, date-only format: "YYYY-MM-DD"
          // Set start to 00:00:00 and end to 23:59:59 in local timezone
          const date = new Date(dateValue);
          if (isNaN(date.getTime())) {
            throw new Error('Invalid date format');
          }
          
          if (isStart) {
            // Start of day: 00:00:00 local time
            date.setHours(0, 0, 0, 0);
          } else {
            // End of day: 23:59:59 local time
            date.setHours(23, 59, 59, 999);
          }
          return date.toISOString();
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

      // Helper to convert empty strings to null for optional fields
      const nullIfEmpty = (value: string | null | undefined): string | null => {
        if (value === null || value === undefined) return null;
        const trimmed = value.trim();
        return trimmed === '' ? null : trimmed;
      };

      const submissionData = {
        title: formData.title.trim(),
        description: nullIfEmpty(formData.description),
        url: nullIfEmpty(formData.url),
        location: nullIfEmpty(formData.location),
        start: convertToISO(formData.start, true),
        end: convertToISO(formData.end, false),
        timezone: isAllDay ? null : (nullIfEmpty(formData.timezone) || 'America/New_York'),
        source: nullIfEmpty(formData.source),
        tags: selectedTags.length > 0 ? selectedTags : null,
        country: formData.country || 'US',
        region: nullIfEmpty(formData.region),
        city: nullIfEmpty(formData.city),
      };

      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submissionData),
      });

      const data = await res.json();

      if (!res.ok) {
        // Show detailed validation errors if available
        if (data.details && Array.isArray(data.details)) {
          const errorMessages = data.details.map((err: any) => {
            const field = err.path?.join('.') || 'field';
            return `${field}: ${err.message}`;
          });
          throw new Error(`Validation errors:\n${errorMessages.join('\n')}`);
        }
        throw new Error(data.error || 'Failed to submit event');
      }

      setSuccess(true);
      setSelectedTags([]);
      setFormData({
        title: '',
        description: '',
        url: '',
        location: '',
        start: '',
        end: '',
        timezone: process.env.NEXT_PUBLIC_DEFAULT_TIMEZONE || 'America/New_York',
        source: '',
        tags: [],
        country: 'US',
        region: '',
        city: '',
      });
      // Reset all-day checkbox to default
      setIsAllDay(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Show login prompt if not authenticated
  if (status === 'unauthenticated') {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-blue-50 border border-blue-200 text-blue-800 px-6 py-4 rounded-lg mb-6">
          <p className="font-semibold mb-2">Please sign in to submit events</p>
          <p className="text-sm mb-4">
            Login to submit events, subscribe to The Media Calendar, add events to your calendar and customize your event feeds.
          </p>
          <button
            onClick={() => router.push(`/login?callbackUrl=${encodeURIComponent('/submit')}`)}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition font-semibold"
          >
            Sign in to Submit
          </button>
        </div>
      </div>
    );
  }

  // Show loading state while checking auth
  if (status === 'loading') {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="text-center py-8 text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <form onSubmit={handleSubmit} className="space-y-6">
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-lg">
            ✅ Event submitted successfully! It will appear on the calendar once approved.
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg">
            ❌ {error}
          </div>
        )}

        <div>
          <label htmlFor="title" className="block text-sm font-semibold mb-2">
            Event Title *
          </label>
          <input
            type="text"
            id="title"
            name="title"
            value={formData.title}
            onChange={handleChange}
            required
            maxLength={200}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
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
                if (e.target.checked && formData.start) {
                  // Extract date part only (YYYY-MM-DD)
                  const startDate = formData.start.split('T')[0];
                  const endDate = formData.end.split('T')[0];
                  setFormData((prev) => ({
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
            <label htmlFor="start" className="block text-sm font-semibold mb-2">
              {isAllDay ? 'Start Date *' : 'Start Date & Time *'}
            </label>
            <input
              type={isAllDay ? 'date' : 'datetime-local'}
              id="start"
              name="start"
              value={formData.start}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
            />
          </div>

          <div>
            <label htmlFor="end" className="block text-sm font-semibold mb-2">
              {isAllDay ? 'End Date *' : 'End Date & Time *'}
            </label>
            <input
              type={isAllDay ? 'date' : 'datetime-local'}
              id="end"
              name="end"
              value={formData.end}
              onChange={handleChange}
              required
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
            />
          </div>
        </div>

        {!isAllDay && (
          <div>
            <label htmlFor="timezone" className="block text-sm font-semibold mb-2">
              Timezone
            </label>
            <select
              id="timezone"
              name="timezone"
              value={formData.timezone || ''}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
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

        <div>
          <label htmlFor="location" className="block text-sm font-semibold mb-2">
            Location (Full Address)
          </label>
          <input
            type="text"
            id="location"
            name="location"
            value={formData.location || ''}
            onChange={handleChange}
            maxLength={200}
            placeholder="e.g., New York, NY or Virtual"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
          />
          <p className="text-xs text-gray-500 mt-1">
            Structured location fields below will auto-populate if location matches a standard format
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="country" className="block text-sm font-semibold mb-2">
              Country
            </label>
            <select
              id="country"
              name="country"
              value={formData.country || ''}
              onChange={handleChange}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
            >
              {COUNTRIES.map((country) => (
                <option key={country.value} value={country.value}>
                  {country.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="region" className="block text-sm font-semibold mb-2">
              State/Region
            </label>
            {formData.country === 'US' ? (
              <select
                id="region"
                name="region"
                value={formData.region || ''}
                onChange={handleChange}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
              >
                <option value="">Select State</option>
                {US_STATES.map((state) => (
                  <option key={state.value} value={state.value}>
                    {state.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                id="region"
                name="region"
                value={formData.region || ''}
                onChange={handleChange}
                maxLength={100}
                placeholder="State/Province"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
              />
            )}
          </div>

          <div>
            <label htmlFor="city" className="block text-sm font-semibold mb-2">
              City
            </label>
            <input
              type="text"
              id="city"
              name="city"
              value={formData.city || ''}
              onChange={handleChange}
              maxLength={100}
              placeholder="City"
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold mb-2">
            Tags * <span className="text-xs font-normal text-gray-500">(Select at least one)</span>
          </label>
          <TagSelector
            selectedTags={selectedTags}
            onChange={setSelectedTags}
            placeholder="Select tags..."
            allowCustom={true}
          />
        </div>

        <div>
          <label htmlFor="url" className="block text-sm font-semibold mb-2">
            Event URL
          </label>
          <input
            type="url"
            id="url"
            name="url"
            value={formData.url || ''}
            onChange={handleChange}
            placeholder="https://example.com/event"
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-semibold mb-2">
            Description
          </label>
          <textarea
            id="description"
            name="description"
            value={formData.description || ''}
            onChange={handleChange}
            rows={5}
            maxLength={2000}
            placeholder="Describe the event..."
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
          />
        </div>

        <div>
          <label htmlFor="source" className="block text-sm font-semibold mb-2">
            Source
          </label>
          <input
            type="text"
            id="source"
            name="source"
            value={formData.source || ''}
            onChange={handleChange}
            placeholder="e.g., Beeler.Tech, IAB"
            maxLength={100}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-800"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Submitting...' : 'Submit Event for Approval'}
        </button>
      </form>
    </div>
  );
}
