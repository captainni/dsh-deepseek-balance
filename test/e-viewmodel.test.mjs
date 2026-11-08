import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, createTranslator } from './harness.mjs'

const { internals } = loadClient()
const { buildViewModel, formatMoney, USAGE_URL } = internals
const t = createTranslator()

const MONDAY_0100 = Date.UTC(2026, 10, 9, 1, 0, 0)
const OFF_PEAK_NOW = MONDAY_0100 - (40 * 60 + 33) * 60 * 1000 // Saturday 08:27 UTC
const PEAK_NOW = Date.UTC(2026, 10, 9, 2, 30, 0) // Monday 02:30 UTC

function readyState(overrides = {}) {
  return {
    status: 'ready',
    primary: { currency: 'CNY', total: 84.33, granted: 0, toppedUp: 84.33, others: [] },
    spend: 0.52,
    toppedUp: false,
    sinceInstall: false,
    isAvailable: true,
    error: null,
    fetchedAt: OFF_PEAK_NOW,
    ...overrides,
  }
}

test('E1 a ready state renders balance, today spend and the off-peak countdown', () => {
  const view = buildViewModel({ state: readyState(), now: OFF_PEAK_NOW, t })
  assert.equal(view.hidden, false)
  assert.deepEqual(Array.from(view.segments, (segment) => segment.text), [
    '余额 ¥84.33',
    '今日 ¥0.52',
    '谷 40h33m',
  ])
})

test('E2 unfinished and failed states stay visible with a placeholder', () => {
  const expectations = {
    loading: '余额 读取中',
    'missing-key': '余额 未配置',
    error: '余额 —',
  }
  for (const [status, text] of Object.entries(expectations)) {
    const view = buildViewModel({ state: { status }, now: OFF_PEAK_NOW, t })
    assert.equal(view.hidden, false, status)
    assert.deepEqual(Array.from(view.segments, (segment) => segment.text), [text], status)
    assert.equal(view.href, null, status)
    assert.ok(view.title.length > 0, status)
  }
})

test('E3 an error state carries the failure text in its tooltip', () => {
  const view = buildViewModel({ state: { status: 'error', error: 'http_401' }, now: OFF_PEAK_NOW, t })
  assert.match(view.title, /余额读取失败/)
  assert.match(view.title, /http_401/)
})

test('E4 a ready cell links to the platform usage page', () => {
  const view = buildViewModel({ state: readyState(), now: OFF_PEAK_NOW, t })
  assert.equal(view.href, USAGE_URL)
  assert.equal(view.href, 'https://platform.deepseek.com/usage')
})

test('E5 the balance colour follows the threshold level', () => {
  const warn = buildViewModel({
    state: readyState({ primary: { currency: 'CNY', total: 4, granted: 0, toppedUp: 4, others: [] } }),
    now: OFF_PEAK_NOW,
    t,
  })
  assert.equal(warn.segments[0].color, 'var(--dsw-alias-state-warn-primary)')

  const error = buildViewModel({
    state: readyState({ primary: { currency: 'CNY', total: 0.5, granted: 0, toppedUp: 0.5, others: [] } }),
    now: OFF_PEAK_NOW,
    t,
  })
  assert.equal(error.segments[0].color, 'var(--dsw-alias-state-error-primary)')

  const ok = buildViewModel({ state: readyState(), now: OFF_PEAK_NOW, t })
  assert.equal(ok.segments[0].color, 'var(--dsw-alias-label-primary)')
})

test('E6 the tooltip explains wallets, today scope, the price window and the click', () => {
  const view = buildViewModel({
    state: readyState({ primary: { currency: 'CNY', total: 84.33, granted: 1.2, toppedUp: 83.13, others: [] } }),
    now: OFF_PEAK_NOW,
    t,
  })
  for (const expected of ['充值余额 ¥83.13', '赠送余额 ¥1.20', '今日 ¥0.52', '距下次价目切换', '点击打开用量页']) {
    assert.ok(view.title.includes(expected), `missing "${expected}" in:\n${view.title}`)
  }
})

test('E7 the accessible label summarises every reading', () => {
  const view = buildViewModel({ state: readyState(), now: OFF_PEAK_NOW, t })
  for (const expected of ['余额 ¥84.33', '今日 ¥0.52', '谷 40h33m']) {
    assert.ok(view.ariaLabel.includes(expected), `missing "${expected}" in: ${view.ariaLabel}`)
  }
})

test('E8 the first-day estimate is labelled as starting from the first read', () => {
  const view = buildViewModel({ state: readyState({ sinceInstall: true, spend: 0 }), now: OFF_PEAK_NOW, t })
  assert.equal(view.segments[1].text, '今日 ¥0.00（自首次读取起算）')
})

test('E9 peak hours render the peak label with its countdown', () => {
  const view = buildViewModel({ state: readyState(), now: PEAK_NOW, t })
  assert.equal(view.segments[2].text, '峰 1h30m')
})

test('E10 an unavailable account is disclosed in the tooltip', () => {
  const view = buildViewModel({ state: readyState({ isAvailable: false }), now: OFF_PEAK_NOW, t })
  assert.match(view.title, /账号余额暂不可用/)
})

test('E11 a top-up today is disclosed in the tooltip', () => {
  const view = buildViewModel({ state: readyState({ toppedUp: true }), now: OFF_PEAK_NOW, t })
  assert.match(view.title, /今日含充值，估算已重置/)
})

test('E12 a second currency rides the tooltip only', () => {
  const view = buildViewModel({
    state: readyState({
      primary: { currency: 'CNY', total: 84.33, granted: 0, toppedUp: 84.33, others: [{ currency: 'USD', total: 3 }] },
    }),
    now: OFF_PEAK_NOW,
    t,
  })
  assert.equal(view.segments[0].text, '余额 ¥84.33')
  assert.ok(view.title.includes('$3.00'))
  assert.equal(formatMoney('USD', 3), '$3.00')
})
