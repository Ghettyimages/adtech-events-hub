/**
 * Edge cache policy for read-only API routes.
 * Only cache anonymous public calendar reads; admin and pending must stay fresh.
 */
export function publicListCacheHeaders(): HeadersInit {
  return {
    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
  };
}

export function noStoreCacheHeaders(): HeadersInit {
  return {
    'Cache-Control': 'private, no-store, must-revalidate',
  };
}

export function eventsListCacheHeaders(options: {
  status: string | null;
  isAdmin: boolean;
}): HeadersInit {
  const status = options.status || 'PUBLISHED';
  const shouldEdgeCache = status === 'PUBLISHED' && !options.isAdmin;
  return shouldEdgeCache ? publicListCacheHeaders() : noStoreCacheHeaders();
}
