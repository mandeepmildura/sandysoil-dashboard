/**
 * LMW (Lower Murray Water) HTTP client.
 *
 * The LMW order site is classic ASP with cookie-based sessions and
 * form-encoded POSTs. There's no API — we authenticate the same way
 * a browser would and parse HTML pages.
 *
 * Sessions are short-lived (~30 min idle). This client logs in fresh
 * on every sync run; if we ever need to keep a session warm across
 * runs we can stash the cookie jar in lmw_credentials.session_cookie.
 */

const BASE_URL = 'https://waterorder.lmw.vic.gov.au'

export type LmwSession = {
  outlet: string
  cookie: string         // Cookie header value to send on subsequent requests
}

/**
 * Log in to LMW. Returns a session with the auth cookie that subsequent
 * requests must send. Throws on auth failure.
 *
 * The login form submits to `default1.asp` itself with fields
 * `outlet` and `pin`. A successful login redirects (302) and sets
 * a session cookie; the response body changes from "Log in" to the
 * dashboard tiles when we follow the redirect.
 */
export async function lmwLogin(outlet: string, pin: string): Promise<LmwSession> {
  // First GET to grab any cookies the site sets unauthenticated
  const getRes = await fetch(`${BASE_URL}/default1.asp`, {
    method: 'GET',
    redirect: 'manual',
  })
  const initialCookie = collectCookies(getRes.headers)

  // POST credentials. Field names here match what's on the login form.
  // (Confirmed via DOM inspection: <input name="outlet"> and <input name="pin">.)
  const body = new URLSearchParams({ outlet, pin })

  const postRes = await fetch(`${BASE_URL}/default1.asp`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': initialCookie,
    },
    body: body.toString(),
  })

  // Successful login returns 302 to default1.asp (or 200 with the
  // logged-in tiles). Failed login returns 200 with "Login failed"
  // or "session has expired" content.
  const loginCookie = mergeCookies(initialCookie, collectCookies(postRes.headers))

  // Verify by GETing the main page and checking for the nav bar
  const verifyRes = await fetch(`${BASE_URL}/default1.asp`, {
    method: 'GET',
    headers: { 'Cookie': loginCookie },
    redirect: 'follow',
  })
  const verifyHtml = await verifyRes.text()

  if (!verifyHtml.includes('Place An Order') || verifyHtml.includes('Please log in again')) {
    throw new Error('LMW login failed — check outlet/pin')
  }

  return { outlet, cookie: loginCookie }
}

/** GET an LMW page using the session cookie. Returns the HTML body. */
export async function lmwGet(session: LmwSession, path: string): Promise<string> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: { 'Cookie': session.cookie },
    redirect: 'follow',
  })
  if (!res.ok) {
    throw new Error(`LMW GET ${path} failed: HTTP ${res.status}`)
  }
  const html = await res.text()
  if (html.includes('Please log in again')) {
    throw new Error(`LMW session expired during GET ${path}`)
  }
  return html
}

/**
 * POST a form-encoded body to an LMW page using the session cookie.
 * Returns both status and HTML so callers (e.g. lmw-place-order) can
 * inspect the confirmation page for receipt numbers or error banners.
 */
export async function lmwPost(
  session: LmwSession,
  path: string,
  params: URLSearchParams,
): Promise<{ status: number; body: string }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie':       session.cookie,
    },
    body: params.toString(),
  })
  const body = await res.text()
  if (body.includes('Please log in again')) {
    throw new Error(`LMW session expired during POST ${path}`)
  }
  return { status: res.status, body }
}

// ─────── cookie helpers ───────────────────────────────────────

/** Extract `name=value` pairs from Set-Cookie headers, joined with `; ` */
function collectCookies(headers: Headers): string {
  // Deno Headers exposes set-cookie via getSetCookie()
  // deno-lint-ignore no-explicit-any
  const setCookies: string[] = (headers as any).getSetCookie?.() ?? []
  if (setCookies.length === 0) {
    // Fallback: single header
    const single = headers.get('set-cookie')
    if (single) setCookies.push(single)
  }
  return setCookies
    .map(c => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
}

/** Merge two cookie strings, with later values winning per name. */
function mergeCookies(a: string, b: string): string {
  const map = new Map<string, string>()
  for (const part of [...a.split('; '), ...b.split('; ')]) {
    if (!part) continue
    const eq = part.indexOf('=')
    if (eq === -1) continue
    map.set(part.slice(0, eq), part.slice(eq + 1))
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
}
