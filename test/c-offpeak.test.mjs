import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient } from './harness.mjs'

const { internals } = loadClient()
const { isPeak, nextSwitch, formatCountdown } = internals

/** Exact UTC instant helper. November 2026: the 9th is a Monday. */
const U = (day, hour, minute = 0) => Date.UTC(2026, 10, day, hour, minute, 0, 0)

test('C1 Monday 02:00 UTC is peak', () => {
  assert.equal(isPeak(U(9, 2)), true)
})

test('C2 Monday 05:00 UTC is off-peak', () => {
  assert.equal(isPeak(U(9, 5)), false)
})

test('C3 the 04:00 boundary closes the first peak window', () => {
  assert.equal(isPeak(U(9, 3, 59)), true)
  assert.equal(isPeak(U(9, 4, 0)), false)
})

test('C4 the 10:00 boundary closes the second peak window', () => {
  assert.equal(isPeak(U(9, 9, 59)), true)
  assert.equal(isPeak(U(9, 10, 0)), false)
})

test('C5 weekends are off-peak all day', () => {
  assert.equal(isPeak(U(8, 2)), false, 'Sunday 02:00')
  assert.equal(isPeak(U(7, 9)), false, 'Saturday 09:00')
})

test('C6 from inside the first window the switch is its 04:00 end', () => {
  assert.equal(nextSwitch(U(9, 2, 30)), U(9, 4))
})

test('C7 from the 05:00 gap the switch is the 06:00 start', () => {
  assert.equal(nextSwitch(U(9, 5)), U(9, 6))
})

test('C8 from inside the second window the switch is its 10:00 end', () => {
  assert.equal(nextSwitch(U(9, 9, 30)), U(9, 10))
})

test('C9 from Friday 10:00 the next switch is Monday 01:00', () => {
  assert.equal(nextSwitch(U(13, 10)), U(16, 1))
})

test('C10 from Saturday noon the next switch is Monday 01:00', () => {
  assert.equal(nextSwitch(U(14, 12)), U(16, 1))
})

test('C11 from Sunday 23:00 the next switch is Monday 01:00', () => {
  assert.equal(nextSwitch(U(15, 23)), U(16, 1))
})

test('C12 every switch is in the future and flips the state exactly then', () => {
  const samples = [
    U(9, 0, 5), U(9, 3, 59), U(9, 4, 0), U(9, 5), U(9, 9), U(9, 10),
    U(13, 9, 30), U(14, 0), U(15, 23, 59), U(16, 0), U(16, 6),
  ]
  for (const now of samples) {
    const at = nextSwitch(now)
    assert.ok(at !== null, `expected a switch for ${new Date(now).toISOString()}`)
    assert.ok(at > now, 'switch is in the future')
    assert.notEqual(isPeak(at), isPeak(now), 'the switch flips the state')
  }
})

test('C13 formatCountdown matches the status-line shape', () => {
  assert.equal(formatCountdown((40 * 60 + 33) * 60 * 1000), '40h33m')
  assert.equal(formatCountdown(2 * 60 * 60 * 1000), '2h00m')
  assert.equal(formatCountdown(59 * 60 * 1000 + 30 * 1000), '59m30s')
  assert.equal(formatCountdown(0), '0m00s')
  assert.equal(formatCountdown(-5), '0m00s')
})
