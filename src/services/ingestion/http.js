// HTTP helper for ingestion adapters. Everything is injectable (`fetchImpl`)
// so tests can drive adapters without a network, and every request gets a
// timeout + one retry on transient failures.

import { redactUrl } from './text.js';

const USER_AGENT = 'GatherEventSync/1.0 (+https://github.com/gather-austin)';
const DEFAULT_TIMEOUT_MS = 15_000;

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

// Bot walls (Cloudflare's "Just a moment..." interstitial is the one Austin
// sites actually use) answer with a 403/503 and a page that looks nothing like
// the calendar. They are worth telling apart from a broken server: the file is
// still there, just not served to this client, so an adapter can reach for a
// different representation instead of reporting the feed as empty.
const BOT_WALL_MARKERS = [
  'just a moment',
  'attention required',
  'enable javascript and cookies to continue',
  'checking your browser before accessing',
  'cf-browser-verification',
  'cf-chl',
  '_cf_chl_opt',
  'request unsuccessful. incapsula',
  'incapsula incident id',
  'ddos-guard',
  'sorry, you have been blocked',
];
const BOT_WALL_STATUS = new Set([401, 403, 407, 429, 503]);

// `status` is included because a challenge usually arrives as an error status,
// but a few sites serve the interstitial with 200, so a caller reading a body
// successfully can still ask whether it got the wall instead of the page.
export function looksLikeBotWall(status, body = '') {
  const text = String(body).toLowerCase();
  if (!text) return false;
  if (!BOT_WALL_MARKERS.some((marker) => text.includes(marker))) return false;
  const code = Number(status) || 0;
  if (BOT_WALL_STATUS.has(code)) return true;
  // A 200 only counts when the body carries no content we could have parsed —
  // an event description that happens to mention "just a moment" must not be
  // mistaken for a challenge.
  return code === 200 && !/application\/ld\+json|begin:vcalendar|<item/i.test(text);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class HttpError extends Error {
  constructor(message, { status = 0, url = '', blocked = false } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = redactUrl(url);
    // True when the host answered with a bot challenge rather than the file.
    this.blocked = Boolean(blocked);
  }
}

export async function request(
  url,
  {
    fetchImpl = globalThis.fetch,
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 1,
    accept = 'application/json',
    method = 'GET',
    body,
  } = {},
) {
  if (typeof fetchImpl !== 'function') {
    throw new HttpError('No fetch implementation available in this runtime.', { url });
  }

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        signal: controller.signal,
        method,
        ...(body === undefined ? {} : { body }),
        headers: {
          accept,
          'user-agent': USER_AGENT,
          ...headers,
        },
      });

      if (res.ok) return res;

      const detail = (await res.text().catch(() => '')).slice(0, 300);
      const error = new HttpError(
        `HTTP ${res.status} ${res.statusText || ''}`.trim() + (detail ? `: ${detail}` : ''),
        {
          status: res.status,
          url,
          blocked:
            looksLikeBotWall(res.status, detail) ||
            /^(challenge|managed_challenge)$/i.test(res.headers?.get?.('cf-mitigated') || ''),
        },
      );
      if (!RETRY_STATUS.has(res.status) || attempt === retries) throw error;
      lastError = error;
    } catch (err) {
      if (err?.name === 'AbortError') {
        lastError = new HttpError(`Request timed out after ${timeoutMs}ms`, { url });
      } else if (err instanceof HttpError) {
        lastError = err;
      } else {
        lastError = new HttpError(`${err?.message || 'Network request failed'}`, { url });
      }
      // A status we already judged not worth retrying (a 403 bot wall, a 404)
      // must not be retried by this loop either — repeating it only adds load to
      // the host that just refused us.
      if ((lastError.status && !RETRY_STATUS.has(lastError.status)) || attempt === retries) {
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }

    // Back off a little before the single retry.
    await sleep(250 * (attempt + 1));
  }

  throw lastError || new HttpError('Request failed', { url });
}

export async function requestJson(url, options = {}) {
  const res = await request(url, options);
  try {
    return await res.json();
  } catch {
    throw new HttpError('Response was not valid JSON', { url, status: res.status });
  }
}

export async function requestText(url, options = {}) {
  const res = await request(url, { ...options, accept: options.accept || 'text/calendar, text/xml, */*' });
  return res.text();
}
