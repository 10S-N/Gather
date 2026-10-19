// HTTP helper for ingestion adapters. Everything is injectable (`fetchImpl`)
// so tests can drive adapters without a network, and every request gets a
// timeout + one retry on transient failures.

import { redactUrl } from './text.js';

const USER_AGENT = 'GatherEventSync/1.0 (+https://github.com/gather-austin)';
const DEFAULT_TIMEOUT_MS = 15_000;

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class HttpError extends Error {
  constructor(message, { status = 0, url = '' } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = redactUrl(url);
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
        { status: res.status, url },
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
      if (attempt === retries) throw lastError;
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
