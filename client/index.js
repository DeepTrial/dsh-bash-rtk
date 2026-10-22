// Browser half of @deeptrial/dsh-bash-rtk: a composer-dock pill showing rtk's
// token savings for the current session's workspace, with the ledger detail in
// a dialog on click. Self-contained loader-factory bundle: only `react` and
// fetch are used, no build step (mirrors third-party dsh client plugins).
window.__ModuleLoader__.load({
  id: '@deeptrial/dsh-bash-rtk',
  factory: (require) => {
    const React = require('react')

    /** Fetch the stats JSON once, then poll while the pill is mounted. */
    function useStats(sessionId) {
      const [state, setState] = React.useState(null)
      React.useEffect(() => {
        if (!sessionId) return undefined
        let live = true
        const load = () => {
          fetch('/rtk/stats?sessionId=' + encodeURIComponent(sessionId))
            .then((response) => (response.ok ? response.json() : null))
            .then((body) => {
              if (live) setState(body)
            })
            .catch(() => {})
        }
        load()
        const timer = setInterval(load, 15000)
        return () => {
          live = false
          clearInterval(timer)
        }
      }, [sessionId])
      return state
    }

    /** Show the text report in a native modal dialog with every dismissal path. */
    function showDetail(sessionId) {
      fetch('/rtk/stats?sessionId=' + encodeURIComponent(sessionId) + '&detail=1')
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => {
          const dialog = document.createElement('dialog')
          dialog.style.cssText =
            'width:min(560px,90vw);max-height:70vh;padding:0;border:1px solid var(--dsw-alias-border-l2);' +
            'border-radius:12px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);overflow:hidden'

          const header = document.createElement('div')
          header.style.cssText =
            'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 8px 8px 16px;' +
            'border-bottom:1px solid var(--dsw-alias-border-l2)'
          const title = document.createElement('span')
          title.textContent = 'rtk savings'
          title.style.cssText = 'font-size:13px;font-weight:500'
          const close = document.createElement('button')
          close.type = 'button'
          close.textContent = '×'
          close.setAttribute('aria-label', 'Close')
          close.style.cssText =
            'border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;' +
            'font-size:18px;line-height:24px;width:28px;height:28px;border-radius:6px'
          close.addEventListener('click', () => dialog.close())
          header.append(title, close)

          const pre = document.createElement('pre')
          pre.style.cssText = 'margin:0;padding:16px;overflow:auto;font-size:12px;line-height:18px;white-space:pre-wrap'
          pre.textContent = body && body.ok ? body.text : 'rtk gain failed'

          dialog.append(header, pre)
          // DSH's global shortcut handling can swallow the native Escape default,
          // so every dismissal path closes explicitly; the × button always works.
          dialog.addEventListener('cancel', (event) => {
            event.preventDefault()
            dialog.close()
          })
          dialog.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            dialog.close()
          })
          dialog.addEventListener('click', (event) => {
            if (event.target === dialog) dialog.close()
          })
          dialog.addEventListener('close', () => dialog.remove())

          document.body.append(dialog)
          dialog.showModal()
          close.focus()
        })
        .catch(() => {})
    }

    function RtkPill({ sessionId }) {
      const stats = useStats(sessionId)
      if (!stats || stats.ok !== true || stats.summary === undefined) return null
      const summary = stats.summary
      const label = 'rtk'
      const title = 'rtk saved ' + String(summary.total_saved) + ' tokens over ' + String(summary.total_commands) + ' commands'
      return React.createElement(
        'button',
        {
          type: 'button',
          'data-composer-stat': 'rtk',
          title,
          onClick: () => showDetail(sessionId),
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            border: 'none',
            background: 'transparent',
            padding: '0 2px',
            color: 'var(--dsw-alias-label-tertiary)',
            cursor: 'pointer',
            fontSize: '12px',
            lineHeight: '20px',
          },
        },
        label,
      )
    }

    const inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register(
          {
            name: 'conversation.composer.dock',
            id: 'rtk-savings',
            order: 2,
            inject: (sessionId) => ({ sessionId }),
          },
          RtkPill,
        ),
      )
    }

    return { apply, inject }
  },
})
