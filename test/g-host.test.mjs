import test from 'node:test'
import assert from 'node:assert/strict'

const { apply, inject } = await import('../index.js')

const BALANCE_PATH = '/dsh-balance/summary'

function makeContext(options = {}) {
  const hasKey = Object.hasOwn(options, 'apiKey')
  const apiKey = hasKey ? options.apiKey : 'sk-test'
  const calls = { resolve: 0, fetch: 0 }
  const routes = []
  const ctx = {
    effect(factory) {
      return factory()
    },
    credentials: {
      async resolve(ref) {
        calls.resolve += 1
        calls.ref = ref
        return apiKey === undefined ? undefined : { value: apiKey }
      },
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  }
  return { ctx, routes, calls }
}

function fakeFetch(response) {
  return async (url, init) => {
    const call = { url: String(url), init }
    return response(call)
  }
}

function callRoute(route, { method = 'GET', address = '127.0.0.1' } = {}) {
  return new Promise((resolve) => {
    const result = { status: 0, headers: {} }
    const res = {
      writeHead(code, headers) {
        result.status = code
        Object.assign(result.headers, headers ?? {})
      },
      end(body) {
        result.body = body === undefined ? '' : String(body)
        resolve(result)
      },
    }
    const req = { method, socket: { remoteAddress: address }, headers: {} }
    route.handler(req, res)
  })
}

async function withFetch(stub, run) {
  const original = globalThis.fetch
  globalThis.fetch = stub
  try {
    return await run()
  } finally {
    globalThis.fetch = original
  }
}

function okResponse() {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '84.33', granted_balance: '0.00', topped_up_balance: '84.33' }],
      }
    },
  }
}

test('G1 the Host half injects credentials plus the web server and registers one exact route', () => {
  assert.deepEqual(Array.from(inject), ['credentials', 'webServer'])
  const { ctx, routes } = makeContext()
  apply(ctx)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'exact')
  assert.equal(routes[0].path, BALANCE_PATH)
  assert.equal(typeof routes[0].handler, 'function')
})

test('G2 a successful upstream read is normalized for the cell', async () => {
  const { ctx, routes, calls } = makeContext()
  const stub = fakeFetch(() => okResponse())
  await withFetch(stub, async () => {
    apply(ctx)
    const result = await callRoute(routes[0])
    assert.equal(result.status, 200)
    const body = JSON.parse(result.body)
    assert.equal(body.ok, true)
    assert.equal(body.isAvailable, true)
    assert.deepEqual(body.wallets, [
      { currency: 'CNY', total: '84.33', granted: '0.00', toppedUp: '84.33' },
    ])
    assert.equal(calls.resolve, 1)
  })
})

test('G3 a missing API key answers 502 without calling the platform', async () => {
  const { ctx, routes } = makeContext({ apiKey: undefined })
  const stub = fakeFetch(() => {
    throw new Error('upstream must not be called')
  })
  const original = process.env.DEEPSEEK_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  try {
    await withFetch(stub, async () => {
      apply(ctx)
      const result = await callRoute(routes[0])
      assert.equal(result.status, 502)
      assert.deepEqual(JSON.parse(result.body), { ok: false, error: 'missing_api_key' })
    })
  } finally {
    if (original === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = original
  }
})

test('G4 an upstream rejection keeps its status', async () => {
  const { ctx, routes } = makeContext()
  const stub = fakeFetch(() => ({
    ok: false,
    status: 401,
    async json() {
      return {}
    },
  }))
  await withFetch(stub, async () => {
    apply(ctx)
    const result = await callRoute(routes[0])
    assert.equal(result.status, 502)
    assert.deepEqual(JSON.parse(result.body), { ok: false, error: 'http_401' })
  })
})

test('G5 non-loopback callers are refused', async () => {
  const { ctx, routes } = makeContext()
  await withFetch(fakeFetch(() => okResponse()), async () => {
    apply(ctx)
    const result = await callRoute(routes[0], { address: '10.0.0.7' })
    assert.equal(result.status, 403)
  })
})

test('G6 the route refuses non-GET methods', async () => {
  const { ctx, routes } = makeContext()
  await withFetch(fakeFetch(() => okResponse()), async () => {
    apply(ctx)
    const result = await callRoute(routes[0], { method: 'POST' })
    assert.equal(result.status, 405)
  })
})

test('G7 repeated reads inside the cache window hit the platform once', async () => {
  const { ctx, routes } = makeContext()
  let upstream = 0
  const stub = fakeFetch(() => {
    upstream += 1
    return okResponse()
  })
  await withFetch(stub, async () => {
    apply(ctx)
    await callRoute(routes[0])
    await callRoute(routes[0])
    assert.equal(upstream, 1)
  })
})

test('G8 the ambient environment is the API-key fallback', async () => {
  const { ctx, routes } = makeContext({ apiKey: undefined })
  const original = process.env.DEEPSEEK_API_KEY
  process.env.DEEPSEEK_API_KEY = 'sk-from-env'
  let seen = null
  const stub = fakeFetch((call) => {
    seen = call
    return okResponse()
  })
  try {
    await withFetch(stub, async () => {
      apply(ctx)
      const result = await callRoute(routes[0])
      assert.equal(result.status, 200)
      assert.match(seen.init.headers.Authorization, /^Bearer sk-from-env$/)
    })
  } finally {
    if (original === undefined) delete process.env.DEEPSEEK_API_KEY
    else process.env.DEEPSEEK_API_KEY = original
  }
})

test('G9 a thrown transport failure is reported as request_failed', async () => {
  const { ctx, routes } = makeContext()
  const stub = fakeFetch(() => {
    throw new Error('offline')
  })
  await withFetch(stub, async () => {
    apply(ctx)
    const result = await callRoute(routes[0])
    assert.equal(result.status, 502)
    assert.deepEqual(JSON.parse(result.body), { ok: false, error: 'request_failed' })
  })
})
