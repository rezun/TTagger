const extensionNamespace = typeof browser !== 'undefined' ? browser : chrome;

function withCallback(fn, context, args = []) {
  let settled = false;
  return new Promise((resolve, reject) => {
    const wrappedArgs = [
      ...args,
      (result) => {
        if (settled) return;
        const err = (extensionNamespace.runtime && extensionNamespace.runtime.lastError) || null;
        if (err) {
          settled = true;
          reject(new Error(err.message || err));
          return;
        }
        settled = true;
        resolve(result);
      },
    ];

    let maybePromise;
    try {
      maybePromise = fn.apply(context, wrappedArgs);
    } catch (error) {
      settled = true;
      reject(error);
      return;
    }

    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise
        .then((value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          reject(error);
        });
    }
  });
}

export const extension = extensionNamespace;

export function storageGet(area, keys) {
  const target = extensionNamespace.storage[area];
  return withCallback(target.get, target, [keys]);
}

export function storageSet(area, items) {
  const target = extensionNamespace.storage[area];
  return withCallback(target.set, target, [items]);
}

export function storageRemove(area, keys) {
  const target = extensionNamespace.storage[area];
  return withCallback(target.remove, target, [keys]);
}

export function storageClear(area) {
  const target = extensionNamespace.storage[area];
  return withCallback(target.clear, target, []);
}

export function launchWebAuthFlow(details) {
  return withCallback(extensionNamespace.identity.launchWebAuthFlow, extensionNamespace.identity, [details]);
}

export function sendRuntimeMessage(message) {
  return withCallback(extensionNamespace.runtime.sendMessage, extensionNamespace.runtime, [message]);
}

export function getRedirectURL(path = '') {
  return extensionNamespace.identity.getRedirectURL(path);
}

export function addRuntimeListener(listener) {
  extensionNamespace.runtime.onMessage.addListener(listener);
}

export function removeRuntimeListener(listener) {
  extensionNamespace.runtime.onMessage.removeListener(listener);
}

export function addStorageListener(listener) {
  extensionNamespace.storage.onChanged.addListener(listener);
}

export function removeStorageListener(listener) {
  extensionNamespace.storage.onChanged.removeListener(listener);
}

export function getLastError() {
  return extensionNamespace.runtime.lastError;
}

export function getPlatformInfo() {
  return withCallback(extensionNamespace.runtime.getPlatformInfo, extensionNamespace.runtime, []);
}

export async function invoke(type, payload = {}) {
  const response = await sendRuntimeMessage({ type, ...payload });
  if (!response) throw new Error('No response from background');
  if (!response.ok) throw new Error(response.error || 'Unknown error');
  return response.data;
}

export function setBadgeBackgroundColor(details) {
  if (!extensionNamespace?.action?.setBadgeBackgroundColor) {
    return Promise.resolve();
  }
  return withCallback(
    extensionNamespace.action.setBadgeBackgroundColor,
    extensionNamespace.action,
    [details]
  );
}

export function setBadgeText(details) {
  if (!extensionNamespace?.action?.setBadgeText) {
    return Promise.resolve();
  }
  return withCallback(
    extensionNamespace.action.setBadgeText,
    extensionNamespace.action,
    [details]
  );
}
