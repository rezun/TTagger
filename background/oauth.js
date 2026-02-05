import { launchWebAuthFlow, getRedirectURL } from '../src/util/extension.js';
import { getAuthState, setAuthState, clearAuthState } from '../src/storage/index.js';
import { fetchCurrentUser } from '../src/api/twitch.js';
import { TWITCH_CLIENT_ID, TWITCH_SCOPES } from '../src/config.js';

const TOKEN_EXPIRY_BUFFER_MS = 60 * 1000; // refresh 1 minute early

function generateStateToken() {
  const array = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < array.length; i += 1) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function isRecoverableSilentOAuthError(error) {
  if (!error) return false;
  const message = (error.message || String(error)).toLowerCase();
  return (
    message.includes('user denied') ||
    message.includes('user did not approve') ||
    message.includes('user cancelled') ||
    message.includes('user canceled') ||
    message.includes('window was closed') ||
    message.includes('interaction required') ||
    message.includes('message port closed')
  );
}

function isValidAuthState(state) {
  if (!state || !state.accessToken) return false;
  if (!state.expiresAt) return true;
  return state.expiresAt - TOKEN_EXPIRY_BUFFER_MS > Date.now();
}

function parseTokenFromRedirect(redirectUri) {
  if (!redirectUri.includes('#')) return null;
  const fragment = redirectUri.split('#')[1];
  const params = new URLSearchParams(fragment);
  const accessToken = params.get('access_token');
  const expiresIn = Number(params.get('expires_in') || '0');
  const scope = params.get('scope');
  const state = params.get('state');
  if (!accessToken) return null;
  return {
    accessToken,
    expiresIn,
    scope,
    state,
  };
}

export async function getAuthStatus() {
  const state = await getAuthState();
  return isValidAuthState(state) ? state : null;
}

export async function signOut() {
  await clearAuthState();
}

export async function startOAuthFlow({ interactive = true, forcePrompt = interactive } = {}) {
  if (!TWITCH_CLIENT_ID || TWITCH_CLIENT_ID.startsWith('REPLACE')) {
    throw new Error('Set TWITCH_CLIENT_ID in src/config.js before signing in.');
  }

  const redirectUri = getRedirectURL('oauth');
  const authUrl = new URL('https://id.twitch.tv/oauth2/authorize');
  const stateToken = generateStateToken();
  authUrl.searchParams.set('client_id', TWITCH_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('scope', TWITCH_SCOPES.join(' '));
  authUrl.searchParams.set('state', stateToken);
  if (forcePrompt) {
    authUrl.searchParams.set('force_verify', 'true');
  }

  const url = authUrl.toString();
  let redirectResponse;
  let accessToken;
  let user;

  try {
    // Wrap entire OAuth flow in try-catch to prevent partial state corruption
    try {
      redirectResponse = await launchWebAuthFlow({ url, interactive });
    } catch (error) {
      const message = (error && error.message) || String(error);
      if (/authorization page could not be loaded/i.test(message)) {
        throw new Error(
          `Twitch could not load the authorization page. Verify that ${redirectUri} is listed as an allowed redirect URL in your Twitch developer application.`,
        );
      }
      throw error;
    }

    const tokenResult = parseTokenFromRedirect(redirectResponse);

    if (!tokenResult) {
      throw new Error('Twitch did not return an access token.');
    }

    if (tokenResult.state && tokenResult.state !== stateToken) {
      throw new Error('OAuth state mismatch. Please try again.');
    }

    accessToken = tokenResult.accessToken;
    const { expiresIn, scope } = tokenResult;

    // Fetch user profile - if this fails, we haven't saved any state yet
    user = await fetchCurrentUser(accessToken);
    if (!user) {
      throw new Error('Unable to fetch Twitch user profile.');
    }

    // Validate user object has required fields to prevent corruption
    if (!user.id || !user.login) {
      throw new Error('Invalid user profile returned from Twitch (missing required fields).');
    }

    // Only save auth state if ALL steps succeeded
    const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : null;
    const state = {
      accessToken,
      expiresAt,
      scope,
      user: {
        id: user.id,
        login: user.login,
        displayName: user.display_name || user.login,
        profileImageUrl: user.profile_image_url || '',
      },
    };

    await setAuthState(state);
    return state;
  } catch (error) {
    // If anything fails during OAuth flow, clear any partial auth state to prevent corruption
    try {
      await clearAuthState();
    } catch (cleanupError) {
      console.error('Failed to clean up auth state after OAuth error:', cleanupError);
    }
    throw error;
  }
}

export async function ensureAuth({ interactive = false } = {}) {
  let existing = await getAuthState();
  if (isValidAuthState(existing)) {
    return existing;
  }

  // Try silent renewal first (non-interactive)
  try {
    const renewed = await startOAuthFlow({ interactive: false, forcePrompt: false });
    if (renewed) return renewed;
  } catch (error) {
    // If silent renewal fails with a recoverable error, continue to interactive flow
    // If it's a non-recoverable error, we've already cleaned up auth state in startOAuthFlow
    if (!isRecoverableSilentOAuthError(error)) {
      // Non-recoverable error - auth state already cleaned up, re-throw
      throw error;
    }
    // Recoverable error (user interaction needed) - continue to interactive flow below
  }

  if (!interactive) {
    throw new Error('Authentication required');
  }

  // If silent renewal failed or was skipped, try interactive flow
  return startOAuthFlow({ interactive: true, forcePrompt: true });
}
