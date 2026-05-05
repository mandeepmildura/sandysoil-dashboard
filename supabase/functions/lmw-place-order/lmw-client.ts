/**
 * LMW HTTP client — local copy for the lmw-place-order function.
 *
 * Mirrors supabase/functions/lmw-sync/lib/lmw-client.ts so each edge
 * function deploys as a self-contained bundle (cross-function relative
 * imports are not portable). If you change one, change the other.
 */

const BASE_URL = 'https://waterorder.lmw.vic.gov.au'

export type LmwSession = {
  outlet: string
  cookie: string
}

export async function lmwLogin(outlet: string, pin: string): Promise<LmwSession> {
  const getRes = await fetch(`${BASE_URL}/default1.asp`, {
    method: 'GET',
    redirect: 'manual',
  })
  const initialCookie = collectCookies(getRes.headers)

  const body = new URLSearchParams({ outlet, pin })
  const postRes = await fetch(`${BASE_URL}/default1.asp`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie':       initialCookie,
    },
    body: body.toString(),
  })

  const loginCookie = mergeCookies(initialCookie, collectCookies(postRes.headers))

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

export async function lmwGet(session: LmwSession, path: string): Promise<string> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: { 'Cookie': session.cookie },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`LMW GET ${path} failed: HTTP ${res.status}`)
  const html = await res.text()
  if (html.includes('Please log in again')) {
    throw new Error(`LMW session expired during GET ${path}`)
  }
  return html
}

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

function collectCookies(headers: Headers): string {
  // deno-lint-ignore no-explicit-any
  const setCookies: string[] = (headers as any).getSetCookie?.() ?? []
  if (setCookies.length === 0) {
    const single = headers.get('set-cookie')
    if (single) setCookies.push(single)
  }
  return setCookies.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ')
}

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
