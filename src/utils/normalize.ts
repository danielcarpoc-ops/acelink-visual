/**
 * Shared channel name normalization utilities.
 * Used by both TelegramTab (channel grouping / logo lookup) and App (favorites matching).
 */

const QUALITY_TAGS = ['UHD', 'FHD', '4K', '1080p', '1080', '720p', '720', 'HD'];

/**
 * Normalize a channel name for EPG / logo / grouping matching.
 * - Strips invisible/control Unicode characters (e.g. \u202a LEFT-TO-RIGHT EMBEDDING)
 * - Strips Telegram Markdown decorators (__**text:**__)
 * - Lowercases and removes diacritics
 * - Removes Movistar / M+ prefix
 * - Removes quality tags (HD, FHD, UHD, 4K, etc.)
 * - Removes non-word characters
 */
export const normalizeForEpgMatch = (name: string): string => {
  if (!name) return '';
  // Strip invisible/control Unicode characters first
  let s = name.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E]/g, '');
  // Strip Telegram Markdown decorators (__, **, `, ~, |, > and leading/trailing punctuation)
  s = s.replace(/[_*`~|>]+/g, '');
  s = s.replace(/^\s*[:.\-]+|[:.\-]+\s*$/g, '');
  s = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Normalize whitespace
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^(movistar|m\+|m\.|m\s+)/, '');
  s = s.replace(/\b(hd|fhd|uhd|4k|1080p|1080|720p|720)\b/g, '');
  s = s.replace(/[^\w]/g, '');
  return s;
};

/**
 * Remove quality tags from a channel name and tidy up whitespace,
 * producing a human-readable display name.
 */
export const getDisplayName = (name: string): string => {
  let s = name;
  for (const tag of QUALITY_TAGS) {
    s = s.replace(new RegExp(`\\b${tag}\\b`, 'gi'), '');
  }
  return s.replace(/\s+/g, ' ').trim();
};

/**
 * Extract the quality tag (HD/FHD/UHD/4K/etc.) from a channel name.
 * Returns an empty string if none is found.
 */
export const extractQuality = (name: string): string => {
  const upper = name.toUpperCase();
  for (const tag of QUALITY_TAGS) {
    const regex = new RegExp(`\\b${tag}\\b`, 'i');
    if (regex.test(upper)) return tag.toUpperCase();
  }
  return '';
};

/**
 * Clean a channel name for display:
 * keeps letters (including accented), numbers and spaces; collapses whitespace.
 */
export const cleanChannelName = (name: string): string => {
  if (!name) return '';
  // Strip invisible/control characters first
  let s = name.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF\u202A-\u202E]/g, '');
  return s
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
};
