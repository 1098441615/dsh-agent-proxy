window.__ModuleLoader__.load({
  id: 'dsh-agent-proxy',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-agent-proxy';
    const API = '/api/dsh-agent-proxy';

    const ZH = {
      title: '代理',
      rowTitle: '代理 dsh',
      rowHint: 'dsh 使用 git 等工具超时时可开启代理',
      loading: '读取中…',
      viaSystem: 'Windows 系统代理',
      viaConfig: '配置中的代理',
      viaEnv: '环境变量中的代理',
      current: '当前代理',
      noProxy: '未检测到系统代理，请先打开代理软件的系统代理，或在插件配置里填写 proxyUrl',
      loadFailed: '读取代理状态失败',
      toggleFailed: '切换失败',
      saveFailed: '已生效，但没能写入配置，重启后会恢复为关闭',
    };

    const EN = {
      title: 'Proxy',
      rowTitle: 'Proxy for dsh',
      rowHint: 'Turn this on when git and other tools keep timing out',
      loading: 'Loading…',
      viaSystem: 'Windows system proxy',
      viaConfig: 'proxy from config',
      viaEnv: 'proxy from environment',
      current: 'Current proxy',
      noProxy: 'No system proxy detected. Turn on your proxy client system proxy, or set proxyUrl in the plugin config.',
      loadFailed: 'Failed to read the proxy state',
      toggleFailed: 'Failed to switch',
      saveFailed: 'Applied, but the setting could not be saved; it reverts to off after a restart',
    };

    const styles = {
      card: {
        border: '1px solid var(--dsw-alias-border-l2, #e3e6eb)',
        background: 'var(--dsw-alias-bg-layer-3, #ffffff)',
        borderRadius: '12px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        boxSizing: 'border-box',
      },
      row: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '16px',
      },
      text: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        minWidth: 0,
      },
      rowTitle: {
        fontSize: '14px',
        fontWeight: 500,
        lineHeight: 1.4,
        color: 'var(--dsw-alias-label-primary, #1f2329)',
      },
      hint: {
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-label-tertiary, #6b7280)',
      },
      detail: {
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-label-secondary, #57606a)',
        wordBreak: 'break-all',
      },
      warn: {
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-label-warning, #9a6700)',
      },
      bad: {
        fontSize: '12px',
        lineHeight: 1.5,
        color: 'var(--dsw-alias-label-danger, #cf222e)',
      },
    };

    function Switch({ checked, disabled, label, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked ? 'true' : 'false',
          'aria-label': label,
          'aria-busy': disabled ? 'true' : 'false',
          disabled: disabled,
          onClick: onChange,
          style: {
            position: 'relative',
            flex: 'none',
            width: '44px',
            height: '24px',
            padding: 0,
            border: 'none',
            borderRadius: '999px',
            cursor: disabled ? 'default' : 'pointer',
            background: checked
              ? 'var(--dsw-alias-state-business-primary, #4f8cff)'
              : 'var(--dsw-alias-bg-layer-2, #e9ecf2)',
            opacity: disabled ? 0.65 : 1,
            transition: 'background .16s',
          },
        },
        h('span', {
          'aria-hidden': true,
          style: {
            position: 'absolute',
            top: '2px',
            left: checked ? '22px' : '2px',
            width: '20px',
            height: '20px',
            borderRadius: '50%',
            background: '#ffffff',
            boxShadow: '0 1px 2px rgba(0, 0, 0, .22)',
            transition: 'left .16s',
          },
        }),
      );
    }

    function AgentProxySection({ t }) {
      const [state, setState] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [message, setMessage] = React.useState(null);

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(`${API}/state`, {
            headers: { accept: 'application/json' },
            credentials: 'same-origin',
          });
          const body = await response.json();
          if (!body || body.ok !== true || !body.data) throw new Error(body && body.error ? body.error : 'bad response');
          setState(body.data);
          setMessage(null);
        } catch (error) {
          setMessage({ kind: 'bad', text: t('loadFailed') });
        }
      }, [t]);

      React.useEffect(() => {
        load();
      }, [load]);

      const toggle = async () => {
        if (busy) return;
        setBusy(true);
        setMessage(null);
        try {
          const next = !(state && state.enabled);
          const response = await fetch(`${API}/toggle`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'x-dsh-agent-proxy': '1' },
            body: JSON.stringify({ enabled: next }),
          });
          const body = await response.json();
          if (!body || body.ok !== true || !body.data) {
            throw new Error(body && body.error ? body.error : t('toggleFailed'));
          }
          setState(body.data);
          if (body.data.saved === false) setMessage({ kind: 'warn', text: t('saveFailed') });
          if (body.data.enabled && body.data.error) setMessage({ kind: 'bad', text: body.data.error });
        } catch (error) {
          setMessage({ kind: 'bad', text: String((error && error.message) || error) });
          load();
        } finally {
          setBusy(false);
        }
      };

      const enabled = Boolean(state && state.enabled);
      const proxyUrl = state && (state.proxyUrl || state.detectedUrl);
      const sourceLabel = (() => {
        const source = state && (state.source || state.detectedSource);
        if (source === 'system') return t('viaSystem');
        if (source === 'config') return t('viaConfig');
        if (source === 'env') return t('viaEnv');
        return '';
      })();

      const lines = [];
      if (message) lines.push(h('div', { key: 'msg', style: message.kind === 'warn' ? styles.warn : styles.bad }, message.text));
      if (state === null && !message) lines.push(h('div', { key: 'loading', style: styles.hint }, t('loading')));
      if (state && enabled && proxyUrl) {
        lines.push(
          h(
            'div',
            { key: 'detail', style: styles.detail },
            `${t('current')}: ${proxyUrl}${sourceLabel ? `（${sourceLabel}）` : ''}`,
          ),
        );
      }
      if (state && !enabled && !proxyUrl) lines.push(h('div', { key: 'noproxy', style: styles.warn }, t('noProxy')));

      return h(
        'div',
        { style: styles.card },
        h(
          'div',
          { style: styles.row },
          h(
            'div',
            { style: styles.text },
            h('div', { style: styles.rowTitle }, t('rowTitle')),
            h('div', { style: styles.hint }, t('rowHint')),
          ),
          h(Switch, {
            checked: enabled,
            disabled: busy || state === null,
            label: t('rowTitle'),
            onChange: toggle,
          }),
        ),
        lines,
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-agent-proxy: copy dictionaries');
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'agent-proxy',
              order: 17,
              locale: NS,
              label: () => t('title'),
              inject: () => ({ t }),
            },
            AgentProxySection,
          ),
        );
      },
    };
  },
});
