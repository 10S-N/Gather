import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only fetch proxy for the ingestion adapters.
//
// Eventbrite, Luma's .ics feeds, and most RSS endpoints send no
// Access-Control-Allow-Origin header, so a browser can't read them directly.
// The /admin/sync "Run sync now" button still writes with the client SDK (no
// service account needed); this middleware is what lets it *fetch* the feeds
// while you are running `npm run dev`. It only exists in the dev server — a
// production build talks to the deployed api/sync handler instead.
//
// Locked down deliberately: absolute http(s) URLs only, private/loopback hosts
// refused, a 20s timeout, and no cookies forwarded.
const PROXY_PATH = '/__ingest'
const FETCH_TIMEOUT_MS = 20_000

function isBlockedHost(hostname) {
  const host = hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '[::1]' || host === '::1' || host === '0.0.0.0') return true
  return (
    /^(127|10)\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  )
}

function ingestionFetchProxy() {
  return {
    name: 'gather-ingestion-fetch-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(PROXY_PATH, async (req, res) => {
        const requestUrl = new URL(req.url || '/', 'http://localhost')
        const target = requestUrl.searchParams.get('url') || ''

        let parsed
        try {
          parsed = new URL(target)
        } catch {
          res.statusCode = 400
          res.end('Pass ?url=<absolute http(s) URL>')
          return
        }

        if (!/^https?:$/.test(parsed.protocol) || isBlockedHost(parsed.hostname)) {
          res.statusCode = 403
          res.end('Only absolute http(s) URLs on public hosts are proxied.')
          return
        }

        const headers = {}
        if (req.headers.accept) headers.accept = req.headers.accept
        if (req.headers.authorization) headers.authorization = req.headers.authorization

        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
        try {
          const upstream = await fetch(parsed.toString(), { headers, signal: controller.signal })
          const body = new Uint8Array(await upstream.arrayBuffer())
          res.statusCode = upstream.status
          res.setHeader('content-type', upstream.headers.get('content-type') || 'application/octet-stream')
          res.setHeader('cache-control', 'no-store')
          res.end(body)
        } catch (err) {
          res.statusCode = 502
          res.end(`Proxy fetch failed: ${err?.message || 'unknown error'}`)
        } finally {
          clearTimeout(timer)
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ingestionFetchProxy()],
})
