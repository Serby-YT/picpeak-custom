// A share token is either the original 32-char hex or the short
// "remus-k7q2xa" form (name + 6-char code holding a letter g-z, which no slug
// date or hex suffix can). Mirrors SHARE_TOKEN_REGEX in the backend's
// utils/shareLinkUtils.js.
const SHARE_TOKEN_REGEX = /^(?:[0-9a-fA-F]{32}|[a-z0-9]+(?:-[a-z0-9]+)*-(?=[a-z0-9]*[g-z])[a-z0-9]{6})$/;

export const looksLikeShareToken = (identifier: string): boolean => SHARE_TOKEN_REGEX.test(identifier);
