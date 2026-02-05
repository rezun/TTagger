/**
 * Sorting utilities for tags
 */

/**
 * Compare two tags by their sort order, falling back to createdAt and then ID.
 * Used for internal tag state operations where createdAt is available.
 * @param {Object} a - First tag
 * @param {Object} b - Second tag
 * @returns {number} - Comparison result
 */
export function compareTagsByOrderWithCreatedAt(a, b) {
  const aOrder = Number(a?.sortOrder);
  const bOrder = Number(b?.sortOrder);
  const aHasOrder = Number.isFinite(aOrder);
  const bHasOrder = Number.isFinite(bOrder);

  if (aHasOrder && bHasOrder) {
    if (aOrder !== bOrder) return aOrder - bOrder;
  } else if (aHasOrder) {
    return -1;
  } else if (bHasOrder) {
    return 1;
  }

  const aCreated = a?.createdAt ? Date.parse(a.createdAt) : null;
  const bCreated = b?.createdAt ? Date.parse(b.createdAt) : null;
  const aHasCreated = aCreated != null && !isNaN(aCreated);
  const bHasCreated = bCreated != null && !isNaN(bCreated);

  if (aHasCreated && bHasCreated) {
    if (aCreated !== bCreated) return aCreated - bCreated;
  } else if (aHasCreated) {
    return -1;
  } else if (bHasCreated) {
    return 1;
  }

  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

/**
 * Compare two tags by their sort order, falling back to name and then ID.
 * Used for import operations where createdAt may not be available.
 * @param {Object} a - First tag
 * @param {Object} b - Second tag
 * @returns {number} - Comparison result (-1, 0, 1)
 */
export function compareTagsByOrder(a, b) {
  const aOrder = Number(a?.sortOrder);
  const bOrder = Number(b?.sortOrder);
  const aHas = Number.isFinite(aOrder);
  const bHas = Number.isFinite(bOrder);
  if (aHas && bHas && aOrder !== bOrder) {
    return aOrder - bOrder;
  }
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;
  const aName = a?.name || '';
  const bName = b?.name || '';
  const nameCompare = aName.localeCompare(bName);
  if (nameCompare !== 0) return nameCompare;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

/**
 * Sort a list of tags by their order (non-mutating)
 * @param {Array} list - List of tags to sort
 * @returns {Array} - Sorted copy of the list
 */
export function sortTagsByOrder(list) {
  return list.slice().sort(compareTagsByOrder);
}
