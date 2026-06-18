// First-party reverse proxy for PostHog, served from the Cloudflare Worker edge.
//
// posthog-js is configured with `api_host: '/ingest'`, so analytics requests go
// to our own domain instead of `*.i.posthog.com`. The Worker forwards them to
// PostHog's EU region, which keeps tracking working past ad blockers that target
// PostHog's hosts. Running it here (not just the Vite dev proxy) means dev and
// production share one code path.
//
// Mirrors PostHog's reference Cloudflare worker:
// https://posthog.com/docs/advanced/proxy/cloudflare

const API_HOST = 'eu.i.posthog.com'
const ASSET_HOST = 'eu-assets.i.posthog.com'

const PROXY_PREFIX = '/ingest'

/** True for requests posthog-js sends to the first-party `/ingest` path. */
export function isPostHogProxyRequest(url: URL): boolean {
  return (
    url.pathname === PROXY_PREFIX ||
    url.pathname.startsWith(`${PROXY_PREFIX}/`)
  )
}

export function handlePostHogProxy(
  request: Request,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url)
  // Strip the `/ingest` prefix to recover PostHog's real path.
  const pathname = url.pathname.slice(PROXY_PREFIX.length) || '/'
  const pathWithSearch = pathname + url.search

  // Static SDK bundles and remote config come from the assets host and are
  // cacheable; everything else is event ingestion bound for the API host.
  if (pathname.startsWith('/static/') || pathname.startsWith('/array/')) {
    return retrieveAsset(request, pathWithSearch, ctx)
  }
  return forwardRequest(request, pathWithSearch)
}

async function retrieveAsset(
  request: Request,
  pathWithSearch: string,
  ctx: ExecutionContext,
): Promise<Response> {
  // `caches.default` is a Cloudflare extension absent from the DOM lib types.
  const cache = (caches as unknown as { default: Cache }).default
  let response = await cache.match(request)
  if (!response) {
    response = await fetch(`https://${ASSET_HOST}${pathWithSearch}`)
    ctx.waitUntil(cache.put(request, response.clone()))
  }
  return response
}

async function forwardRequest(
  request: Request,
  pathWithSearch: string,
): Promise<Response> {
  // Preserve the real client IP for geolocation; the origin can't see
  // CF-Connecting-IP through the proxy hop.
  const ip = request.headers.get('CF-Connecting-IP') ?? ''
  const headers = new Headers(request.headers)
  headers.delete('cookie')
  headers.set('X-Forwarded-For', ip)

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  return fetch(`https://${API_HOST}${pathWithSearch}`, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : null,
    redirect: request.redirect,
  })
}
