/**
 * Test harness for the browser-only client module.
 *
 * `client.js` is a single-file browser artifact: it calls
 * `window.__ModuleLoader__.load({ id, factory })` at evaluation time and its
 * factory receives a minimal `require`. We evaluate it inside a `node:vm`
 * context with a fake window, capture the factory, and hand it a React stub so
 * its pure exports (`__internals`) can be unit tested without a DOM.
 *
 * No dependency is added: Node's built-in test runner and `node:vm` only.
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Deterministic timezone for local-day assertions. Node on Linux re-reads TZ
// at runtime; every test file that needs it imports this module before
// constructing dates.
process.env.TZ = 'Asia/Shanghai'

const CLIENT_PATH = new URL('../client.js', import.meta.url)

/**
 * Minimal React surface used by the module factory at materialization time.
 * Components are never rendered; tests exercise the exported pure functions.
 */
function createReactStub() {
  const memo = (component) => component
  const createElement = (type, props, ...children) => ({ type, props, children })
  const useState = (initial) => {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  }
  const useEffect = () => {}
  const useMemo = (factory) => factory()
  const useRef = (initial) => ({ current: initial })
  const useSyncExternalStore = (subscribe, getSnapshot) => getSnapshot()
  return {
    createElement,
    memo,
    useState,
    useEffect,
    useMemo,
    useRef,
    useSyncExternalStore,
    Fragment: Symbol.for('react.fragment'),
  }
}

/**
 * Evaluate client.js and materialize its factory.
 * @returns {{ plugin: any, internals: any, ReactStub: any }}
 */
export function loadClient() {
  let code
  try {
    code = readFileSync(CLIENT_PATH, 'utf8')
  } catch {
    throw new Error('client.js not found yet — write the tests first, then implement')
  }

  let registered
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(module) {
          registered = module
        },
      },
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: 'client.js' })

  if (registered === undefined) {
    throw new Error('client.js did not call window.__ModuleLoader__.load')
  }
  if (typeof registered.factory !== 'function') {
    throw new Error('registered module has no factory')
  }

  const ReactStub = createReactStub()
  const plugin = registered.factory((id) => {
    if (id === 'react') return ReactStub
    throw new Error(`unexpected require in client factory: ${id}`)
  })

  if (!plugin || typeof plugin.apply !== 'function') {
    throw new Error('factory result has no apply(ctx)')
  }
  if (!plugin.__internals) {
    throw new Error('factory result exposes no __internals for tests')
  }
  return { plugin, internals: plugin.__internals, ReactStub }
}

/** Shared Chinese translator stub used by view-model tests. */
export function createTranslator(overrides = {}) {
  const dict = {
    balance: '余额',
    today: '今日',
    offPeak: '谷',
    peak: '峰',
    rechargeBalance: '充值余额',
    bonusBalance: '赠送余额',
    clickHint: '点击打开用量页',
    nextSwitchNote: '距下次价目切换',
    sinceInstallSuffix: '（自首次读取起算）',
    toppedUpNote: '今日含充值，估算已重置',
    accountUnavailable: '账号余额暂不可用',
    errorTitle: '余额读取失败',
    missingKey: '未配置',
    missingKeyTitle: '未找到 DEEPSEEK_API_KEY，请在 设置 → 模型 里配置',
    loadingNote: '读取中',
    loadingTitle: '正在读取余额',
    ...overrides,
  }
  return (key, params) => {
    let text = dict[key] ?? key
    for (const [name, value] of Object.entries(params ?? {})) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
    return text
  }
}
