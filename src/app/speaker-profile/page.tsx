'use client';

import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import TagSelector from '@/components/TagSelector';

interface SpeakerProfileData {
  id: string;
  userId: string;
  displayName: string | null;
  pronouns: string | null;
  company: string | null;
  roleTitle: string | null;
  location: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  bio: string | null;
  notes: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  experienceLevel: string;
  talkFormats: string[];
  availableVirtual: boolean;
  availableInPerson: boolean;
  noticePeriodDays: number | null;
  willingToTravel: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  preferredContact: string | null;
  contactVisibility: string;
  status: string;
  topicNames: string[];
  accountEmail?: string | null;
  createdAt: string;
  updatedAt: string;
}

const TALK_FORMATS = [
  { id: 'keynote', label: 'Keynote' },
  { id: 'panel', label: 'Panel Discussion' },
  { id: 'workshop', label: 'Workshop' },
  { id: 'webinar', label: 'Webinar' },
  { id: 'moderator', label: 'Moderator' },
  { id: 'fireside', label: 'Fireside Chat' },
  { id: 'lightning', label: 'Lightning Talk' },
];

const EXPERIENCE_LEVELS = [
  { id: 'FIRST_TIME', label: 'First-time speaker (looking for opportunities)' },
  { id: 'SOME', label: 'Some experience (spoken at a few events)' },
  { id: 'FREQUENT', label: 'Frequent speaker (regularly speak at events)' },
];

const CONTACT_VISIBILITY_OPTIONS = [
  { id: 'PRIVATE', label: 'Private (only I can see)' },
  { id: 'ORGANIZERS_ONLY', label: 'Organizers only (event coordinators can see)' },
  { id: 'PUBLIC', label: 'Public (visible on my profile)' },
];

function StatusBanners({
  success,
  error,
}: {
  success: string;
  error: string;
}) {
  return (
    <>
      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-6">
          <p className="text-green-800 dark:text-green-200">{success}</p>
        </div>
      )}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}
    </>
  );
}

export default function SpeakerProfilePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<SpeakerProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [formData, setFormData] = useState({
    displayName: '',
    pronouns: '',
    company: '',
    roleTitle: '',
    location: '',
    country: '',
    region: '',
    city: '',
    timezone: '',
    bio: '',
    notes: '',
    linkedinUrl: '',
    websiteUrl: '',
    experienceLevel: 'SOME',
    talkFormats: [] as string[],
    availableVirtual: true,
    availableInPerson: true,
    noticePeriodDays: '',
    willingToTravel: false,
    contactEmail: '',
    contactPhone: '',
    preferredContact: 'EMAIL',
    contactVisibility: 'ORGANIZERS_ONLY',
    topics: [] as string[],
  });

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login?callbackUrl=/speaker-profile');
      return;
    }

    if (status === 'authenticated' && session) {
      fetchProfile();
    }
  }, [status, session, router]);

  const fetchProfile = async () => {
    try {
      const response = await fetch('/api/speaker-profile');
      if (response.ok) {
        const data = await response.json();
        setProfile(data);
        setFormData({
          displayName: data.displayName || '',
          pronouns: data.pronouns || '',
          company: data.company || '',
          roleTitle: data.roleTitle || '',
          location: data.location || '',
          country: data.country || '',
          region: data.region || '',
          city: data.city || '',
          timezone: data.timezone || '',
          bio: data.bio || '',
          notes: data.notes || '',
          linkedinUrl: data.linkedinUrl || '',
          websiteUrl: data.websiteUrl || '',
          experienceLevel: data.experienceLevel || 'SOME',
          talkFormats: data.talkFormats || [],
          availableVirtual: data.availableVirtual ?? true,
          availableInPerson: data.availableInPerson ?? true,
          noticePeriodDays: data.noticePeriodDays?.toString() || '',
          willingToTravel: data.willingToTravel ?? false,
          contactEmail: data.contactEmail || data.accountEmail || '',
          contactPhone: data.contactPhone || '',
          preferredContact: data.preferredContact || 'EMAIL',
          contactVisibility: data.contactVisibility || 'ORGANIZERS_ONLY',
          topics: data.topicNames || [],
        });
      } else {
        setError('Failed to load speaker profile');
      }
    } catch (err) {
      setError('An error occurred while loading your profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/speaker-profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          noticePeriodDays: formData.noticePeriodDays
            ? parseInt(formData.noticePeriodDays, 10)
            : null,
        }),
      });

      if (response.ok) {
        const updatedProfile = await response.json();
        setProfile(updatedProfile);
        setSuccess('Profile saved successfully!');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to update profile');
      }
    } catch (err) {
      setError('An error occurred while saving your profile');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublish = async () => {
    setIsPublishing(true);
    setError('');
    setSuccess('');

    try {
      // First, save the current form data
      const saveResponse = await fetch('/api/speaker-profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          noticePeriodDays: formData.noticePeriodDays
            ? parseInt(formData.noticePeriodDays, 10)
            : null,
        }),
      });

      if (!saveResponse.ok) {
        const saveError = await saveResponse.json();
        setError(saveError.error || 'Failed to save profile before publishing');
        return;
      }

      // Now attempt to publish
      const response = await fetch('/api/speaker-profile/publish', {
        method: 'POST',
      });

      const data = await response.json();

      if (response.ok) {
        setProfile(data.profile);
        setSuccess('Profile published! You are now visible in the speaker directory.');
      } else {
        if (data.missingFields) {
          setError(
            `Cannot publish: Please fill in the following: ${data.missingFields.join(', ')}`
          );
        } else {
          setError(data.error || 'Failed to publish profile');
        }
      }
    } catch (err) {
      setError('An error occurred while publishing your profile');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!confirm('Are you sure you want to unpublish your profile? You will no longer appear in the speaker directory.')) {
      return;
    }

    setIsPublishing(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/speaker-profile/publish', {
        method: 'DELETE',
      });

      if (response.ok) {
        const data = await response.json();
        setProfile(data.profile);
        setSuccess('Profile unpublished. It is now a draft.');
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to unpublish profile');
      }
    } catch (err) {
      setError('An error occurred while unpublishing your profile');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setFormData((prev) => ({ ...prev, [name]: checked }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleTalkFormatToggle = (formatId: string) => {
    setFormData((prev) => ({
      ...prev,
      talkFormats: prev.talkFormats.includes(formatId)
        ? prev.talkFormats.filter((f) => f !== formatId)
        : [...prev.talkFormats, formatId],
    }));
  };

  if (status === 'loading' || isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto text-center">
          <div className="text-xl text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  const isPublished = profile?.status === 'PUBLISHED';

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Speaker Profile
          </h1>
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              isPublished
                ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                : 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
            }`}
          >
            {isPublished ? 'Published' : 'Draft'}
          </span>
        </div>

        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Create your speaker profile to be discovered by event organizers looking for diverse
          voices and fresh perspectives.
        </p>

        <StatusBanners success={success} error={error} />

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
          <form onSubmit={handleSubmit} className="space-y-8">
            {/* Basic Info Section */}
            <section>
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                Basic Information
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="displayName"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Display Name
                  </label>
                  <input
                    id="displayName"
                    name="displayName"
                    type="text"
                    value={formData.displayName}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="Your name as it should appear"
                  />
                </div>

                <div>
                  <label
                    htmlFor="pronouns"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Pronouns (optional)
                  </label>
                  <input
                    id="pronouns"
                    name="pronouns"
                    type="text"
                    value={formData.pronouns}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="e.g., she/her, he/him, they/them"
                  />
                </div>

                <div>
                  <label
                    htmlFor="company"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Company/Organization
                  </label>
                  <input
                    id="company"
                    name="company"
                    type="text"
                    value={formData.company}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="Your company or organization"
                  />
                </div>

                <div>
                  <label
                    htmlFor="roleTitle"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Role/Title
                  </label>
                  <input
                    id="roleTitle"
                    name="roleTitle"
                    type="text"
                    value={formData.roleTitle}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="Your job title"
                  />
                </div>
              </div>
            </section>

            {/* Location Section */}
            <section>
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                Location
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label
                    htmlFor="location"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Location (freeform)
                  </label>
                  <input
                    id="location"
                    name="location"
                    type="text"
                    value={formData.location}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="e.g., New York, NY or Remote"
                  />
                </div>

                <div>
                  <label
                    htmlFor="city"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    City
                  </label>
                  <input
                    id="city"
                    name="city"
                    type="text"
                    value={formData.city}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="City"
                  />
                </div>

                <div>
                  <label
                    htmlFor="region"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    State/Region
                  </label>
                  <input
                    id="region"
                    name="region"
                    type="text"
                    value={formData.region}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="State or region"
                  />
                </div>

                <div>
                  <label
                    htmlFor="country"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Country
                  </label>
                  <input
                    id="country"
                    name="country"
                    type="text"
                    value={formData.country}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="Country"
                  />
                </div>

                <div>
                  <label
                    htmlFor="timezone"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Timezone
                  </label>
                  <select
                    id="timezone"
                    name="timezone"
                    value={formData.timezone}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  >
                    <option value="">Select timezone...</option>
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
              </div>
            </section>

            {/* Bio & Topics Section */}
            <section>
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                Bio & Expertise
              </h2>

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="bio"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Speaker Bio <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    id="bio"
                    name="bio"
                    value={formData.bio}
                    onChange={handleChange}
                    rows={5}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="Tell event organizers about yourself, your background, and what makes you a compelling speaker..."
                  />
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Required for publishing. This will be visible to event organizers.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Topics You Can Speak On <span className="text-red-500">*</span>
                  </label>
                  <TagSelector
                    selectedTags={formData.topics}
                    onChange={(topics) => setFormData((prev) => ({ ...prev, topics }))}
                    placeholder="Select topics..."
                    allowCustom={true}
                  />
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Select at least one topic. You can also add custom topics.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="notes"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Additional Notes for Organizers (optional)
                  </label>
                  <textarea
                    id="notes"
                    name="notes"
                    value={formData.notes}
                    onChange={handleChange}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="Any additional context, preferences, or things organizers should know..."
                  />
                </div>
              </div>
            </section>

            {/* Experience & Formats Section */}
            <section>
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                Speaking Experience & Formats
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Experience Level
                  </label>
                  <div className="space-y-2">
                    {EXPERIENCE_LEVELS.map((level) => (
                      <label key={level.id} className="flex items-center">
                        <input
                          type="radio"
                          name="experienceLevel"
                          value={level.id}
                          checked={formData.experienceLevel === level.id}
                          onChange={handleChange}
                          className="mr-3 w-4 h-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {level.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Talk Formats (select all that apply)
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {TALK_FORMATS.map((format) => (
                      <label
                        key={format.id}
                        className="flex items-center p-2 border border-gray-200 dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
                      >
                        <input
                          type="checkbox"
                          checked={formData.talkFormats.includes(format.id)}
                          onChange={() => handleTalkFormatToggle(format.id)}
                          className="mr-2 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300">
                          {format.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Availability Section */}
            <section>
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                Availability
              </h2>

              <div className="space-y-4">
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      name="availableVirtual"
                      checked={formData.availableVirtual}
                      onChange={handleChange}
                      className="mr-2 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Available for virtual events
                    </span>
                  </label>

                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      name="availableInPerson"
                      checked={formData.availableInPerson}
                      onChange={handleChange}
                      className="mr-2 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Available for in-person events
                    </span>
                  </label>

                  <label className="flex items-center">
                    <input
                      type="checkbox"
                      name="willingToTravel"
                      checked={formData.willingToTravel}
                      onChange={handleChange}
                      className="mr-2 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      Willing to travel
                    </span>
                  </label>
                </div>

                <div className="max-w-xs">
                  <label
                    htmlFor="noticePeriodDays"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Minimum notice needed (days)
                  </label>
                  <input
                    id="noticePeriodDays"
                    name="noticePeriodDays"
                    type="number"
                    min="0"
                    max="365"
                    value={formData.noticePeriodDays}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="e.g., 7"
                  />
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                    Leave blank if flexible. Helps organizers find last-minute speakers.
                  </p>
                </div>
              </div>
            </section>

            {/* Links Section */}
            <section>
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                Links
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="linkedinUrl"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    LinkedIn Profile
                  </label>
                  <input
                    id="linkedinUrl"
                    name="linkedinUrl"
                    type="url"
                    value={formData.linkedinUrl}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="https://linkedin.com/in/yourprofile"
                  />
                </div>

                <div>
                  <label
                    htmlFor="websiteUrl"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Personal Website
                  </label>
                  <input
                    id="websiteUrl"
                    name="websiteUrl"
                    type="url"
                    value={formData.websiteUrl}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="https://yourwebsite.com"
                  />
                </div>
              </div>
            </section>

            {/* Contact Section */}
            <section>
              <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">
                Contact Information
              </h2>

              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Select your preferred way for organizers to reach you. We&apos;ll use your
                  account email if you haven&apos;t entered one.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="preferredContact"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                    >
                      Preferred Contact Method
                    </label>
                    <select
                      id="preferredContact"
                      name="preferredContact"
                      value={formData.preferredContact}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    >
                      <option value="EMAIL">Email</option>
                      <option value="PHONE">Phone</option>
                      <option value="LINKEDIN">LinkedIn</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="contactVisibility"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                    >
                      Contact Visibility
                    </label>
                    <select
                      id="contactVisibility"
                      name="contactVisibility"
                      value={formData.contactVisibility}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    >
                      {CONTACT_VISIBILITY_OPTIONS.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="contactEmail"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Contact Email
                  </label>
                  <input
                    id="contactEmail"
                    name="contactEmail"
                    type="email"
                    value={formData.contactEmail}
                    onChange={handleChange}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                    placeholder="contact@example.com"
                  />
                </div>

                {formData.preferredContact === 'PHONE' && (
                  <div>
                    <label
                      htmlFor="contactPhone"
                      className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                    >
                      Contact Phone <span className="text-red-500">(required)</span>
                    </label>
                    <input
                      id="contactPhone"
                      name="contactPhone"
                      type="tel"
                      value={formData.contactPhone}
                      onChange={handleChange}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                      placeholder="+1 (555) 123-4567"
                    />
                  </div>
                )}
              </div>
            </section>

            {/* Action Buttons */}
            <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSaving ? 'Saving...' : 'Save Draft'}
                </button>

                {!isPublished ? (
                  <button
                    type="button"
                    onClick={handlePublish}
                    disabled={isPublishing || isSaving}
                    className="flex-1 bg-green-600 text-white py-3 px-6 rounded-lg hover:bg-green-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isPublishing ? 'Publishing...' : 'Publish Profile'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleUnpublish}
                    disabled={isPublishing || isSaving}
                    className="flex-1 bg-yellow-600 text-white py-3 px-6 rounded-lg hover:bg-yellow-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isPublishing ? 'Unpublishing...' : 'Unpublish (Make Draft)'}
                  </button>
                )}

                <Link
                  href="/"
                  className="px-6 py-3 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition font-semibold text-center"
                >
                  Cancel
                </Link>
              </div>
              <StatusBanners success={success} error={error} />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
