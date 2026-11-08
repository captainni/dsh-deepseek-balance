import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { loadClient } from './harness.mjs'

const ROOT = new URL('../', import.meta.url)
const readJson = (relative) => JSON.parse(readFileSync(new URL(relative, ROOT), 'utf8'))
const readText = (relative) => readFileSync(new URL(relative, ROOT), 'utf8')

const { plugin, internals } = loadClient()
const { NS } = internals

test('F1 the plugin injects the services it uses and nothing optional', () => {
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale'])
})

test('F2 apply registers both locale dictionaries through ctx.effect', () => {
  const registered = []
  const effects = []
  const ctx = {
    effect(factory, label) {
      effects.push(label)
      return factory()
    },
    locale: {
      register(namespace, locale, dict) {
        registered.push({ namespace, locale, dict })
        return () => {}
      },
    },
    slots: { inject() {}, register() {} },
  }
  plugin.apply(ctx)
  assert.deepEqual(registered.map((entry) => entry.locale), ['zh', 'en'])
  assert.ok(registered.every((entry) => entry.namespace === NS))
  assert.ok(effects.length >= 2)
})

test('F3 apply seats one cell in the composer dock with the planned order', () => {
  let injectedSlot = null
  let registration = null
  const ctx = {
    effect: (factory) => factory(),
    locale: { register: () => () => {} },
    slots: {
      inject(slot, callback) {
        injectedSlot = slot
        callback()
      },
      register(options, component) {
        registration = { options, component }
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  assert.equal(injectedSlot, 'conversation.composer.dock')
  assert.equal(registration.options.name, 'conversation.composer.dock')
  assert.equal(registration.options.id, NS)
  assert.equal(registration.options.order, 9)
  assert.equal(registration.options.locale, NS)
  assert.equal(typeof registration.component, 'function')
})

test('F4 the manifest declares the bundle patch, the web client half and every shipped file', () => {
  const pkg = readJson('package.json')
  assert.equal(pkg.name, '@local/dsh-deepseek-balance')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-ui-conversation'])
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.exports['./icon'], './icon.svg')

  const covers = (file) =>
    pkg.files.some((entry) => {
      if (entry === file) return true
      if (!entry.includes('*')) return false
      const pattern = new RegExp(
        `^${entry
          .split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('[^/]*')}$`,
      )
      return pattern.test(file)
    })
  for (const file of ['index.js', 'client.js', 'cordis.patch.yml', 'locale/zh.json', 'locale/en.json', 'icon.svg']) {
    assert.ok(covers(file), `files must include ${file}`)
  }
})

test('F5 the patch inserts exactly this plugin row', () => {
  const yaml = readText('cordis.patch.yml')
  assert.match(yaml, /- insert:/)
  assert.match(yaml, /id: deepseek-balance/)
  assert.match(yaml, /name: '@local\/dsh-deepseek-balance'/)
})

test('F6 both locale files expose real metadata and both dictionaries are complete', () => {
  const zh = readJson('locale/zh.json')
  const en = readJson('locale/en.json')
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  assert.deepEqual(Object.keys(zh.meta).sort(), ['description', 'title'])
  assert.ok(zh.meta.title.length > 0)
  assert.ok(zh.meta.description.length > 0)
  assert.ok(en.meta.title.length > 0)
  assert.ok(en.meta.description.length > 0)

  assert.deepEqual(Object.keys(internals.ZH).sort(), Object.keys(internals.EN).sort())
  for (const key of [
    'balance',
    'today',
    'offPeak',
    'peak',
    'rechargeBalance',
    'bonusBalance',
    'clickHint',
    'nextSwitchNote',
    'sinceInstallSuffix',
    'toppedUpNote',
    'accountUnavailable',
    'errorTitle',
    'missingKey',
    'missingKeyTitle',
    'loadingNote',
    'loadingTitle',
  ]) {
    assert.ok(Object.hasOwn(internals.ZH, key), `zh dictionary missing ${key}`)
    assert.ok(Object.hasOwn(internals.EN, key), `en dictionary missing ${key}`)
  }
})

test('F7 the bundled icon is a small, valid SVG', () => {
  const svg = readText('icon.svg')
  assert.ok(svg.trimStart().startsWith('<svg'), 'icon must start with <svg')
  assert.ok(svg.includes('viewBox='), 'icon must declare a viewBox')
  assert.ok(statSync(new URL('icon.svg', ROOT)).size < 256 * 1024)
})

test('F8 the plugin publishes a read-only diagnostics provider through cordisInspect', async () => {
  let captured = null
  const ctx = {
    effect: (factory) => factory(),
    locale: { register: () => () => {} },
    slots: { inject() {}, register() {} },
    inject(dependencies, callback) {
      if (!dependencies.includes('cordisInspect')) return
      callback({
        cordisInspect: {
          register(registration) {
            captured = registration
            return () => {}
          },
        },
        effect: (factory) => factory(),
      })
    },
  }
  plugin.apply(ctx)
  assert.ok(captured !== null, 'diagnostics provider must be registered')
  assert.equal(captured.manifest.id, 'deepseek-balance-debug')
  const state = await captured.query('state', {})
  assert.equal(state.route, '/dsh-balance/summary')
  assert.equal(typeof state.renders, 'number')
})

test('F9 the Host half declares its services and serves the summary route', () => {
  const host = readText('index.js')
  assert.match(host, /export const inject = \['credentials', 'webServer'\]/)
  assert.match(host, /\/dsh-balance\/summary/)
  assert.match(host, /api\.deepseek\.com\/user\/balance/)
  assert.match(host, /DEEPSEEK_API_KEY/)
})
