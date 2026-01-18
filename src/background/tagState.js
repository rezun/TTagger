import { getTagState, setTagState } from '../storage/index.js';
import { normalizeTagColor } from '../util/formatters.js';
import { TAG_COLOR_POOL } from '../config.js';
import { sanitizeTagName, isValidTagName } from '../util/validators.js';
import { compareTagsByOrderWithCreatedAt } from '../util/sorting.js';

const STARRED_TAG_ID = 'favorite';
const STARRED_TAG_NAME = '⭐ Starred';
const STARRED_TAG_NAME_LOWER = STARRED_TAG_NAME.toLowerCase();

// Concurrency control for tag state mutations
const MAX_QUEUE_SIZE = 50;
let isOperationInProgress = false;
let operationQueue = [];

/**
 * Execute an operation with concurrency control to prevent race conditions.
 * Operations are queued and executed serially.
 * @param {Function} operation - Async function to execute
 * @returns {Promise} - Resolves/rejects with operation result
 */
async function withConcurrencyControl(operation) {
  return new Promise((resolve, reject) => {
    // Check queue size limit to prevent memory issues
    if (operationQueue.length >= MAX_QUEUE_SIZE) {
      reject(new Error('Too many pending tag operations. Please wait and try again.'));
      return;
    }

    // Queue the operation
    operationQueue.push({ operation, resolve, reject });

    // Process queue if no operation is currently running
    processQueue();
  });
}

/**
 * Process the next operation in the queue.
 * Called when an operation completes or when a new operation is queued.
 */
async function processQueue() {
  // If an operation is already running, or queue is empty, do nothing
  if (isOperationInProgress || operationQueue.length === 0) {
    return;
  }

  // Mark that an operation is in progress
  isOperationInProgress = true;

  // Get next operation from queue
  const { operation, resolve, reject } = operationQueue.shift();

  try {
    // Execute the operation
    const result = await operation();
    resolve(result);
  } catch (error) {
    reject(error);
  } finally {
    // Mark operation as complete
    isOperationInProgress = false;

    // Process next operation in queue
    processQueue();
  }
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function ensureSortOrder(state) {
  const tags = Object.values(state.tags || {});
  const sortable = tags.filter((tag) => tag && String(tag.id) !== STARRED_TAG_ID);

  sortable.sort(compareTagsByOrderWithCreatedAt);

  sortable.forEach((tag, index) => {
    tag.sortOrder = index + 1;
  });

  const favorite = state.tags[STARRED_TAG_ID];
  if (favorite) {
    favorite.sortOrder = 0;
  }
}

function getNextSortOrder(state) {
  const tags = Object.values(state.tags || {});
  const max = tags.reduce((acc, tag) => {
    if (!tag || String(tag.id) === STARRED_TAG_ID) return acc;
    const order = toNumber(tag.sortOrder);
    return order != null && order > acc ? order : acc;
  }, 0);
  return max + 1;
}

function ensureNextId(state) {
  const numericIds = Object.keys(state.tags || {})
    .map((id) => Number(id))
    .filter((num) => Number.isFinite(num));
  const maxId = numericIds.length ? Math.max(...numericIds) : 0;
  const next = Number(state.nextId) || 0;
  state.nextId = next > maxId ? next : maxId + 1;
}

function addOrNormalizeStarredTag(state) {
  const favorite = state.tags[STARRED_TAG_ID];
  if (!favorite) {
    state.tags[STARRED_TAG_ID] = {
      id: STARRED_TAG_ID,
      name: STARRED_TAG_NAME,
      color: '#ffc107',
      createdAt: new Date().toISOString(),
      locked: true,
      sortOrder: 0,
    };
    return;
  }

  favorite.id = STARRED_TAG_ID;
  favorite.name = STARRED_TAG_NAME;
  favorite.color = favorite.color || '#ffc107';
  favorite.locked = true;
  favorite.createdAt = favorite.createdAt || new Date().toISOString();
  favorite.sortOrder = 0;
}

/**
 * Remove assignments for tags that no longer exist to prevent crashes from corrupted storage.
 * @param {object} state - Normalized tag state
 */
function cleanOrphanedAssignments(state) {
  const validTagIds = new Set(Object.keys(state.tags || {}));

  Object.keys(state.assignments || {}).forEach((streamerId) => {
    const tagIds = state.assignments[streamerId];
    if (!Array.isArray(tagIds)) {
      delete state.assignments[streamerId];
      return;
    }

    const validTags = tagIds.filter((tagId) => validTagIds.has(String(tagId)));
    if (validTags.length > 0) {
      state.assignments[streamerId] = validTags;
    } else {
      delete state.assignments[streamerId];
    }
  });
}

/**
 * Ensure the stored tag state has required defaults and valid metadata.
 * Adds the locked favorite tag and normalises the nextId counter.
 * @param {unknown} state
 * @returns {{tags: object, assignments: object, nextId: number}}
 */
export function normalizeTagState(state) {
  if (!state || typeof state !== 'object') {
    return { tags: {}, assignments: {}, nextId: 1 };
  }

  const normalized = {
    tags: { ...(state.tags || {}) },
    assignments: { ...(state.assignments || {}) },
    nextId: Number(state.nextId) || 1,
  };

  addOrNormalizeStarredTag(normalized);
  ensureNextId(normalized);
  ensureSortOrder(normalized);
  cleanOrphanedAssignments(normalized);

  return normalized;
}

/**
 * Choose a deterministic color for a tag based on its id.
 * Falls back to a default if the color pool is exhausted.
 * @param {string|number} tagId
 * @returns {string}
 */
export function pickTagColor(tagId) {
  const numeric = Number(tagId) || 0;
  if (!TAG_COLOR_POOL.length) return '#6f42c1';
  return TAG_COLOR_POOL[(numeric - 1) % TAG_COLOR_POOL.length];
}

function assertNotStarredTag(tagId) {
  if (String(tagId) === STARRED_TAG_ID) {
    throw new Error('Favorite tag cannot be modified.');
  }
}

/**
 * Create or update a tag entry, validating names and colors.
 * @param {object} [fields]
 * @param {string|number} [tagId]
 * @returns {Promise<{tags: object, assignments: object, nextId: number}>}
 */
export async function upsertTag(fields = {}, tagId) {
  return withConcurrencyControl(async () => {
    const state = normalizeTagState(await getTagState());
    const targetId = tagId ? String(tagId) : null;
    const now = new Date().toISOString();
    const nameProvided = Object.prototype.hasOwnProperty.call(fields, 'name');
    const colorProvided = Object.prototype.hasOwnProperty.call(fields, 'color');

    // Sanitize tag name to remove HTML and enforce length limits
    const trimmedName = nameProvided && typeof fields.name === 'string' ? sanitizeTagName(fields.name) : '';
    const normalizedColor = colorProvided ? normalizeTagColor(fields.color, { strict: true }) : null;

    // Validate sanitized name
    if (nameProvided && trimmedName && !isValidTagName(trimmedName)) {
      throw new Error('Tag name contains invalid characters or is too long.');
    }

    if (targetId) {
      assertNotStarredTag(targetId);
      const existing = state.tags[targetId];
      if (!existing) {
        throw new Error('Tag not found.');
      }

      let nextName = existing.name;
      if (nameProvided) {
        if (!trimmedName) {
          throw new Error('Tag name cannot be empty.');
        }
        const normalizedName = trimmedName.toLowerCase();
        if (
          normalizedName === STARRED_TAG_NAME_LOWER ||
          normalizedName === 'favorite' ||
          normalizedName === 'starred'
        ) {
          throw new Error('Starred tag already exists.');
        }

        const duplicate = Object.values(state.tags).find(
          (tag) => tag.id !== targetId && tag.name.toLowerCase() === normalizedName,
        );
        if (duplicate) {
          throw new Error('A tag with that name already exists.');
        }
        nextName = trimmedName;
      }

      const nextColor = colorProvided ? normalizedColor || existing.color : existing.color;
      state.tags[targetId] = {
        ...existing,
        name: nextName,
        color: nextColor,
        updatedAt: now,
      };
    } else {
      if (!nameProvided || !trimmedName) {
        throw new Error('Tag name cannot be empty.');
      }

      const normalizedName = trimmedName.toLowerCase();
      if (
        normalizedName === STARRED_TAG_NAME_LOWER ||
        normalizedName === 'favorite' ||
        normalizedName === 'starred'
      ) {
        throw new Error('Starred tag already exists.');
      }

      const duplicate = Object.values(state.tags).find(
        (tag) => tag.name.toLowerCase() === normalizedName,
      );
      if (duplicate) {
        throw new Error('A tag with that name already exists.');
      }

      const newId = String(state.nextId++);
      const color = colorProvided ? normalizedColor || pickTagColor(newId) : pickTagColor(newId);
      state.tags[newId] = {
        id: newId,
        name: trimmedName,
        color,
        createdAt: now,
        sortOrder: getNextSortOrder(state),
      };
    }

    await setTagState(state);
    return state;
  });
}

/**
 * Delete a tag and remove its assignments from all streamers.
 * @param {string|number} tagId
 * @returns {Promise<{tags: object, assignments: object, nextId: number}>}
 */
export async function removeTag(tagId) {
  return withConcurrencyControl(async () => {
    const state = normalizeTagState(await getTagState());
    const targetId = String(tagId);
    assertNotStarredTag(targetId);
    if (!state.tags[targetId]) {
      return state;
    }

    delete state.tags[targetId];

    Object.keys(state.assignments).forEach((streamerId) => {
      const filtered = (state.assignments[streamerId] || []).filter((id) => id !== targetId);
      if (filtered.length) {
        state.assignments[streamerId] = filtered;
      } else {
        delete state.assignments[streamerId];
      }
    });

    await setTagState(state);
    return state;
  });
}

/**
 * Toggle a single tag assignment for a streamer.
 * @param {string} streamerId
 * @param {string|number} tagId
 * @param {boolean} shouldAssign
 * @returns {Promise<{tags: object, assignments: object, nextId: number}>}
 */
export async function updateAssignment(streamerId, tagId, shouldAssign) {
  return withConcurrencyControl(async () => {
    const state = normalizeTagState(await getTagState());
    const targetId = String(tagId);
    if (!state.tags[targetId]) {
      throw new Error('Tag not found.');
    }

    const current = state.assignments[streamerId] || [];

    if (shouldAssign) {
      if (!current.includes(targetId)) {
        state.assignments[streamerId] = [...current, targetId];
      }
    } else {
      const filtered = current.filter((id) => id !== targetId);
      if (filtered.length) {
        state.assignments[streamerId] = filtered;
      } else {
        delete state.assignments[streamerId];
      }
    }

    await setTagState(state);
    return state;
  });
}

/**
 * Replace all tag assignments for a streamer with the provided list.
 * Invalid tag ids are filtered out.
 * @param {string} streamerId
 * @param {Array<string|number>} tagIds
 * @returns {Promise<{tags: object, assignments: object, nextId: number}>}
 */
export async function replaceAssignments(streamerId, tagIds) {
  return withConcurrencyControl(async () => {
    const state = normalizeTagState(await getTagState());
    const valid = (tagIds || []).map(String).filter((id) => state.tags[id]);
    if (valid.length) {
      state.assignments[streamerId] = valid;
    } else {
      delete state.assignments[streamerId];
    }

    await setTagState(state);
    return state;
  });
}

/**
 * Update sort order of custom tags based on the provided sequence.
 * Any tags not listed retain relative order at the end.
 * @param {Array<string|number>} tagIds
 * @returns {Promise<{tags: object, assignments: object, nextId: number}>}
 */
export async function reorderTags(tagIds = []) {
  return withConcurrencyControl(async () => {
    const state = normalizeTagState(await getTagState());
    const desired = Array.isArray(tagIds) ? tagIds.map(String) : [];
    const seen = new Set();
    let position = 1;

    desired.forEach((id) => {
      const key = String(id);
      if (key === STARRED_TAG_ID || seen.has(key)) return;
      const tag = state.tags[key];
      if (!tag) return;
      tag.sortOrder = position++;
      seen.add(key);
    });

    const remaining = Object.values(state.tags)
      .filter((tag) => tag && String(tag.id) !== STARRED_TAG_ID && !seen.has(String(tag.id)))
      .sort(compareTagsByOrderWithCreatedAt);

    remaining.forEach((tag) => {
      tag.sortOrder = position++;
    });

    const favorite = state.tags[STARRED_TAG_ID];
    if (favorite) {
      favorite.sortOrder = 0;
    }

    await setTagState(state);
    return state;
  });
}

/**
 * Reset storage to only contain the built-in favorite tag and no assignments.
 * @returns {Promise<{tags: object, assignments: object, nextId: number}>}
 */
export async function resetTagStateToDefault() {
  return withConcurrencyControl(async () => {
    const favorite = {
      id: STARRED_TAG_ID,
      name: STARRED_TAG_NAME,
      color: '#ffc107',
      createdAt: new Date().toISOString(),
      locked: true,
      sortOrder: 0,
    };

    const fresh = {
      tags: { [STARRED_TAG_ID]: favorite },
      assignments: {},
      nextId: 1,
    };

    await setTagState(fresh);
    return normalizeTagState(fresh);
  });
}

export { STARRED_TAG_ID };
