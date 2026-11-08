import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient } from './harness.mjs'

const { internals } = loadClient()
const { formatMoney, pickWallet, balanceLevel } = internals

test('A1 formatMoney renders CNY with two decimals', () => {
  assert.equal(formatMoney('CNY', '4.96'), '¥4.96')
})

test('A2 formatMoney normalizes one decimal to two', () => {
  assert.equal(formatMoney('CNY', '4.9'), '¥4.90')
})

test('A3 formatMoney renders zero and USD symbol', () => {
  assert.equal(formatMoney('USD', '0'), '$0.00')
})

test('A4 formatMoney rejects malformed balances', () => {
  for (const raw of ['abc', '', '  ', null, undefined, Number.NaN, Infinity]) {
    assert.equal(formatMoney('CNY', raw), null, `raw=${String(raw)}`)
  }
})

test('A5 pickWallet keeps the main wallet and its split', () => {
  const primary = pickWallet([
    { currency: 'CNY', total: '84.33', granted: '1.20', toppedUp: '83.13' },
  ])
  assert.equal(primary.currency, 'CNY')
  assert.equal(primary.total, 84.33)
  assert.equal(primary.granted, 1.2)
  assert.equal(primary.toppedUp, 83.13)
  assert.deepEqual(Array.from(primary.others), [])
})

test('A6 pickWallet prefers CNY and reports other currencies', () => {
  const primary = pickWallet([
    { currency: 'USD', total: '3.00', granted: '0', toppedUp: '3.00' },
    { currency: 'CNY', total: '84.33', granted: '0', toppedUp: '84.33' },
  ])
  assert.equal(primary.currency, 'CNY')
  assert.equal(primary.total, 84.33)
  assert.deepEqual(
    Array.from(primary.others, (wallet) => ({ currency: wallet.currency, total: wallet.total })),
    [{ currency: 'USD', total: 3 }],
  )
})

test('A7 pickWallet skips malformed entries and reports an empty list', () => {
  assert.equal(pickWallet(null), null)
  assert.equal(pickWallet([]), null)
  assert.equal(pickWallet([null, { currency: 'EUR', total: '1' }, { currency: 'CNY', total: 'x' }]), null)
  const primary = pickWallet([{ currency: 'CNY', total: '0' }, { currency: 'CNY', total: 'nope' }])
  assert.equal(primary.total, 0)
})

test('A8 balanceLevel thresholds: 5 ok, 1 warn, below 1 error', () => {
  assert.equal(balanceLevel(5), 'ok')
  assert.equal(balanceLevel(4.99), 'warn')
  assert.equal(balanceLevel(1), 'warn')
  assert.equal(balanceLevel(0.99), 'error')
  assert.equal(balanceLevel(0), 'error')
  assert.equal(balanceLevel(-0.01), 'error')
  assert.equal(balanceLevel(Number.NaN), 'error')
})
