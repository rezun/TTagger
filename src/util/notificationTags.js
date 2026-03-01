import { TAG_STARRED } from './constants.js';

export const DEFAULT_NOTIFICATION_TAG_IDS = Object.freeze([TAG_STARRED]);

function toUniqueStringIds(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set();
  const ids = [];
  values.forEach((value) => {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

export function normalizeNotificationTagIds(rawIds, validTagIds = null) {
  const ids = toUniqueStringIds(rawIds);
  const validSet = validTagIds ? new Set(toUniqueStringIds(validTagIds)) : null;
  const filtered = validSet ? ids.filter((id) => validSet.has(id)) : ids;
  if (filtered.length > 0) {
    return filtered;
  }
  if (!validSet || validSet.has(TAG_STARRED)) {
    return [...DEFAULT_NOTIFICATION_TAG_IDS];
  }
  return validSet.size ? [validSet.values().next().value] : [];
}

export function getEffectiveNotificationTagIds(preferences = {}, tagState = null) {
  const validTagIds = tagState && tagState.tags
    ? Object.keys(tagState.tags)
    : null;
  return normalizeNotificationTagIds(preferences.notificationTagIds, validTagIds);
}
