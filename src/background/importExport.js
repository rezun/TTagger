import { getTagState, setTagState } from '../storage/index.js';
import { normalizeTagState, resetTagStateToDefault, pickTagColor, STARRED_TAG_ID } from './tagState.js';
import { isValidTagName, sanitizeTagName, isValidHexColor } from '../util/validators.js';
import { sortTagsByOrder } from '../util/sorting.js';

function serializeTagForExport(tag) {
  const entry = { name: tag.name };
  if (tag.color) entry.color = tag.color;
  const order = Number(tag.sortOrder);
  if (Number.isFinite(order)) entry.sortOrder = order;
  return entry;
}

/**
 * Build a portable export payload from the current tag state.
 * Includes custom tags, assignments by name, and starred streamer ids.
 * @param {object} state
 * @returns {{tags:Array<object>, assignments:object, starred:Array<string>}}
 */
export function buildExportPayload(state) {
  const normalized = normalizeTagState(state);
  const tags = Object.values(normalized.tags).filter((tag) => tag.id !== STARRED_TAG_ID);

  const assignments = {};
  const starred = new Set();

  Object.entries(normalized.assignments || {}).forEach(([streamerId, tagIds]) => {
    if (!Array.isArray(tagIds)) return;

    const customTagNames = Array.from(
      new Set(
        tagIds
          .map((id) => normalized.tags[id])
          .filter((tag) => tag && tag.id !== STARRED_TAG_ID)
          .map((tag) => tag.name),
      ),
    );

    if (customTagNames.length) {
      assignments[streamerId] = customTagNames;
    }

    if (tagIds.includes(STARRED_TAG_ID)) {
      starred.add(streamerId);
    }
  });

  return {
    tags: tags.map(serializeTagForExport),
    assignments,
    starred: Array.from(starred),
  };
}

/**
 * Produce the export payload expected by the options page download flow.
 * @returns {Promise<{tags:Array<object>, assignments:object, starred:Array<string>}>}
 */
export async function handleExport() {
  const state = await getTagState();
  return buildExportPayload(state);
}

function normalizeImportedTags(rawTags = []) {
  if (!Array.isArray(rawTags)) return [];
  return rawTags
    .map((tag) => {
      if (!tag || typeof tag !== 'object') return null;
      const rawName = typeof tag.name === 'string' ? tag.name.trim() : '';
      if (!rawName) return null;

      // Sanitize tag name to remove any HTML and enforce length limits
      const name = sanitizeTagName(rawName);
      if (!name || !isValidTagName(name)) return null;

      const entry = { name };

      // Validate and normalize color
      if (typeof tag.color === 'string' && tag.color.trim()) {
        const color = tag.color.trim();
        if (isValidHexColor(color)) {
          entry.color = color.startsWith('#') ? color : `#${color}`;
        }
      }

      if (typeof tag.createdAt === 'string') entry.createdAt = tag.createdAt;
      if (typeof tag.updatedAt === 'string') entry.updatedAt = tag.updatedAt;
      const rawOrder = Number(tag.sortOrder);
      if (Number.isFinite(rawOrder)) entry.sortOrder = rawOrder;
      return entry;
    })
    .filter(Boolean);
}

function normalizeImportedAssignments(rawAssignments = {}) {
  if (!rawAssignments || typeof rawAssignments !== 'object') return {};
  return Object.entries(rawAssignments).reduce((acc, [streamerId, tagNames]) => {
    if (!streamerId || !Array.isArray(tagNames)) return acc;
    const filtered = Array.from(
      new Set(
        tagNames
          .filter((name) => typeof name === 'string')
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    );
    if (filtered.length) {
      acc[streamerId] = filtered;
    }
    return acc;
  }, {});
}

function normalizeImportedStarred(rawStarred = []) {
  if (!Array.isArray(rawStarred)) return [];
  return Array.from(
    new Set(
      rawStarred
        .filter((id) => typeof id === 'string' || typeof id === 'number')
        .map((id) => String(id).trim())
        .filter(Boolean),
    ),
  );
}


/**
 * Validate import payload structure before processing
 * @param {unknown} payload
 * @throws {Error} If validation fails
 */
function validateImportPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid import payload: must be an object.');
  }

  // Validate tags array
  if (payload.tags !== undefined && !Array.isArray(payload.tags)) {
    throw new Error('Invalid import payload: tags must be an array.');
  }

  if (Array.isArray(payload.tags) && payload.tags.length > 1000) {
    throw new Error('Invalid import payload: too many tags (maximum 1000).');
  }

  // Validate assignments object
  if (payload.assignments !== undefined && (typeof payload.assignments !== 'object' || Array.isArray(payload.assignments))) {
    throw new Error('Invalid import payload: assignments must be an object.');
  }

  if (payload.assignments && Object.keys(payload.assignments).length > 10000) {
    throw new Error('Invalid import payload: too many assignments (maximum 10000).');
  }

  // Validate starred array
  if (payload.starred !== undefined && !Array.isArray(payload.starred)) {
    throw new Error('Invalid import payload: starred must be an array.');
  }

  if (Array.isArray(payload.starred) && payload.starred.length > 10000) {
    throw new Error('Invalid import payload: too many starred streamers (maximum 10000).');
  }

  // Validate each tag has required fields and valid values
  if (Array.isArray(payload.tags)) {
    for (let i = 0; i < payload.tags.length; i++) {
      const tag = payload.tags[i];
      if (!tag || typeof tag !== 'object') {
        throw new Error(`Invalid import payload: tag at index ${i} must be an object.`);
      }

      if (!tag.name || typeof tag.name !== 'string') {
        throw new Error(`Invalid import payload: tag at index ${i} missing required field 'name'.`);
      }

      if (!isValidTagName(tag.name)) {
        throw new Error(`Invalid import payload: tag at index ${i} has invalid name (must be 1-50 chars, no HTML tags).`);
      }

      if (tag.color && !isValidHexColor(tag.color)) {
        throw new Error(`Invalid import payload: tag at index ${i} has invalid color (must be valid hex color).`);
      }
    }
  }
}

/**
 * Replace the stored tag state using an imported payload from disk.
 * Always resets to the default starred tag before applying the import.
 * @param {unknown} payload
 * @returns {Promise<{tagState: object}>}
 */
export async function handleImport(payload) {
  // Validate payload structure before processing
  validateImportPayload(payload);

  const rawTags = normalizeImportedTags(payload.tags);
  const tags = sortTagsByOrder(rawTags);
  const assignments = normalizeImportedAssignments(payload.assignments);
  const starred = normalizeImportedStarred(payload.starred);

  const state = await resetTagStateToDefault();
  const working = { ...state, tags: { ...state.tags }, assignments: {} };

  const nameToId = {};
  tags.forEach((tag, index) => {
    const lower = tag.name.toLowerCase();
    if (
      lower === '⭐ starred' ||
      lower === 'favorite' ||
      lower === 'starred' ||
      nameToId[lower]
    ) {
      return;
    }

    const newId = String(working.nextId++);
    const entry = {
      id: newId,
      name: tag.name,
      color: tag.color || pickTagColor(newId),
      createdAt: tag.createdAt || new Date().toISOString(),
      sortOrder: index + 1,
    };
    if (tag.updatedAt) {
      entry.updatedAt = tag.updatedAt;
    }
    working.tags[newId] = entry;
    nameToId[lower] = newId;
  });

  Object.entries(assignments).forEach(([streamerId, tagNames]) => {
    const resolved = tagNames
      .map((name) => nameToId[name.toLowerCase()])
      .filter(Boolean);
    if (resolved.length) {
      working.assignments[streamerId] = Array.from(new Set(resolved));
    }
  });

  starred.forEach((streamerId) => {
    const list = working.assignments[streamerId] ? [...working.assignments[streamerId]] : [];
    if (!list.includes(STARRED_TAG_ID)) {
      list.push(STARRED_TAG_ID);
    }
    working.assignments[streamerId] = list;
  });

  const normalized = normalizeTagState(working);
  await setTagState(normalized);

  return { tagState: normalized };
}
