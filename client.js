/**
 * DeepSeek balance status cell for the Harness Web composer.
 *
 * The browser only renders a small JSON reading served by this bundle's Host
 * half (`/dsh-deepseek-balance/summary`): the API key stays on the Host and is
 * never shipped to the page.
 *
 * The pure logic and the state controller are exposed through `__internals`
 * so `test/` can exercise them in Node without a DOM (see `test/harness.mjs`).
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-deepseek-balance',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'deepseek-balance'
    const VERSION = '1.2.0'
    const SLOT = 'conversation.composer.dock'
    const ROUTE = '/dsh-balance/summary'
    const USAGE_URL = 'https://platform.deepseek.com/usage'
    const STORAGE_KEY = 'dsh-deepseek-balance:v1:observation'
    const THRESHOLDS = { warn: 5, error: 1 }
    /** Live state mirrored for the `deepseek-balance-debug` inspect provider. */
    const DIAG = { mounts: 0, renders: 0, last: null, errors: [] }

    const COLOR = {
      ok: 'var(--dsw-alias-label-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      error: 'var(--dsw-alias-state-error-primary)',
    }

    const ZH = {
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
    }

    const EN = {
      balance: 'Balance',
      today: 'Today',
      offPeak: 'Off-peak',
      peak: 'Peak',
      rechargeBalance: 'Recharge balance',
      bonusBalance: 'Bonus balance',
      clickHint: 'Click to open usage',
      nextSwitchNote: 'until the next price switch',
      sinceInstallSuffix: ' (since first read)',
      toppedUpNote: 'Top-up detected today; the estimate was reset',
      accountUnavailable: 'Account balance unavailable',
      errorTitle: 'Balance unavailable',
      missingKey: 'not configured',
      missingKeyTitle: 'DEEPSEEK_API_KEY is missing; configure it in Settings -> Models',
      loadingNote: 'loading',
      loadingTitle: 'Reading the balance',
    }

    const CSS = [
      '.dsb-anchor{display:inline-flex;align-items:center;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));}',
      '.dsb-cell,.dsb-link{display:inline-flex;align-items:center;gap:8px;padding:1px 8px;border-radius:6px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;}',
      '.dsb-link{text-decoration:none;}',
      '.dsb-link:hover,.dsb-link:focus-visible{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);outline:none;}',
      '.dsb-seg{display:inline-flex;align-items:center;}',
      '.dsb-sep{display:inline-block;width:1px;height:10px;background:var(--dsw-alias-border-l1);}',
    ].join('')

    // ---------------------------------------------------------------------
    // Pure logic
    // ---------------------------------------------------------------------

    function currencySymbol(currency) {
      return currency === 'USD' ? '$' : '¥'
    }

    /** Format one balance string, or null when it is not a number. */
    function formatMoney(currency, raw) {
      if (raw === null || raw === undefined) return null
      const text = String(raw).trim()
      if (text === '') return null
      const amount = Number(text)
      if (!Number.isFinite(amount)) return null
      return `${currencySymbol(currency)}${amount.toFixed(2)}`
    }

    function walletAmount(wallet, field) {
      const amount = Number(wallet[field])
      return Number.isFinite(amount) ? amount : 0
    }

    /**
     * Choose the currency shown as the main number from the Host-normalized
     * wallet list. CNY wins when present; other currencies only ride the
     * tooltip.
     */
    function pickWallet(wallets) {
      if (!Array.isArray(wallets)) return null
      const valid = wallets.filter(
        (wallet) =>
          wallet !== null &&
          typeof wallet === 'object' &&
          (wallet.currency === 'CNY' || wallet.currency === 'USD') &&
          Number.isFinite(Number(wallet.total)),
      )
      if (valid.length === 0) return null
      const primary = valid.find((wallet) => wallet.currency === 'CNY') ?? valid[0]
      return {
        currency: primary.currency,
        total: walletAmount(primary, 'total'),
        granted: walletAmount(primary, 'granted'),
        toppedUp: walletAmount(primary, 'toppedUp'),
        others: valid
          .filter((wallet) => wallet !== primary)
          .map((wallet) => ({ currency: wallet.currency, total: walletAmount(wallet, 'total') })),
      }
    }

    function balanceLevel(amount) {
      if (!Number.isFinite(amount)) return 'error'
      if (amount < THRESHOLDS.error) return 'error'
      if (amount < THRESHOLDS.warn) return 'warn'
      return 'ok'
    }

    /** Local calendar key, so "today" follows the user's clock, not UTC. */
    function localDay(now) {
      const date = new Date(now)
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${date.getFullYear()}-${month}-${day}`
    }

    function isObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    /**
     * Roll the balance-observation store forward and report today's estimate.
     *
     * The estimate is the difference between the last balance observed before
     * local midnight and the current total; a balance increase is treated as a
     * top-up (a reset), never as negative spend.
     */
    function todaySpend(store, observation, now) {
      const safe = isObject(store) ? store : {}
      const last = isObject(safe.last) ? safe.last : null
      let baseline = isObject(safe.baseline) ? safe.baseline : null
      const day = localDay(now)
      const current = observation.total
      const currency = observation.currency

      let sinceInstall = false
      if (!baseline || baseline.day !== day || baseline.currency !== currency) {
        const lastMatches = last !== null && last.currency === currency && Number.isFinite(last.total)
        const baseTotal = lastMatches ? last.total : current
        sinceInstall = !lastMatches
        baseline = { day, total: baseTotal, currency, toppedUp: false }
      }

      let toppedUp = baseline.toppedUp === true
      if (current > baseline.total) {
        baseline = { day, total: current, currency, toppedUp: true }
        toppedUp = true
      }

      return {
        store: {
          last: { at: observation.at, day, total: current, currency },
          baseline: { ...baseline, toppedUp },
        },
        spend: Math.max(0, baseline.total - current),
        sinceInstall,
        toppedUp,
      }
    }

    /**
     * Official pricing windows: peak is 01:00-04:00 and 06:00-10:00 UTC,
     * Monday through Friday; everything else (weekends included) is off-peak.
     * Chinese public holidays are not modelled.
     */
    const PEAK_WINDOWS_UTC = [
      [1, 4],
      [6, 10],
    ]

    function isPeak(now) {
      const date = new Date(now)
      const weekday = date.getUTCDay()
      if (weekday < 1 || weekday > 5) return false
      const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600
      return PEAK_WINDOWS_UTC.some(([start, end]) => hour >= start && hour < end)
    }

    /** Next instant whose peak/off-peak state differs from `now`. */
    function nextSwitch(now) {
      const currentPeak = isPeak(now)
      const base = new Date(now)
      const year = base.getUTCFullYear()
      const month = base.getUTCMonth()
      const date = base.getUTCDate()
      let best = null
      for (let offset = 0; offset <= 9; offset += 1) {
        for (const [start, end] of PEAK_WINDOWS_UTC) {
          for (const hour of [start, end]) {
            const at = Date.UTC(year, month, date + offset, hour, 0, 0, 0)
            if (at <= now) continue
            if (isPeak(at) === currentPeak) continue
            if (best === null || at < best) best = at
          }
        }
      }
      return best
    }

    function formatCountdown(milliseconds) {
      const seconds = Math.floor(Math.max(0, milliseconds) / 1000)
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      const rest = seconds % 60
      if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}m`
      return `${minutes}m${String(rest).padStart(2, '0')}s`
    }

    function statusShouldRefresh(previousRunning, running) {
      return previousRunning === true && running === false
    }

    /**
     * What the status-line clock tick should do: start a new day's estimate at
     * local midnight, and keep retrying while the Host route is not answering
     * yet (the first seconds after a page load).
     */
    function tickAction(state, now) {
      if (!state) return 'none'
      if (state.status === 'loading' || state.status === 'error' || state.status === 'missing-key') return 'refresh'
      if (state.status !== 'ready') return 'none'
      if (state.fetchedAt === null) return 'refresh'
      if (localDay(now) !== localDay(state.fetchedAt)) return 'refresh'
      return now - state.fetchedAt >= 60000 ? 'refresh' : 'none'
    }

    function messageOf(value) {
      if (!value) return null
      if (typeof value === 'string') return value
      if (typeof value.message === 'string') return value.message
      return null
    }

    function readStorage(storage, key) {
      if (!storage) return null
      try {
        const raw = storage.getItem(key)
        if (raw === null || raw === undefined || raw === '') return null
        const parsed = JSON.parse(raw)
        return isObject(parsed) ? parsed : null
      } catch {
        return null
      }
    }

    function writeStorage(storage, key, value) {
      if (!storage) return
      try {
        storage.setItem(key, JSON.stringify(value))
      } catch {
        /* a full or denied store only costs the estimate */
      }
    }

    /** Reject a hung Host call so the cell can show an error instead of loading forever. */
    function withTimeout(promise, milliseconds, message) {
      if (!Number.isFinite(milliseconds) || milliseconds <= 0) return promise
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), milliseconds)
        Promise.resolve(promise).then(
          (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          (error) => {
            clearTimeout(timer)
            reject(error)
          },
        )
      })
    }

    // ---------------------------------------------------------------------
    // Balance controller
    // ---------------------------------------------------------------------

    function createBalanceController(options) {
      const { fetchSummary, storage, now } = options
      const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 10000
      let state = {
        status: 'loading',
        primary: undefined,
        spend: null,
        toppedUp: false,
        sinceInstall: false,
        isAvailable: true,
        error: null,
        fetchedAt: null,
      }
      const listeners = new Set()
      let generation = 0
      let disposed = false

      function publish(next) {
        if (disposed) return
        state = next
        for (const listener of listeners) {
          try {
            listener()
          } catch {
            /* one broken subscriber must not break the cell */
          }
        }
      }

      function getSnapshot() {
        return state
      }

      function subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }

      function dispose() {
        disposed = true
        listeners.clear()
      }

      async function refresh() {
        if (disposed) return
        const at = now()
        const run = generation + 1
        generation = run
        if (typeof fetchSummary !== 'function') {
          publish({ ...state, status: 'error', error: 'balance source unavailable' })
          return
        }

        let summary
        try {
          summary = await withTimeout(fetchSummary(), timeoutMs, 'balance request timed out')
        } catch (error) {
          if (disposed || run !== generation) return
          publish({ ...state, status: 'error', error: messageOf(error) })
          return
        }
        if (disposed || run !== generation) return

        if (!summary || summary.ok !== true) {
          const error = messageOf(summary && summary.error) || 'balance request failed'
          if (summary && summary.error === 'missing_api_key') {
            publish({ ...state, status: 'missing-key', error })
            return
          }
          publish({ ...state, status: 'error', error })
          return
        }

        const primary = pickWallet(summary.wallets)
        if (!primary) {
          publish({ ...state, status: 'error', error: 'no wallet returned' })
          return
        }

        const fetchedAt = Number.isFinite(summary.fetchedAt) ? summary.fetchedAt : at
        const stored = readStorage(storage, STORAGE_KEY)
        const outcome = todaySpend(
          stored,
          { at: fetchedAt, total: primary.total, currency: primary.currency },
          at,
        )
        writeStorage(storage, STORAGE_KEY, outcome.store)

        publish({
          status: 'ready',
          primary,
          spend: outcome.spend,
          toppedUp: outcome.toppedUp,
          sinceInstall: outcome.sinceInstall,
          isAvailable: summary.isAvailable !== false,
          error: null,
          fetchedAt,
        })
      }

      return { refresh, subscribe, getSnapshot, dispose }
    }

    // ---------------------------------------------------------------------
    // View model
    // ---------------------------------------------------------------------

    function buildViewModel(input) {
      const { state, now, t } = input || {}
      if (!state) return { hidden: true }

      if (state.status === 'loading') {
        return {
          hidden: false,
          href: null,
          segments: [{ key: 'balance', text: `${t('balance')} ${t('loadingNote')}` }],
          title: t('loadingTitle'),
          ariaLabel: `${t('balance')} ${t('loadingNote')}`,
        }
      }
      if (state.status === 'missing-key') {
        return {
          hidden: false,
          href: null,
          segments: [{ key: 'balance', text: `${t('balance')} ${t('missingKey')}` }],
          title: t('missingKeyTitle'),
          ariaLabel: `${t('balance')} ${t('missingKey')}`,
        }
      }
      if (state.status === 'error') {
        return {
          hidden: false,
          href: null,
          segments: [{ key: 'balance', text: `${t('balance')} —` }],
          title: `${t('errorTitle')}${state.error ? `\n${state.error}` : ''}`,
          ariaLabel: `${t('balance')} —`,
        }
      }

      const primary = state.primary
      if (!primary) return { hidden: true }

      const currency = primary.currency
      const money = (raw) => formatMoney(currency, raw) ?? '—'
      const balanceMoney = money(primary.total)
      const spendMoney = money(state.spend ?? 0)
      const color = COLOR[balanceLevel(primary.total)] ?? COLOR.ok

      const peak = isPeak(now)
      const switchAt = nextSwitch(now)
      const countdown = switchAt === null ? null : formatCountdown(switchAt - now)
      const windowLabel = peak ? t('peak') : t('offPeak')

      const segments = [
        { key: 'balance', text: `${t('balance')} ${balanceMoney}`, color },
        {
          key: 'today',
          text: `${t('today')} ${spendMoney}${state.sinceInstall ? t('sinceInstallSuffix') : ''}`,
        },
      ]
      if (countdown !== null) {
        segments.push({ key: 'window', text: `${windowLabel} ${countdown}` })
      }

      const titleLines = [
        `${t('rechargeBalance')} ${money(primary.toppedUp)}`,
        `${t('bonusBalance')} ${money(primary.granted)}`,
        `${t('today')} ${spendMoney}${state.sinceInstall ? t('sinceInstallSuffix') : ''}`,
      ]
      if (state.toppedUp) titleLines.push(t('toppedUpNote'))
      if (state.isAvailable === false) titleLines.push(t('accountUnavailable'))
      for (const other of primary.others ?? []) {
        const otherMoney = formatMoney(other.currency, other.total)
        if (otherMoney !== null) titleLines.push(otherMoney)
      }
      if (countdown !== null) titleLines.push(`${windowLabel} ${countdown} · ${t('nextSwitchNote')}`)
      titleLines.push(t('clickHint'))

      return {
        hidden: false,
        href: USAGE_URL,
        segments,
        title: titleLines.join('\n'),
        ariaLabel: segments.map((segment) => segment.text).join('，'),
      }
    }

    // ---------------------------------------------------------------------
    // React cell
    // ---------------------------------------------------------------------

    function browserStorage() {
      try {
        return globalThis.localStorage ?? null
      } catch {
        return null
      }
    }

    async function readSummary() {
      const response = await fetch(ROUTE, {
        method: 'GET',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
      })
      let body = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      if (body !== null && typeof body === 'object') return body
      return { ok: false, error: `http_${response.status}` }
    }

    function makeBalanceCell(ctx) {
      return function BalanceCell(props) {
        const { useSessionStatus, useProjection, sessionId, t } = props
        const controller = React.useMemo(
          () =>
            createBalanceController({
              fetchSummary: readSummary,
              storage: browserStorage(),
              now: () => Date.now(),
            }),
          [],
        )
        const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot)
        const running = useSessionStatus((map) => {
          const entry = map && typeof map.get === 'function' ? map.get(sessionId) : undefined
          return entry !== undefined && entry.running === true
        })
        DIAG.renders += 1
        DIAG.last = {
          status: state.status,
          error: state.error,
          primary: state.primary ?? null,
          spend: state.spend,
          fetchedAt: state.fetchedAt,
          running: running === true,
          hasT: typeof t === 'function',
          hasSessionId: sessionId !== undefined && sessionId !== null,
        }
        const previousRunning = React.useRef(undefined)
        const [now, setNow] = React.useState(() => Date.now())

        React.useEffect(() => {
          const timer = setInterval(() => setNow(Date.now()), 30000)
          return () => clearInterval(timer)
        }, [])

        React.useEffect(() => {
          DIAG.mounts += 1
          controller.refresh()
          return () => controller.dispose()
        }, [controller])

        React.useEffect(() => {
          if (statusShouldRefresh(previousRunning.current, running)) controller.refresh()
          previousRunning.current = running
        }, [running, controller])

        // A settle step is the durable signal that a turn spent tokens.
        const stats = typeof useProjection === 'function' ? useProjection('sessionStats') : undefined
        const settledSteps = stats && typeof stats.steps === 'number' ? stats.steps : 0
        const previousSteps = React.useRef(settledSteps)
        React.useEffect(() => {
          if (settledSteps === previousSteps.current) return
          previousSteps.current = settledSteps
          controller.refresh()
        }, [settledSteps, controller])

        React.useEffect(() => {
          if (tickAction({ status: state.status, fetchedAt: state.fetchedAt }, now) === 'refresh') {
            controller.refresh()
          }
        }, [now, state.status, state.fetchedAt, controller])

        let view
        try {
          view = buildViewModel({ state, now, t: typeof t === 'function' ? t : (key) => key })
        } catch (error) {
          DIAG.errors.push(String(error && error.message ? error.message : error))
          return null
        }
        if (!view || view.hidden) return null

        const children = []
        view.segments.forEach((segment, index) => {
          if (index > 0) {
            children.push(h('span', { key: `sep-${index}`, className: 'dsb-sep', 'aria-hidden': true }))
          }
          children.push(
            h(
              'span',
              {
                key: segment.key,
                className: 'dsb-seg',
                style: segment.color === undefined ? undefined : { color: segment.color },
              },
              segment.text,
            ),
          )
        })

        const content =
          view.href === null
            ? h('span', { className: 'dsb-cell', title: view.title, 'aria-label': view.ariaLabel }, children)
            : h(
                'a',
                {
                  className: 'dsb-link',
                  href: view.href,
                  target: '_blank',
                  rel: 'noreferrer',
                  title: view.title,
                  'aria-label': view.ariaLabel,
                },
                children,
              )

        return h(
          React.Fragment,
          null,
          h('style', { key: 'dsb-css', 'data-dsb': '' }, CSS),
          h('span', { key: 'dsb-root', className: 'dsb-anchor' }, content),
        )
      }
    }

    // ---------------------------------------------------------------------
    // Diagnostics (read-only Cordis inspect provider)
    // ---------------------------------------------------------------------

    function diagnosticsSnapshot() {
      return {
        version: VERSION,
        now: Date.now(),
        route: ROUTE,
        origin: typeof location === 'undefined' ? null : location.origin,
        pathname: typeof location === 'undefined' ? null : location.pathname,
        mounts: DIAG.mounts,
        renders: DIAG.renders,
        last: DIAG.last,
        errors: DIAG.errors.slice(-5),
      }
    }

    function registerDiagnostics(ctx) {
      if (typeof ctx.inject !== 'function') return
      ctx.inject(['cordisInspect'], (inspectCtx) => {
        const inspect = inspectCtx.cordisInspect
        if (!inspect || typeof inspect.register !== 'function') return
        inspectCtx.effect(
          () =>
            inspect.register({
              manifest: {
                id: 'deepseek-balance-debug',
                description: 'Read-only diagnostics for the DeepSeek balance status cell.',
                methods: [
                  {
                    name: 'state',
                    description: 'Return the live cell state, the fetch route, and any recorded render errors.',
                  },
                ],
              },
              query: async (method) => {
                if (method !== 'state') throw new Error(`unknown diagnostics method "${method}"`)
                return diagnosticsSnapshot()
              },
            }),
          'deepseek-balance: inspect provider',
        )
      })
    }

    // ---------------------------------------------------------------------
    // Plugin
    // ---------------------------------------------------------------------

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'deepseek-balance: locale zh')
      ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'deepseek-balance: locale en')
      ctx.slots.inject(SLOT, () =>
        ctx.slots.register({ name: SLOT, id: NS, order: 9, locale: NS }, makeBalanceCell(ctx)),
      )
      try {
        registerDiagnostics(ctx)
      } catch (error) {
        DIAG.errors.push(String(error && error.message ? error.message : error))
      }
    }

    return {
      name: NS,
      inject: ['slots', 'locale'],
      apply,
      __internals: {
        NS,
        VERSION,
        ROUTE,
        USAGE_URL,
        THRESHOLDS,
        STORAGE_KEY,
        ZH,
        EN,
        formatMoney,
        pickWallet,
        balanceLevel,
        localDay,
        todaySpend,
        isPeak,
        nextSwitch,
        formatCountdown,
        statusShouldRefresh,
        tickAction,
        buildViewModel,
        createBalanceController,
      },
    }
  },
})
