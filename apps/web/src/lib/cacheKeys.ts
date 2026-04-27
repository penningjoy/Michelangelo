/**
 * Centralized cache-key builders. Keeping all keys in one file means the
 * research route's invalidation step can stay in lockstep with whatever
 * the read routes are storing under.
 */

export function sessionsListCacheKey(owner: string): string {
  return `sess:list:${owner}`;
}

export function conceptsListCacheKey(owner: string): string {
  return `concepts:list:${owner}`;
}

export function graphDataCacheKey(owner: string, sessionId: string | null): string {
  return `graph:${owner}:${sessionId ?? "home"}`;
}
