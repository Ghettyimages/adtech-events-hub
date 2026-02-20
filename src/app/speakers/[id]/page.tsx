'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Topic {
  tagId: string;
  name: string;
  displayName: string | null;
  color: string | null;
  isPrimary: boolean;
  proficiency: string | null;
}

interface Engagement {
  id: string;
  eventName: string;
  talkTitle: string | null;
  eventDate: string | null;
  eventUrl: string | null;
  location: string | null;
  role: string;
  audienceSize: number | null;
  videoUrl: string | null;
  slidesUrl: string | null;
  notes: string | null;
}

interface Credential {
  id: string;
  name: string;
  issuer: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  credentialUrl: string | null;
}

interface SpeakerDetail {
  id: string;
  displayName: string;
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
  contactVisibility: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  preferredContact?: string | null;
  topics: Topic[];
  engagements: Engagement[];
  credentials: Credential[];
  createdAt: string;
  updatedAt: string;
}

const EXPERIENCE_LABELS: Record<string, string> = {
  FIRST_TIME: 'First-time speaker',
  SOME: 'Some experience',
  FREQUENT: 'Frequent speaker',
};

const TALK_FORMAT_LABELS: Record<string, string> = {
  keynote: 'Keynote',
  panel: 'Panel Discussion',
  workshop: 'Workshop',
  webinar: 'Webinar',
  moderator: 'Moderator',
  fireside: 'Fireside Chat',
  lightning: 'Lightning Talk',
};

const ROLE_LABELS: Record<string, string> = {
  SPEAKER: 'Speaker',
  MODERATOR: 'Moderator',
  PANELIST: 'Panelist',
  WORKSHOP_LEADER: 'Workshop Leader',
};

export default function SpeakerDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const speakerId = params.id as string;

  const [speaker, setSpeaker] = useState<SpeakerDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const isOrganizerOrAdmin =
    (session?.user as any)?.isOrganizer || (session?.user as any)?.isAdmin;

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push(`/login?callbackUrl=/speakers/${speakerId}`);
      return;
    }

    if (status === 'authenticated') {
      if (!isOrganizerOrAdmin) {
        setError('You do not have permission to view speaker profiles.');
        setIsLoading(false);
        return;
      }
      fetchSpeaker();
    }
  }, [status, isOrganizerOrAdmin, speakerId, router]);

  const fetchSpeaker = async () => {
    try {
      const response = await fetch(`/api/speakers/${speakerId}`);

      if (response.status === 403) {
        setError('You do not have permission to view this speaker profile.');
        return;
      }

      if (response.status === 404) {
        setError('Speaker not found.');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch speaker');
      }

      const data = await response.json();
      setSpeaker(data);
    } catch (err) {
      setError('An error occurred while loading the speaker profile');
    } finally {
      setIsLoading(false);
    }
  };

  if (status === 'loading' || isLoading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <div className="text-xl text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-2xl mx-auto text-center">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-8">
            <h2 className="text-xl font-semibold text-red-800 dark:text-red-200 mb-2">
              Error
            </h2>
            <p className="text-red-700 dark:text-red-300">{error}</p>
            <Link
              href="/speakers"
              className="inline-block mt-4 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
            >
              Back to Directory
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!speaker) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Back button */}
      <Link
        href="/speakers"
        className="inline-flex items-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 mb-6"
      >
        <svg
          className="w-4 h-4 mr-2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back to Directory
      </Link>

      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 mb-6">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                  {speaker.displayName}
                </h1>
                {speaker.pronouns && (
                  <span className="text-gray-500 dark:text-gray-400">
                    ({speaker.pronouns})
                  </span>
                )}
              </div>
              {(speaker.roleTitle || speaker.company) && (
                <p className="text-lg text-gray-600 dark:text-gray-400">
                  {speaker.roleTitle}
                  {speaker.roleTitle && speaker.company && ' at '}
                  <span className="font-medium">{speaker.company}</span>
                </p>
              )}
              {speaker.location && (
                <p className="text-gray-500 dark:text-gray-500 mt-1">
                  {speaker.location}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <span
                className={`text-sm px-3 py-1 rounded-full ${
                  speaker.experienceLevel === 'FIRST_TIME'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : speaker.experienceLevel === 'FREQUENT'
                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                    : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                }`}
              >
                {EXPERIENCE_LABELS[speaker.experienceLevel] || speaker.experienceLevel}
              </span>
            </div>
          </div>

          {/* Availability badges */}
          <div className="flex flex-wrap gap-2 mb-6">
            {speaker.availableVirtual && (
              <span className="px-3 py-1 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded-lg text-sm">
                Available for Virtual Events
              </span>
            )}
            {speaker.availableInPerson && (
              <span className="px-3 py-1 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded-lg text-sm">
                Available In-Person
              </span>
            )}
            {speaker.willingToTravel && (
              <span className="px-3 py-1 bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded-lg text-sm">
                Willing to Travel
              </span>
            )}
            {speaker.noticePeriodDays !== null && (
              <span className="px-3 py-1 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 rounded-lg text-sm">
                {speaker.noticePeriodDays === 0
                  ? 'Flexible notice'
                  : `${speaker.noticePeriodDays} day${speaker.noticePeriodDays !== 1 ? 's' : ''} notice`}
              </span>
            )}
          </div>

          {/* Topics */}
          {speaker.topics.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Topics
              </h3>
              <div className="flex flex-wrap gap-2">
                {speaker.topics.map((topic) => (
                  <span
                    key={topic.tagId}
                    className="px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                    style={
                      topic.color
                        ? { backgroundColor: topic.color + '20', color: topic.color }
                        : undefined
                    }
                  >
                    {topic.displayName || topic.name}
                    {topic.isPrimary && ' ★'}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Talk formats */}
          {speaker.talkFormats.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Comfortable With
              </h3>
              <div className="flex flex-wrap gap-2">
                {speaker.talkFormats.map((format) => (
                  <span
                    key={format}
                    className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm"
                  >
                    {TALK_FORMAT_LABELS[format] || format}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Links */}
          <div className="flex flex-wrap gap-4">
            {speaker.linkedinUrl && (
              <a
                href={speaker.linkedinUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-blue-600 hover:text-blue-800 dark:text-blue-400"
              >
                <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                </svg>
                LinkedIn
                {speaker.preferredContact === 'LINKEDIN' && (
                  <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                    (preferred)
                  </span>
                )}
              </a>
            )}
            {speaker.websiteUrl && (
              <a
                href={speaker.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-blue-600 hover:text-blue-800 dark:text-blue-400"
              >
                <svg
                  className="w-5 h-5 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
                  />
                </svg>
                Website
              </a>
            )}
          </div>
        </div>

        {/* Bio */}
        {speaker.bio && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              About
            </h2>
            <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
              {speaker.bio}
            </p>
          </div>
        )}

        {/* Notes for organizers */}
        {speaker.notes && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-blue-800 dark:text-blue-200 mb-2">
              Notes for Organizers
            </h2>
            <p className="text-blue-700 dark:text-blue-300 whitespace-pre-wrap">
              {speaker.notes}
            </p>
          </div>
        )}

        {/* Contact information */}
        {(speaker.contactEmail || speaker.contactPhone) && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Contact Information
            </h2>
            <div className="space-y-3">
              {speaker.contactEmail && (
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 text-gray-400 mr-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                  <a
                    href={`mailto:${speaker.contactEmail}`}
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                  >
                    {speaker.contactEmail}
                  </a>
                  {speaker.preferredContact === 'EMAIL' && (
                    <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                      (preferred)
                    </span>
                  )}
                </div>
              )}
              {speaker.contactPhone && (
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 text-gray-400 mr-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                  <a
                    href={`tel:${speaker.contactPhone}`}
                    className="text-blue-600 hover:text-blue-800 dark:text-blue-400"
                  >
                    {speaker.contactPhone}
                  </a>
                  {speaker.preferredContact === 'PHONE' && (
                    <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                      (preferred)
                    </span>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
              Contact visibility: {speaker.contactVisibility.toLowerCase().replace('_', ' ')}
            </p>
          </div>
        )}

        {/* Past engagements */}
        {speaker.engagements.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Past Speaking Engagements ({speaker.engagements.length})
            </h2>
            <div className="space-y-4">
              {speaker.engagements.map((engagement) => (
                <div
                  key={engagement.id}
                  className="border-b border-gray-200 dark:border-gray-700 pb-4 last:border-0 last:pb-0"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900 dark:text-white">
                        {engagement.eventName}
                      </h3>
                      {engagement.talkTitle && (
                        <p className="text-gray-600 dark:text-gray-400 text-sm">
                          &ldquo;{engagement.talkTitle}&rdquo;
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400">
                        <span>{ROLE_LABELS[engagement.role] || engagement.role}</span>
                        {engagement.eventDate && (
                          <span>
                            • {new Date(engagement.eventDate).toLocaleDateString()}
                          </span>
                        )}
                        {engagement.location && <span>• {engagement.location}</span>}
                        {engagement.audienceSize && (
                          <span>• {engagement.audienceSize} attendees</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {engagement.videoUrl && (
                        <a
                          href={engagement.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm"
                        >
                          Video
                        </a>
                      )}
                      {engagement.slidesUrl && (
                        <a
                          href={engagement.slidesUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm"
                        >
                          Slides
                        </a>
                      )}
                      {engagement.eventUrl && (
                        <a
                          href={engagement.eventUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm"
                        >
                          Event
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Credentials */}
        {speaker.credentials.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
              Credentials & Certifications ({speaker.credentials.length})
            </h2>
            <div className="space-y-3">
              {speaker.credentials.map((credential) => (
                <div
                  key={credential.id}
                  className="flex items-start justify-between"
                >
                  <div>
                    <h3 className="font-medium text-gray-900 dark:text-white">
                      {credential.name}
                    </h3>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      {credential.issuer && <span>{credential.issuer}</span>}
                      {credential.issuedAt && (
                        <span>
                          {credential.issuer && ' • '}
                          Issued {new Date(credential.issuedAt).toLocaleDateString()}
                        </span>
                      )}
                      {credential.expiresAt && (
                        <span>
                          {' '}
                          • Expires {new Date(credential.expiresAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  {credential.credentialUrl && (
                    <a
                      href={credential.credentialUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 dark:text-blue-400 text-sm"
                    >
                      View
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
