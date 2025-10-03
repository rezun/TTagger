import { getPreferences, getTagState } from '../storage/index.js';
import { normalizeTagState } from './tagState.js';
import { refreshFollowCache, getStoredFollowCache, CACHE_ITEMS_KEY } from './followCache.js';
import { getAuthStatus } from '../../background/oauth.js';

/**
 * Assemble the dashboard payload: auth, follows, tags, preferences, timestamps.
 * Attempts to refresh the follow cache and gracefully degrades to stale data.
 * @param {{forceRefresh?: boolean}} [options]
 * @returns {Promise<{auth: object|null, follows: Array<object>, fetchedAt: number|null, tagState: object, preferences: object}>}
 */
export async function getDashboardPayload({ forceRefresh = false } = {}) {
  const [rawTagState, preferences] = await Promise.all([
    getTagState(),
    getPreferences(),
  ]);

  let auth = await getAuthStatus();
  let cache = null;

  if (auth) {
    try {
      cache = await refreshFollowCache(forceRefresh);
      if (!cache) {
        cache = await getStoredFollowCache();
      }
    } catch (error) {
      console.error('Failed to refresh follow cache', error);
      cache = await getStoredFollowCache();
      auth = await getAuthStatus();
    }
  }

  return {
    auth,
    follows: cache ? cache[CACHE_ITEMS_KEY] || [] : [],
    fetchedAt: cache?.fetchedAt || null,
    tagState: normalizeTagState(rawTagState),
    preferences,
  };
}
