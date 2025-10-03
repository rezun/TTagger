const LANGUAGE_SYSTEM = 'system';
const SUPPORTED_OVERRIDE_LOCALES = ['en', 'de'];
const overrideCache = new Map();
const i18n = (typeof browser !== 'undefined' && browser.i18n) ||
  (typeof chrome !== 'undefined' && chrome.i18n) ||
  null;
const runtime = (typeof browser !== 'undefined' && browser.runtime) ||
  (typeof chrome !== 'undefined' && chrome.runtime) ||
  null;

let overrideLocale = null;
let overrideMessages = null;

function isPromise(value) {
  return value && typeof value.then === 'function';
}

function normalizeSubstitutions(substitutions) {
  if (substitutions == null) {
    return [];
  }
  return Array.isArray(substitutions) ? substitutions : [substitutions];
}

function getPlaceholderIndex(content = '') {
  const match = /\$(\d+)/.exec(content);
  if (!match) return null;
  return Number.parseInt(match[1], 10) - 1;
}

function formatOverrideMessage(entry, substitutions) {
  if (!entry) return '';
  let message = entry.message ?? '';
  if (!substitutions.length) {
    return message;
  }

  if (entry.placeholders && typeof entry.placeholders === 'object') {
    const upperToIndex = {};
    for (const [name, meta] of Object.entries(entry.placeholders)) {
      const placeholderIndex = getPlaceholderIndex(meta?.content);
      if (placeholderIndex != null) {
        upperToIndex[name.toUpperCase()] = placeholderIndex;
      }
    }
    message = message.replace(/\$([A-Z0-9_]+)\$/g, (match, token) => {
      const index = upperToIndex[token];
      if (index == null || index >= substitutions.length) {
        return match;
      }
      return substitutions[index];
    });
  } else {
    message = message.replace(/\$(\d+)/g, (match, token) => {
      const index = Number.parseInt(token, 10) - 1;
      if (Number.isNaN(index) || index < 0 || index >= substitutions.length) {
        return match;
      }
      return substitutions[index];
    });
  }

  return message;
}

async function loadLocaleMessages(locale) {
  if (!runtime) {
    throw new Error('Runtime unavailable for locale loading.');
  }
  const cached = overrideCache.get(locale);
  if (cached) {
    if (isPromise(cached)) {
      return cached;
    }
    return Promise.resolve(cached);
  }

  const url = runtime.getURL(`_locales/${locale}/messages.json`);
  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch locale file: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      overrideCache.set(locale, data);
      return data;
    })
    .catch((error) => {
      overrideCache.delete(locale);
      throw error;
    });
  overrideCache.set(locale, promise);
  return promise;
}

function getOverrideEntry(key) {
  if (!overrideMessages || !key) return null;
  return overrideMessages[key] || null;
}

/**
 * Fetch a localized message by key with optional substitutions.
 * Prefers the user override locale when present and falls back to the browser API.
 * @param {string} key
 * @param {string|string[]} [substitutions]
 * @returns {string}
 */
export function getMessage(key, substitutions) {
  if (!key) return '';

  const normalizedSubs = normalizeSubstitutions(substitutions);
  const overrideEntry = getOverrideEntry(key);
  if (overrideEntry) {
    return formatOverrideMessage(overrideEntry, normalizedSubs);
  }

  if (!i18n || typeof i18n.getMessage !== 'function') {
    return normalizedSubs.length ? `${key} ${normalizedSubs.join(' ')}` : key;
  }
  return i18n.getMessage(key, normalizedSubs);
}

/**
 * Fetch a localized message and fall back to the provided default when missing.
 * @param {string} key
 * @param {string} fallback
 * @param {string|string[]} [substitutions]
 * @returns {string}
 */
/**
 * Replace text content and attributes for nodes annotated with data-i18n attributes.
 * Use data-i18n="message_key" for textContent and
 * data-i18n-attrs="attr:message_key,attr2:message_key2" for attributes.
 * @param {ParentNode} [root=document]
 */
export function localize(root = document) {
  if (!root) return;
  const elements = root.querySelectorAll('[data-i18n], [data-i18n-attrs]');
  elements.forEach((element) => {
    const textKey = element.dataset.i18n;
    if (textKey) {
      element.textContent = getMessage(textKey);
    }

    const attrList = element.dataset.i18nAttrs;
    if (attrList) {
      attrList.split(',').forEach((pair) => {
        const [attr, key] = pair.split(':').map((part) => part && part.trim());
        if (!attr || !key) return;
        element.setAttribute(attr, getMessage(key));
      });
    }
  });
}

/**
 * Override the current locale used for translations.
 * Passing `system` or a falsy value clears the override.
 * @param {string} locale
 * @returns {Promise<string|null>} Resolves with the active override locale or null.
 */
export async function setLanguageOverride(locale) {
  if (!locale || locale === LANGUAGE_SYSTEM) {
    overrideLocale = null;
    overrideMessages = null;
    return overrideLocale;
  }
  if (!SUPPORTED_OVERRIDE_LOCALES.includes(locale)) {
    console.warn('[i18n] Unsupported locale override:', locale);
    overrideLocale = null;
    overrideMessages = null;
    return overrideLocale;
  }

  try {
    overrideMessages = await loadLocaleMessages(locale);
    overrideLocale = locale;
  } catch (error) {
    console.error('[i18n] Failed to load locale override:', locale, error);
    overrideLocale = null;
    overrideMessages = null;
  }
  return overrideLocale;
}

/**
 * Return the currently active override locale (if any).
 * @returns {string|null}
 */
export function getLanguageOverride() {
  return overrideLocale;
}

/**
 * Return the list of locales that support overrides.
 * @returns {string[]}
 */
export function getSupportedOverrideLocales() {
  return [...SUPPORTED_OVERRIDE_LOCALES];
}

/**
 * Fetch a localized message or fall back to the message key when missing.
 * @param {string} key
 * @param {string|string[]} [substitutions]
 * @returns {string}
 */
export function getMessageStrict(key, substitutions) {
  const message = getMessage(key, substitutions);
  if (message == null || message === '') {
    return key ?? '';
  }
  return message;
}
