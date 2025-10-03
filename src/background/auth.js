import { sendRuntimeMessage } from '../util/extension.js';
import { getAuthStatus } from '../../background/oauth.js';

/**
 * Notify all extension surfaces about the current authentication status.
 * Swallows "port closed" errors since those just mean no listeners are awake.
 * @returns {Promise<void>}
 */
export async function broadcastAuthStatus() {
  const auth = await getAuthStatus();
  try {
    await sendRuntimeMessage({ type: 'oauth:status', signedIn: !!auth, user: auth?.user || null });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (
      /message port closed before a response/i.test(message) ||
      /receiving end does not exist/i.test(message)
    ) {
      console.debug('No active listeners for oauth:status broadcast; continuing.');
      return;
    }
    throw error;
  }
}
