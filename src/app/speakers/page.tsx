'use client';

import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';
import TagSelector from '@/components/TagSelector';

interface Speaker {
  id: string;
  displayName: string;
  pronouns: string | null;
  company: string | null;
  roleTitle: string | null;
  location: string | null;
  bio: string | null;
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
  topics: Array<{
    name: string;
    displayName: string | null;
    color: string | null;
    isPrimary: boolean;
  }>;
  engagementsCount: number;
  credentialsCount: number;
  updatedAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

const EXPERIENCE_LABELS: Record<string, string> = {
  FIRST_TIME: 'First-time speaker',
  SOME: 'Some experience',
  FREQUENT: 'Frequent speaker',
};

function SpeakersContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter state
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [selectedTopics, setSelectedTopics] = useState<string[]>(
    searchParams.get('topics')?.split(',').filter(Boolean) || []
  );
  const [experienceLevel, setExperienceLevel] = useState(
    searchParams.get('experienceLevel') || ''
  );
  const [availableVirtual, setAvailableVirtual] = useState(
    searchParams.get('availableVirtual') === 'true'
  );
  const [availableInPerson, setAvailableInPerson] = useState(
    searchParams.get('availableInPerson') === 'true'
  );
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'recent');
  const [currentPage, setCurrentPage] = useState(
    parseInt(searchParams.get('page') || '1', 10)
  );

  const isOrganizerOrAdmin =
    (session?.user as any)?.isOrganizer || (session?.user as any)?.isAdmin;

  // Track if initial load has happened
  const [hasInitialLoad, setHasInitialLoad] = useState(false);

  const fetchSpeakers = useCallback(async (options?: {
    query?: string;
    topics?: string[];
    experience?: string;
    virtual?: boolean;
    inPerson?: boolean;
    sort?: string;
    page?: number;
  }) => {
    if (!isOrganizerOrAdmin) return;

    setIsLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      const q = options?.query ?? searchQuery;
      const t = options?.topics ?? selectedTopics;
      const exp = options?.experience ?? experienceLevel;
      const virt = options?.virtual ?? availableVirtual;
      const inP = options?.inPerson ?? availableInPerson;
      const s = options?.sort ?? sortBy;
      const p = options?.page ?? currentPage;

      if (q) params.set('q', q);
      if (t.length > 0) params.set('topics', t.join(','));
      if (exp) params.set('experienceLevel', exp);
      if (virt) params.set('availableVirtual', 'true');
      if (inP) params.set('availableInPerson', 'true');
      params.set('sort', s);
      params.set('page', p.toString());

      const response = await fetch(`/api/speakers?${params.toString()}`);

      if (response.status === 403) {
        setError('You do not have permission to view the speaker directory.');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch speakers');
      }

      const data = await response.json();
      setSpeakers(data.speakers);
      setPagination(data.pagination);
    } catch (err) {
      setError('An error occurred while loading speakers');
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOrganizerOrAdmin]);

  // Initial load only - fetch all speakers once when page loads
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login?callbackUrl=/speakers');
      return;
    }

    if (status === 'authenticated' && !hasInitialLoad) {
      if (!isOrganizerOrAdmin) {
        setError('You do not have permission to view the speaker directory.');
        setIsLoading(false);
        return;
      }
      setHasInitialLoad(true);
      fetchSpeakers();
    }
  }, [status, isOrganizerOrAdmin, hasInitialLoad, fetchSpeakers, router]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchSpeakers({
      query: searchQuery,
      topics: selectedTopics,
      experience: experienceLevel,
      virtual: availableVirtual,
      inPerson: availableInPerson,
      sort: sortBy,
      page: 1,
    });
  };

  const handleReset = () => {
    setSearchQuery('');
    setSelectedTopics([]);
    setExperienceLevel('');
    setAvailableVirtual(false);
    setAvailableInPerson(false);
    setSortBy('recent');
    setCurrentPage(1);
    // Fetch with reset values
    fetchSpeakers({
      query: '',
      topics: [],
      experience: '',
      virtual: false,
      inPerson: false,
      sort: 'recent',
      page: 1,
    });
  };

  if (status === 'loading' || (status === 'authenticated' && isLoading && speakers.length === 0)) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <div className="text-xl text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </div>
    );
  }

  if (error && !isOrganizerOrAdmin) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-2xl mx-auto text-center">
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-8">
            <h2 className="text-xl font-semibold text-red-800 dark:text-red-200 mb-2">
              Access Denied
            </h2>
            <p className="text-red-700 dark:text-red-300">
              The speaker directory is only accessible to event organizers and administrators.
            </p>
            <Link
              href="/"
              className="inline-block mt-4 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
            >
              Go Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          Speaker Directory
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Find diverse speakers for your events. Use filters to narrow down your search.
        </p>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-8">
        <form onSubmit={handleSearch}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Search */}
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Search
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, company, role, or bio..."
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              />
            </div>

            {/* Sort */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Sort By
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              >
                <option value="recent">Most Recent</option>
                <option value="name">Name (A-Z)</option>
                <option value="experience">Most Experienced</option>
                <option value="lastUpdated">Last Updated</option>
              </select>
            </div>

            {/* Topics */}
            <div className="lg:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Topics
              </label>
              <TagSelector
                selectedTags={selectedTopics}
                onChange={setSelectedTopics}
                placeholder="Filter by topics..."
                allowCustom={false}
              />
            </div>

            {/* Experience Level */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Experience Level
              </label>
              <select
                value={experienceLevel}
                onChange={(e) => setExperienceLevel(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              >
                <option value="">Any experience</option>
                <option value="FIRST_TIME">First-time speakers</option>
                <option value="SOME">Some experience</option>
                <option value="FREQUENT">Frequent speakers</option>
              </select>
            </div>

            {/* Availability */}
            <div className="lg:col-span-3 flex flex-wrap gap-4 items-center">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={availableVirtual}
                  onChange={(e) => setAvailableVirtual(e.target.checked)}
                  className="mr-2 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Available for virtual
                </span>
              </label>

              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={availableInPerson}
                  onChange={(e) => setAvailableInPerson(e.target.checked)}
                  className="mr-2 w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Available in-person
                </span>
              </label>

              <div className="flex-1" />

              <button
                type="button"
                onClick={handleReset}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition"
              >
                Reset Filters
              </button>

              <button
                type="submit"
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-semibold"
              >
                Search
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Results */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <p className="text-red-800 dark:text-red-200">{error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8">
          <div className="text-gray-600 dark:text-gray-400">Searching...</div>
        </div>
      ) : speakers.length === 0 ? (
        <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-8 text-center">
          <p className="text-gray-600 dark:text-gray-400 text-lg">
            No speakers found matching your criteria.
          </p>
          <p className="text-gray-500 dark:text-gray-500 mt-2">
            Try adjusting your filters or search terms.
          </p>
        </div>
      ) : (
        <>
          {/* Results count */}
          <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Showing {speakers.length} of {pagination?.total || 0} speakers
          </div>

          {/* Speaker cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {speakers.map((speaker) => (
              <Link
                key={speaker.id}
                href={`/speakers/${speaker.id}`}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition border border-gray-200 dark:border-gray-700"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {speaker.displayName}
                    </h3>
                    {speaker.pronouns && (
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        ({speaker.pronouns})
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded-full ${
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

                {(speaker.roleTitle || speaker.company) && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    {speaker.roleTitle}
                    {speaker.roleTitle && speaker.company && ' at '}
                    {speaker.company}
                  </p>
                )}

                {speaker.location && (
                  <p className="text-sm text-gray-500 dark:text-gray-500 mb-3">
                    {speaker.location}
                  </p>
                )}

                {speaker.bio && (
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-3 line-clamp-3">
                    {speaker.bio}
                  </p>
                )}

                {/* Topics */}
                {speaker.topics.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {speaker.topics.slice(0, 4).map((topic) => (
                      <span
                        key={topic.name}
                        className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                        style={
                          topic.color
                            ? { backgroundColor: topic.color + '20', color: topic.color }
                            : undefined
                        }
                      >
                        {topic.displayName || topic.name}
                      </span>
                    ))}
                    {speaker.topics.length > 4 && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        +{speaker.topics.length - 4} more
                      </span>
                    )}
                  </div>
                )}

                {/* Availability badges */}
                <div className="flex flex-wrap gap-2 text-xs">
                  {speaker.availableVirtual && (
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 rounded">
                      Virtual
                    </span>
                  )}
                  {speaker.availableInPerson && (
                    <span className="px-2 py-0.5 bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded">
                      In-Person
                    </span>
                  )}
                  {speaker.noticePeriodDays !== null && speaker.noticePeriodDays <= 7 && (
                    <span className="px-2 py-0.5 bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 rounded">
                      Short notice OK
                    </span>
                  )}
                  {speaker.engagementsCount > 0 && (
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 rounded">
                      {speaker.engagementsCount} past event{speaker.engagementsCount !== 1 && 's'}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex justify-center gap-2 mt-8">
              <button
                onClick={() => {
                  const newPage = Math.max(1, currentPage - 1);
                  setCurrentPage(newPage);
                  fetchSpeakers({ page: newPage });
                }}
                disabled={currentPage === 1}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>

              <span className="px-4 py-2 text-gray-600 dark:text-gray-400">
                Page {currentPage} of {pagination.totalPages}
              </span>

              <button
                onClick={() => {
                  const newPage = Math.min(pagination.totalPages, currentPage + 1);
                  setCurrentPage(newPage);
                  fetchSpeakers({ page: newPage });
                }}
                disabled={!pagination.hasMore}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SpeakersPage() {
  return (
    <Suspense fallback={
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <div className="text-xl text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </div>
    }>
      <SpeakersContent />
    </Suspense>
  );
}
