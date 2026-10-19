// Small, dependency-free text helpers shared by every ingestion adapter and by
// the normalizer. Kept pure so they can run in Node, in the browser, and in a
// serverless handler without a DOM.

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
};

export function decodeEntities(input = '') {
  return String(input).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

// Third-party feeds love markup. We store plain text so cards, search, and the
// detail page don't have to sanitize anything at render time.
export function stripHtml(input = '') {
  if (!input) return '';
  const withoutBlocks = String(input)
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return normalizeWhitespace(decodeEntities(withoutBlocks));
}

export function normalizeWhitespace(input = '') {
  return String(input)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n+ ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncate(input = '', max = 240) {
  const text = String(input).trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function slugify(input = '') {
  return String(input)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

// Deterministic 32-bit hash (FNV-1a), returned as base36. Used to build stable
// Firestore document ids so re-running a sync updates instead of duplicating.
export function stableHash(input = '') {
  let hash = 0x811c9dc5;
  const text = String(input);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// Firestore document ids allow most characters but reject `/`, so we keep ids
// to a conservative alphabet to avoid surprises in URLs and logs.
export function safeDocId(input = '') {
  return String(input)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
}

export function splitList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[,\n;]/);
  return list.map((item) => String(item).trim()).filter(Boolean);
}

// Hides API keys / calendar tokens that occasionally ride along in query
// strings (`?k=…`) before an error message reaches a log or the admin UI.
export function redactUrl(input = '') {
  return String(input).replace(/([?&](?:k|key|token|apikey|api_key)=)[^&\s]+/gi, '$1REDACTED');
}
