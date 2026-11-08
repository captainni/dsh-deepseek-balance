import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient } from './harness.mjs'

const { internals } = loadClient()
const { createBalanceController, statusShouldRefresh, tickAction } = internals

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    raw: map,
  }
}

function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const SUMMARY = {
  ok: true,
  fetchedAt: Date.UTC(2026, 10, 8, 2, 0, 0),
  isAvailable: true,
  wallets: [{ currency: 'CNY', total: '84.33', granted: '0.00', toppedUp: '84.33' }],
}

function makeController(fetchSummary, options = {}) {
  const storage = options.storage ?? memoryStorage()
  const clock = { now: options.now ?? Date.UTC(2026, 10, 8, 2, 0, 0) }
  const controller = createBalanceController({
    fetchSummary,
    storage,
    now: () => clock.now,
    timeoutMs: options.timeoutMs,
  })
  return { controller, storage, clock }
}

test('D1 a missing balance source is an error, not a silent cell', async () => {
  const { controller } = makeController(undefined)
  await controller.refresh()
  assert.equal(controller.getSnapshot().status, 'error')
})

test('D2 a missing API key becomes the missing-key state', async () => {
  const { controller } = makeController(async () => ({ ok: false, error: 'missing_api_key' }))
  await controller.refresh()
  assert.equal(controller.getSnapshot().status, 'missing-key')
})

test('D3 an upstream HTTP failure keeps its error text', async () => {
  const { controller } = makeController(async () => ({ ok: false, error: 'http_401' }))
  await controller.refresh()
  const state = controller.getSnapshot()
  assert.equal(state.status, 'error')
  assert.match(String(state.error), /http_401/)
})

test('D4 an empty wallet list is an error, never a zero balance', async () => {
  const { controller } = makeController(async () => ({ ...SUMMARY, wallets: [] }))
  await controller.refresh()
  assert.equal(controller.getSnapshot().status, 'error')
  assert.equal(controller.getSnapshot().primary, undefined)
})

test('D5 a ready summary exposes the primary wallet and today spend', async () => {
  const { controller } = makeController(async () => SUMMARY)
  await controller.refresh()
  const state = controller.getSnapshot()
  assert.equal(state.status, 'ready')
  assert.equal(state.primary.currency, 'CNY')
  assert.equal(state.primary.total, 84.33)
  assert.equal(state.spend, 0)
  assert.equal(state.sinceInstall, true)
  assert.equal(state.isAvailable, true)
  assert.equal(state.fetchedAt, SUMMARY.fetchedAt)
})

test('D6 an unavailable account flag is preserved', async () => {
  const { controller } = makeController(async () => ({ ...SUMMARY, isAvailable: false }))
  await controller.refresh()
  assert.equal(controller.getSnapshot().isAvailable, false)
})

test('D7 a superseded refresh cannot overwrite newer state', async () => {
  const first = deferred()
  const second = deferred()
  let call = 0
  const { controller } = makeController(() => {
    call += 1
    return call === 1 ? first.promise : second.promise
  })
  const firstRun = controller.refresh()
  const secondRun = controller.refresh()
  second.resolve({ ...SUMMARY, wallets: [{ currency: 'CNY', total: '9.00', granted: '0', toppedUp: '9.00' }] })
  await secondRun
  first.resolve({ ...SUMMARY, wallets: [{ currency: 'CNY', total: '1.00', granted: '0', toppedUp: '1.00' }] })
  await firstRun
  assert.equal(controller.getSnapshot().primary.total, 9)
})

test('D8 dispose stops further state publication', async () => {
  const pending = deferred()
  const { controller } = makeController(() => pending.promise)
  const run = controller.refresh()
  controller.dispose()
  pending.resolve(SUMMARY)
  await run
  assert.equal(controller.getSnapshot().status, 'loading')
})

test('D9 one refresh performs exactly one Host read', async () => {
  let calls = 0
  const { controller } = makeController(async () => {
    calls += 1
    return SUMMARY
  })
  await controller.refresh()
  await flush()
  assert.equal(calls, 1)
})

test('D10 only a running-to-idle transition asks for a refresh', () => {
  assert.equal(statusShouldRefresh(true, false), true)
  assert.equal(statusShouldRefresh(false, false), false)
  assert.equal(statusShouldRefresh(false, true), false)
  assert.equal(statusShouldRefresh(undefined, false), false)
  assert.equal(statusShouldRefresh(true, undefined), false)
})

test('D11 the clock tick retries unfinished reads and rolls the day over', () => {
  const now = new Date(2026, 10, 9, 10, 0, 0).getTime()
  assert.equal(tickAction({ status: 'loading', fetchedAt: null }, now), 'refresh')
  assert.equal(tickAction({ status: 'error', fetchedAt: null }, now), 'refresh')
  assert.equal(tickAction({ status: 'missing-key', fetchedAt: null }, now), 'refresh')
  assert.equal(tickAction({ status: 'ready', fetchedAt: now - 60_000 }, now), 'none')
  const yesterday = new Date(2026, 10, 8, 23, 0, 0).getTime()
  assert.equal(tickAction({ status: 'ready', fetchedAt: yesterday }, now), 'refresh')
  assert.equal(tickAction(undefined, now), 'none')
})

test('D12 a broken storage backend never breaks a refresh', async () => {
  const storage = {
    getItem() {
      throw new Error('denied')
    },
    setItem() {
      throw new Error('denied')
    },
  }
  const { controller } = makeController(async () => SUMMARY, { storage })
  await controller.refresh()
  assert.equal(controller.getSnapshot().status, 'ready')
  assert.equal(controller.getSnapshot().spend, 0)
})

test('D13 a Host read that never settles times out into an error', async () => {
  const { controller } = makeController(() => new Promise(() => {}), { timeoutMs: 5 })
  await controller.refresh()
  const state = controller.getSnapshot()
  assert.equal(state.status, 'error')
  assert.match(String(state.error), /timed out/i)
})
