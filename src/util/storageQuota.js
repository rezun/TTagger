import { extension } from './extension.js';

const QUOTA_WARNING_THRESHOLD = 0.8; // 80%
const QUOTA_BLOCK_THRESHOLD = 0.95; // 95%

/**
 * Get current storage usage information for sync storage
 * @returns {Promise<{bytesInUse: number, quotaBytes: number, percentUsed: number}>}
 */
export async function getStorageUsage() {
  try {
    if (!extension?.storage?.sync) {
      return { bytesInUse: 0, quotaBytes: 0, percentUsed: 0 };
    }

    // Get bytes in use
    const bytesInUse = await new Promise((resolve, reject) => {
      extension.storage.sync.getBytesInUse(null, (bytes) => {
        const err = extension.runtime?.lastError;
        if (err) {
          reject(new Error(err.message || err));
          return;
        }
        resolve(bytes || 0);
      });
    });

    // Chrome/Edge quota is 102,400 bytes (100KB), Firefox is 100KB
    const quotaBytes = extension.storage.sync.QUOTA_BYTES || 102400;
    const percentUsed = bytesInUse / quotaBytes;

    return {
      bytesInUse,
      quotaBytes,
      percentUsed,
    };
  } catch (error) {
    console.warn('Failed to get storage usage:', error);
    return { bytesInUse: 0, quotaBytes: 0, percentUsed: 0 };
  }
}

/**
 * Check if storage quota is approaching limits and return appropriate warning/error
 * @returns {Promise<{shouldWarn: boolean, shouldBlock: boolean, message: string|null}>}
 */
export async function checkStorageQuota() {
  const usage = await getStorageUsage();
  const { percentUsed, bytesInUse, quotaBytes } = usage;

  if (percentUsed >= QUOTA_BLOCK_THRESHOLD) {
    const bytesUsedKB = (bytesInUse / 1024).toFixed(1);
    const quotaKB = (quotaBytes / 1024).toFixed(1);
    return {
      shouldWarn: false,
      shouldBlock: true,
      message: `Storage quota exceeded (${bytesUsedKB}KB / ${quotaKB}KB used). Please export your data and reduce storage usage before saving.`,
      usage,
    };
  }

  if (percentUsed >= QUOTA_WARNING_THRESHOLD) {
    const percentDisplay = (percentUsed * 100).toFixed(0);
    return {
      shouldWarn: true,
      shouldBlock: false,
      message: `Storage usage is at ${percentDisplay}%. Consider exporting your data to avoid quota issues.`,
      usage,
    };
  }

  return {
    shouldWarn: false,
    shouldBlock: false,
    message: null,
    usage,
  };
}

/**
 * Format storage usage as a human-readable string
 * @param {object} usage - Usage object from getStorageUsage()
 * @returns {string}
 */
export function formatStorageUsage(usage) {
  const { bytesInUse, quotaBytes, percentUsed } = usage;
  const bytesUsedKB = (bytesInUse / 1024).toFixed(1);
  const quotaKB = (quotaBytes / 1024).toFixed(1);
  const percent = (percentUsed * 100).toFixed(1);
  return `${bytesUsedKB}KB / ${quotaKB}KB (${percent}%)`;
}

/**
 * Get suggestions for reducing storage usage
 * @returns {Array<string>}
 */
export function getStorageCleanupSuggestions() {
  return [
    'Export your tags and assignments, then delete unused tags',
    'Remove tag assignments from streamers you no longer follow',
    'Delete old custom tags you no longer use',
    'Consider using fewer tags or shorter tag names',
  ];
}
