/**
 * Host half of the DeepSeek balance bundle.
 *
 * The balance itself can only be read with the API key, which never reaches the
 * browser. This half resolves the DSH credential, queries the official
 * `/user/balance` endpoint, and serves one small same-origin JSON reading to
 * the status cell.
 */
const ROUTE = '/dsh-balance/summary'
const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const API_KEY_REF = 'DEEPSEEK_API_KEY'
const CACHE_MS = 15000
const REQUEST_TIMEOUT_MS = 8000

export const inject = ['credentials', 'webServer']

function walletOf(value) {
  return {
    currency: typeof value?.currency === 'string' ? value.currency : 'CNY',
    total: String(value?.total_balance ?? '0'),
    granted: String(value?.granted_balance ?? '0'),
    toppedUp: String(value?.topped_up_balance ?? '0'),
  }
}

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export function apply(ctx) {
  let cache = { at: 0, body: null }

  async function readApiKey() {
    try {
      const hit = await ctx.credentials.resolve(API_KEY_REF)
      if (hit && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
    } catch {
      /* fall through to the ambient environment */
    }
    const ambient = process.env[API_KEY_REF]
    return typeof ambient === 'string' && ambient.length > 0 ? ambient : undefined
  }

  async function readBalance() {
    const now = Date.now()
    if (cache.body !== null && now - cache.at < CACHE_MS) return cache.body

    const apiKey = await readApiKey()
    if (apiKey === undefined) {
      const body = { ok: false, error: 'missing_api_key' }
      cache = { at: now, body }
      return body
    }

    let response
    try {
      response = await fetch(BALANCE_URL, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch {
      return { ok: false, error: 'request_failed' }
    }
    if (!response.ok) return { ok: false, error: `http_${response.status}` }

    let data
    try {
      data = await response.json()
    } catch {
      return { ok: false, error: 'invalid_response' }
    }
    const wallets = Array.isArray(data?.balance_infos) ? data.balance_infos.map(walletOf) : []
    const body = {
      ok: true,
      fetchedAt: Date.now(),
      isAvailable: data?.is_available === true,
      wallets,
    }
    cache = { at: Date.now(), body }
    return body
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      if (!isLoopback(req.socket?.remoteAddress)) {
        res.writeHead(403, { 'cache-control': 'no-store' })
        res.end()
        return
      }
      let body
      try {
        body = await readBalance()
      } catch {
        body = { ok: false, error: 'request_failed' }
      }
      const text = JSON.stringify(body)
      res.writeHead(body.ok === true ? 200 : 502, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(text),
      })
      res.end(req.method === 'HEAD' ? undefined : text)
    },
  }), 'deepseek-balance: summary route')
}
