import { getApiBaseUrl } from '../utils/url';

/**
 * One shared fetch of the public site settings.
 *
 * Ten separate components each asked for this file on their own, straight from
 * a useEffect with no shared cache. Seven of them mount on a gallery page, and
 * because each waited for its own component to mount the requests went out one
 * after another rather than together: seven round trips for the same 2KB,
 * spread over ~460ms on a fast connection and far worse on mobile data.
 *
 * Callers now share a single in-flight promise, so concurrent callers get the
 * same request, and the result is reused for a short window afterwards. The
 * window is deliberately short: these settings are edited from the admin, and
 * a stale copy should not outlive a visit by long.
 */
const CACHE_TTL_MS = 30000;

let inFlight: Promise<any> | null = null;
let cached: { value: any; at: number } | null = null;

export const getPublicSettings = (options?: { force?: boolean }): Promise<any> => {
  if (options?.force) {
    inFlight = null;
    cached = null;
  }

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return Promise.resolve(cached.value);
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = fetch(`${getApiBaseUrl()}/public/settings`, { credentials: 'include' })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load public settings: ${response.status}`);
      }
      return response.json();
    })
    .then((value) => {
      cached = { value, at: Date.now() };
      return value;
    })
    .catch((error) => {
      // Leave nothing cached, so the next caller retries rather than
      // inheriting a failure for the rest of the visit.
      cached = null;
      throw error;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
};
