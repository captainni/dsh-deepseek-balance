import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient } from './harness.mjs'

const { internals } = loadClient()
const { todaySpend, localDay } = internals

const D = (year, month, day, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute, 0, 0).getTime()

const obs = (at, total, currency = 'CNY') => ({ at, total, currency })

test('B0 localDay uses the local calendar date', () => {
  assert.equal(localDay(D(2026, 11, 8, 0, 0)), '2026-11-08')
  assert.equal(localDay(D(2026, 11, 8, 23, 59)), '2026-11-08')
  assert.equal(localDay(D(2026, 1, 1, 9, 0)), '2026-01-01')
})

test('B1 first run establishes a baseline from the current balance', () => {
  const now = D(2026, 11, 8, 10)
  const result = todaySpend(null, obs(now, 10), now)
  assert.equal(result.spend, 0)
  assert.equal(result.sinceInstall, true)
  assert.equal(result.toppedUp, false)
  assert.equal(result.store.baseline.total, 10)
  assert.equal(result.store.baseline.day, '2026-11-08')
  assert.equal(result.store.last.total, 10)
})

test('B2 same-day decrease is today spend', () => {
  const now = D(2026, 11, 8, 10)
  const store = {
    last: { at: D(2026, 11, 8, 9), day: '2026-11-08', total: 10, currency: 'CNY' },
    baseline: { day: '2026-11-08', total: 10, currency: 'CNY', toppedUp: false },
  }
  const result = todaySpend(store, obs(now, 8.5), now)
  assert.equal(result.spend, 1.5)
  assert.equal(result.store.baseline.total, 10)
  assert.equal(result.sinceInstall, false)
})

test('B3 balance increase is treated as a top-up and resets the baseline', () => {
  const now = D(2026, 11, 8, 10)
  const store = {
    last: { at: D(2026, 11, 8, 9), day: '2026-11-08', total: 8, currency: 'CNY' },
    baseline: { day: '2026-11-08', total: 8, currency: 'CNY', toppedUp: false },
  }
  const result = todaySpend(store, obs(now, 10), now)
  assert.equal(result.spend, 0)
  assert.equal(result.toppedUp, true)
  assert.equal(result.store.baseline.total, 10)
})

test('B4 spend after a top-up is measured from the topped-up baseline', () => {
  const now = D(2026, 11, 8, 11)
  const store = {
    last: { at: D(2026, 11, 8, 10), day: '2026-11-08', total: 10, currency: 'CNY' },
    baseline: { day: '2026-11-08', total: 10, currency: 'CNY', toppedUp: true },
  }
  const result = todaySpend(store, obs(now, 9), now)
  assert.equal(result.spend, 1)
  assert.equal(result.toppedUp, true, 'the top-up flag survives later reads today')
})

test('B5 a new day uses the last balance known before midnight', () => {
  const now = D(2026, 11, 9, 10)
  const store = {
    last: { at: D(2026, 11, 8, 23), day: '2026-11-08', total: 10, currency: 'CNY' },
    baseline: { day: '2026-11-08', total: 10, currency: 'CNY', toppedUp: false },
  }
  const result = todaySpend(store, obs(now, 9), now)
  assert.equal(result.spend, 1)
  assert.equal(result.store.baseline.day, '2026-11-09')
  assert.equal(result.store.baseline.total, 10)
  assert.equal(result.sinceInstall, false)
})

test('B6 no usage overnight reports zero', () => {
  const now = D(2026, 11, 9, 8)
  const store = {
    last: { at: D(2026, 11, 8, 23), day: '2026-11-08', total: 10, currency: 'CNY' },
    baseline: { day: '2026-11-08', total: 10, currency: 'CNY', toppedUp: false },
  }
  const result = todaySpend(store, obs(now, 10), now)
  assert.equal(result.spend, 0)
  assert.equal(result.store.baseline.day, '2026-11-09')
})

test('B7 stale multi-day observation is still the documented baseline', () => {
  const now = D(2026, 11, 12, 10)
  const store = {
    last: { at: D(2026, 11, 8, 12), day: '2026-11-08', total: 10, currency: 'CNY' },
    baseline: { day: '2026-11-08', total: 10, currency: 'CNY', toppedUp: false },
  }
  const result = todaySpend(store, obs(now, 7), now)
  assert.equal(result.spend, 3)
  assert.equal(result.store.baseline.total, 10)
})

test('B8 currency change resets the estimate', () => {
  const now = D(2026, 11, 8, 10)
  const store = {
    last: { at: D(2026, 11, 8, 9), day: '2026-11-08', total: 10, currency: 'CNY' },
    baseline: { day: '2026-11-08', total: 10, currency: 'CNY', toppedUp: false },
  }
  const result = todaySpend(store, obs(now, 3, 'USD'), now)
  assert.equal(result.spend, 0)
  assert.equal(result.sinceInstall, true)
  assert.equal(result.store.baseline.currency, 'USD')
})

test('B9 corrupt or missing store entries never throw', () => {
  const now = D(2026, 11, 8, 10)
  for (const store of [null, undefined, 'nope', 42, {}, { last: 'x' }, { baseline: [] }]) {
    const result = todaySpend(store, obs(now, 10), now)
    assert.equal(typeof result.spend, 'number')
    assert.equal(result.spend, 0)
  }
})

test('B10 repeated reads do not drift the baseline and the spend never decreases', () => {
  const day = '2026-11-08'
  const store = {
    last: { at: D(2026, 11, 8, 8), day, total: 10, currency: 'CNY' },
    baseline: { day, total: 10, currency: 'CNY', toppedUp: false },
  }
  const first = todaySpend(store, obs(D(2026, 11, 8, 9), 9.5), D(2026, 11, 8, 9))
  const second = todaySpend(first.store, obs(D(2026, 11, 8, 10), 9), D(2026, 11, 8, 10))
  assert.equal(first.spend, 0.5)
  assert.equal(second.spend, 1)
  assert.equal(second.store.baseline.total, 10)
})
