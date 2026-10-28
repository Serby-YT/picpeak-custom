const crypto = require('crypto');

// Two token shapes exist: the original 32-char hex, and the short readable
// "remus-k7q2xa" (gallery name + 6-char code) used for links made since
// 2026-10-28. The code always holds at least one letter g-z, which neither a
// date nor a hex suffix can, so a short token can never be mistaken for a
// slug like "photo-remus-2026-10-09" or "photo-remus-a3f9c1".
const SHARE_TOKEN_REGEX = /^(?:[0-9a-fA-F]{32}|[a-z0-9]+(?:-[a-z0-9]+)*-(?=[a-z0-9]*[g-z])[a-z0-9]{6})$/;

// No 0/o, 1/l/i: the code gets read off phones and retyped.
const SHARE_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const SHARE_CODE_LENGTH = 6;
const SHARE_NAME_MAX_LENGTH = 20;

/**
 * Builds a short share token: the gallery name, then a random code.
 * The name is only there so the client recognises the link; the code is
 * the secret.
 * @param {string} eventName
 * @returns {string}
 */
function generateShareToken(eventName) {
  let name = String(eventName || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (name.length > SHARE_NAME_MAX_LENGTH) {
    const cut = name.slice(0, SHARE_NAME_MAX_LENGTH);
    const lastHyphen = cut.lastIndexOf('-');
    name = lastHyphen > 0 ? cut.slice(0, lastHyphen) : cut;
  }
  if (!name) {
    name = 'galerie';
  }

  let code;
  do {
    code = '';
    for (let i = 0; i < SHARE_CODE_LENGTH; i++) {
      code += SHARE_CODE_ALPHABET[crypto.randomInt(SHARE_CODE_ALPHABET.length)];
    }
  } while (!/[g-z]/.test(code));

  return `${name}-${code}`;
}

/**
 * Extracts the share token portion from a stored share link.
 * Supports full URLs, absolute paths, and legacy slug/token formats.
 * @param {string|null|undefined} shareLink
 * @returns {string|null}
 */
function extractShareToken(shareLink) {
  if (!shareLink) {
    return null;
  }

  const trimmed = String(shareLink).trim();
  if (!trimmed) {
    return null;
  }

  // Remove protocol + host when a full URL is stored
  const path = trimmed.replace(/^https?:\/\/[^/]+/i, '');
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }

  const candidate = segments[segments.length - 1];
  return candidate || null;
}

/**
 * Returns true if the provided identifier looks like a generated share token.
 * @param {string|null|undefined} identifier
 * @returns {boolean}
 */
function isPotentialShareToken(identifier) {
  if (!identifier) {
    return false;
  }
  return SHARE_TOKEN_REGEX.test(String(identifier).trim());
}

/**
 * Builds the gallery share path depending on whether short URLs are enabled.
 * @param {string} slug
 * @param {string} shareToken
 * @param {boolean} useShort
 * @returns {string}
 */
function buildSharePath(slug, shareToken, useShort) {
  if (!shareToken) {
    throw new Error('shareToken is required to build share path');
  }
  if (useShort || !slug) {
    return `/g/${shareToken}`;
  }
  return `/gallery/${slug}/${shareToken}`;
}

module.exports = {
  extractShareToken,
  isPotentialShareToken,
  buildSharePath,
  generateShareToken
};
