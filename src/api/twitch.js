import { TWITCH_CLIENT_ID } from '../config.js';

const API_BASE = 'https://api.twitch.tv/helix';

function buildHeaders(token) {
  if (!TWITCH_CLIENT_ID || TWITCH_CLIENT_ID.startsWith('REPLACE')) {
    throw new Error('Twitch client ID is not configured. Update src/config.js.');
  }

  return {
    'Client-Id': TWITCH_CLIENT_ID,
    Authorization: `Bearer ${token}`,
  };
}

function parseRateLimit(headers) {
  const limit = headers.get('Ratelimit-Limit');
  const remaining = headers.get('Ratelimit-Remaining');
  const reset = headers.get('Ratelimit-Reset');
  return {
    limit: limit ? Number(limit) : null,
    remaining: remaining ? Number(remaining) : null,
    reset: reset ? Number(reset) : null,
  };
}

async function twitchFetch(path, token, { method = 'GET', searchParams, body } = {}) {
  const url = new URL(path.startsWith('http') ? path : `${API_BASE}${path}`);

  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      if (Array.isArray(value)) {
        value.forEach((item) => url.searchParams.append(key, item));
      } else {
        url.searchParams.set(key, value);
      }
    });
  }

  const response = await fetch(url.toString(), {
    method,
    headers: buildHeaders(token),
    body,
  });

  const rate = parseRateLimit(response.headers);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.message || `Twitch API error (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.rate = rate;
    throw error;
  }

  return { data: payload.data || [], pagination: payload.pagination || {}, rate };
}

export async function fetchCurrentUser(token) {
  const { data } = await twitchFetch('/users', token);
  return data[0] || null;
}

export async function fetchFollowedChannels(token, userId, after) {
  const params = { user_id: userId, first: 100 };
  if (after) params.after = after;
  return twitchFetch('/channels/followed', token, { searchParams: params });
}

export async function fetchUsersByIds(token, ids) {
  const batches = [];
  for (let i = 0; i < ids.length; i += 100) {
    batches.push(ids.slice(i, i + 100));
  }
  const results = [];
  for (const batch of batches) {
    const { data } = await twitchFetch('/users', token, { searchParams: { id: batch } });
    results.push(...data);
  }
  return results;
}

export async function fetchUsersByLogins(token, logins) {
  const batches = [];
  for (let i = 0; i < logins.length; i += 100) {
    batches.push(logins.slice(i, i + 100));
  }
  const results = [];
  for (const batch of batches) {
    const { data } = await twitchFetch('/users', token, { searchParams: { login: batch } });
    results.push(...data);
  }
  return results;
}

export async function fetchStreamsByUserIds(token, ids) {
  const batches = [];
  for (let i = 0; i < ids.length; i += 100) {
    batches.push(ids.slice(i, i + 100));
  }
  const results = [];
  for (const batch of batches) {
    const { data } = await twitchFetch('/streams', token, { searchParams: { user_id: batch } });
    results.push(...data);
  }
  return results;
}
