'use client';

import { Event } from '@prisma/client';
import { format } from 'date-fns';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AddToCalendarLink from './AddToCalendarLink';
import SubscribeModal from './SubscribeModal';
import { formatEventDateForDisplay } from '@/lib/events';

interface EventCardProps {
  event: Event;
  onClose: () => void;
}

export default function EventCard({ event, onClose }: EventCardProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [fullSubscriptionActive, setFullSubscriptionActive] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [showFullModal, setShowFullModal] = useState(false);
  const [feedToken, setFeedToken] = useState<string | null>(null);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && session) {
      checkSubscriptionStatus();
    }
  }, [status, session, event.id]);

  const checkSubscriptionStatus = async () => {
    try {
      // Check if following this event
      const followRes = await fetch(`/api/subscriptions/status?eventId=${event.id}`);
      if (followRes.ok) {
        const data = await followRes.json();
        setIsFollowing(data.isFollowing || false);
        setFullSubscriptionActive(data.fullSubscriptionActive || false);
        setFeedToken(data.feedToken || null);
      }
    } catch (error) {
      console.error('Error checking subscription status:', error);
    }
  };

  const handleFollow = async () => {
    const res = await fetch('/api/follow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        eventId: event.id,
        acceptTerms: true,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setIsFollowing(true);
      setFeedToken(data.feedToken || feedToken);
      setShowFollowModal(false);
      setShowDropdown(false);
    } else {
      const error = await res.json();
      throw new Error(error.error || 'Failed to follow event');
    }
  };

  const handleUnfollow = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/unfollow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id }),
      });

      if (res.ok) {
        setIsFollowing(false);
        setShowDropdown(false);
      } else {
        const error = await res.json();
        alert(error.error || 'Failed to unfollow event');
      }
    } catch (error) {
      alert('An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleFullSubscription = async () => {
    const res = await fetch('/api/subscriptions/full/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acceptTerms: true }),
    });

    if (res.ok) {
      const data = await res.json();
      setFullSubscriptionActive(data.subscription.active);
      setFeedToken(data.feedToken || feedToken);
      setShowFullModal(false);
      setShowDropdown(false);
    } else {
      const error = await res.json();
      throw new Error(error.error || 'Failed to toggle subscription');
    }
  };
  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-2xl w-full min-h-[500px] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 md:p-6">
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <h2 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-white">{event.title}</h2>
              {'subscribers' in event && typeof event.subscribers === 'number' && event.subscribers > 0 && (
                <span className="inline-flex items-center px-2 py-1 rounded text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                  👥 {event.subscribers}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl p-3 -m-3 min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                Date
              </h3>
              <p className="text-gray-900 dark:text-gray-100">
                <strong>Start:</strong> {formatEventDateForDisplay(event.start, !event.timezone, false)}
              </p>
              <p className="text-gray-900 dark:text-gray-100">
                <strong>End:</strong> {formatEventDateForDisplay(event.end, !event.timezone, true)}
              </p>
            </div>

            {(event.location || event.city || event.region || event.country) && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Location
                </h3>
                {/* Show structured location if available */}
                {(event.city || event.region || event.country) ? (
                  <p className="text-gray-900 dark:text-gray-100">
                    {[event.city, event.region, event.country].filter(Boolean).join(', ')}
                  </p>
                ) : (
                  <p className="text-gray-900 dark:text-gray-100">{event.location}</p>
                )}
                {/* Show full location string if different from structured */}
                {event.location && (event.city || event.region || event.country) && 
                 event.location !== [event.city, event.region, event.country].filter(Boolean).join(', ') && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                    {event.location}
                  </p>
                )}
              </div>
            )}

            {event.tags && (() => {
              try {
                const tagsArray = JSON.parse(event.tags);
                return Array.isArray(tagsArray) && tagsArray.length > 0 ? (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                      Tags
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {tagsArray.map((tag: string) => (
                        <span
                          key={tag}
                          className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null;
              } catch {
                return null;
              }
            })()}

            {event.description && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Description
                </h3>
                <div className="text-gray-700 dark:text-gray-300">
                  <p className={isDescriptionExpanded ? 'whitespace-pre-wrap' : 'line-clamp-1'}>
                    {event.description}
                  </p>
                  {(event.description.includes('\n') || event.description.length > 100) && (
                    <button
                      onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                      className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm mt-1"
                    >
                      {isDescriptionExpanded ? 'Show less' : '... more'}
                    </button>
                  )}
                </div>
              </div>
            )}

            {event.url && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Event Link
                </h3>
                <a
                  href={event.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 underline break-all"
                >
                  {event.url}
                </a>
              </div>
            )}

            {event.source && (
              <div>
                <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">
                  Source
                </h3>
                <p className="text-gray-700 dark:text-gray-300">{event.source}</p>
              </div>
            )}

            <div className="pt-4 border-t space-y-3">
              <AddToCalendarLink event={event} />
              
              {status === 'authenticated' && (
                <div className="relative">
                  <button
                    onClick={() => setShowDropdown(!showDropdown)}
                    disabled={isLoading}
                    className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg hover:bg-blue-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-h-[44px]"
                  >
                    <span>Subscribe</span>
                    <span className="text-sm">▼</span>
                  </button>
                  
                  {showDropdown && (
                    <>
                      <div 
                        className="fixed inset-0 z-[5]" 
                        onClick={() => setShowDropdown(false)}
                      />
                      <div className="absolute z-10 mt-2 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
                      <div className="py-1">
                        {isFollowing ? (
                          <button
                            onClick={handleUnfollow}
                            disabled={isLoading}
                            className="w-full text-left px-4 py-3 min-h-[44px] text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                          >
                            ✓ Unfollow this event
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setShowDropdown(false);
                              setShowFollowModal(true);
                            }}
                            disabled={isLoading}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                          >
                            + Add to My Media Calendar (custom)
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setShowDropdown(false);
                            setShowFullModal(true);
                          }}
                          disabled={isLoading}
                          className="w-full text-left px-4 py-3 min-h-[44px] text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
                        >
                          {fullSubscriptionActive ? '✓ ' : ''}Subscribe to Full Media Calendar
                        </button>
                      </div>
                    </div>
                    </>
                  )}
                </div>
              )}
              
              {status === 'unauthenticated' && (
                <button
                  onClick={() => router.push('/login?callbackUrl=' + encodeURIComponent(window.location.href))}
                  className="w-full bg-gray-600 text-white py-2 px-4 rounded-lg hover:bg-gray-700 transition font-semibold"
                >
                  Sign in to Subscribe
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <SubscribeModal
        isOpen={showFollowModal}
        onClose={() => setShowFollowModal(false)}
        onConfirm={handleFollow}
        title="Add to My Media Calendar"
        description="Subscribe to this event to receive updates in your personal calendar feed. Changes to the event will automatically sync to your calendar."
        feedToken={feedToken}
        subscriptionType="custom"
      />

      <SubscribeModal
        isOpen={showFullModal}
        onClose={() => setShowFullModal(false)}
        onConfirm={handleToggleFullSubscription}
        title="Subscribe to Full Media Calendar"
        description="Subscribe to receive all published events in your calendar feed. New events and updates will automatically sync to your calendar."
        feedToken={feedToken}
        subscriptionType="full"
      />
    </div>
  );
}
