import { extension } from './extension.js';

const DEFAULT_ICON_URL = extension.runtime.getURL('assets/icons/icon48.png');
const USE_PROMISE_API = typeof browser !== 'undefined';

const clickHandlers = new Map();
let clickListenerAttached = false;
let closeListenerAttached = false;

function ensureClickListener() {
  if (clickListenerAttached) return;
  extension.notifications.onClicked.addListener((id) => {
    const handler = clickHandlers.get(id);
    if (!handler) return;
    clickHandlers.delete(id);
    try {
      handler();
    } catch (error) {
      console.error('Notification click handler failed', error);
    }
    clearNotification(id).catch((err) => {
      console.warn('Failed to clear clicked notification', err);
    });
  });
  clickListenerAttached = true;
}

function ensureCloseListener() {
  if (closeListenerAttached) return;
  extension.notifications.onClosed.addListener((id) => {
    clickHandlers.delete(id);
  });
  closeListenerAttached = true;
}

async function createNotificationInternal(options) {
  if (USE_PROMISE_API) {
    return extension.notifications.create(options);
  }

  return new Promise((resolve, reject) => {
    try {
      extension.notifications.create(options, (notificationId) => {
        const error = extension.runtime?.lastError;
        if (error) {
          reject(new Error(error.message || error));
          return;
        }
        resolve(notificationId);
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function clearNotificationInternal(notificationId) {
  if (USE_PROMISE_API) {
    return extension.notifications.clear(notificationId);
  }

  return new Promise((resolve, reject) => {
    try {
      extension.notifications.clear(notificationId, (cleared) => {
        const error = extension.runtime?.lastError;
        if (error) {
          reject(new Error(error.message || error));
          return;
        }
        resolve(cleared);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export async function createNotification(options) {
  const { title, message, iconUrl, onClick } = options;

  ensureClickListener();
  ensureCloseListener();

  const notificationOptions = {
    type: 'basic',
    iconUrl: iconUrl || DEFAULT_ICON_URL,
    title,
    message,
  };

  const notificationId = await createNotificationInternal(notificationOptions);

  if (onClick) {
    clickHandlers.set(notificationId, onClick);
  }

  return notificationId;
}

export function clearNotification(notificationId) {
  clickHandlers.delete(notificationId);
  return clearNotificationInternal(notificationId);
}

export async function createLiveNotification(streamerName, streamUrl, avatarUrl) {
  return createNotification({
    title: `${streamerName} is now live!`,
    message: `Click to watch their stream`,
    iconUrl: avatarUrl || DEFAULT_ICON_URL,
    onClick: () => {
      const maybePromise = extension.tabs.create({ url: streamUrl });
      if (maybePromise && typeof maybePromise.catch === 'function') {
        maybePromise.catch((error) => {
          console.warn('Failed to open streamer tab from notification', error);
        });
      }
    },
  });
}
