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
      addressLabel: '代理地址',
      addressPlaceholder: 'http://127.0.0.1:7890',
      addressHint: '仅支持 http 代理；留空则自动使用系统代理',
      loading: '读取中…',
      viaSystem: 'Windows 系统代理',
      viaConfig: '自定义地址',
      viaEnv: '环境变量中的代理',
      current: '当前代理',
      noProxy: '未检测到系统代理，请填写代理地址，或先打开代理软件的系统代理',
      loadFailed: '读取代理状态失败',
      toggleFailed: '切换失败',
      saveFailed: '保存失败',
      addressBad: '地址无效：仅支持 http:// 或 https://，例如 http://127.0.0.1:7890',
    };

    const EN = {
      title: 'Proxy',
      rowTitle: 'Proxy for dsh',
      rowHint: 'Turn this on when git and other tools keep timing out',
      addressLabel: 'Proxy address',
      addressPlaceholder: 'http://127.0.0.1:7890',
      addressHint: 'HTTP proxies only; leave empty to use the system proxy',
      loading: 'Loading…',
      viaSystem: 'Windows system proxy',
      viaConfig: 'custom address',
      viaEnv: 'proxy from environment',
      current: 'Current proxy',
      noProxy: 'No system proxy detected. Enter an address, or turn on your proxy client system proxy.',
      loadFailed: 'Failed to read the proxy state',
      toggleFailed: 'Failed to switch',
      saveFailed: 'Failed to save',
      addressBad: 'Invalid address: http:// or https:// only, e.g. http://127.0.0.1:7890',
    };

    const styles = {
      card: {
        border: '1px solid var(--dsw-alias-border-l2, #e3e6eb)',
        background: 'var(--dsw-alias-bg-layer-3, #ffffff)',
        borderRadius: '12px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
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
      field: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      },
      fieldLabel: {
        fontSize: '13px',
        lineHeight: 1.4,
        color: 'var(--dsw-alias-label-secondary, #57606a)',
      },
      input: {
        boxSizing: 'border-box',
        width: '100%',
        border: '1px solid var(--dsw-alias-border-l2, #d0d7de)',
        background: 'var(--dsw-alias-bg-layer-2, #ffffff)',
        color: 'var(--dsw-alias-label-primary, #1f2329)',
        borderRadius: '8px',
        padding: '7px 10px',
        fontSize: '13px',
        lineHeight: 1.4,
        outline: 'none',
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
      const [draft, setDraft] = React.useState('');
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
          setDraft(body.data.configuredUrl || '');
          setMessage(null);
        } catch (error) {
          setMessage({ kind: 'bad', text: t('loadFailed') });
        }
      }, [t]);

      React.useEffect(() => {
        load();
      }, [load]);

      const send = async (path, payload) => {
        const response = await fetch(`${API}${path}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json', 'x-dsh-agent-proxy': '1' },
          body: JSON.stringify(payload),
        });
        const body = await response.json();
        if (!body || body.ok !== true || !body.data) {
          throw new Error(body && body.error ? body.error : t('saveFailed'));
        }
        return body.data;
      };

      const toggle = async () => {
        if (busy) return;
        setBusy(true);
        setMessage(null);
        try {
          const next = !(state && state.enabled);
          const data = await send('/toggle', { enabled: next });
          setState(data);
          if (data.saved === false) setMessage({ kind: 'warn', text: t('saveFailed') });
        } catch (error) {
          const text = String((error && error.message) || error);
          setMessage({ kind: 'bad', text: text === 'no-proxy' ? t('noProxy') : text });
          load();
        } finally {
          setBusy(false);
        }
      };

      const saveAddress = async () => {
        if (busy) return;
        if (draft === (state && state.configuredUrl ? state.configuredUrl : '')) return;
        setBusy(true);
        setMessage(null);
        try {
          const data = await send('/settings', { proxyUrl: draft.trim() });
          setState(data);
          setDraft(data.configuredUrl || '');
        } catch (error) {
          const text = String((error && error.message) || error);
          setMessage({ kind: 'bad', text: text === 'no-proxy' ? t('noProxy') : text });
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
      if (message) {
        lines.push(h('div', { key: 'msg', style: message.kind === 'warn' ? styles.warn : styles.bad }, message.text));
      }
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
      if (state && !enabled && !proxyUrl && !draft) {
        lines.push(h('div', { key: 'noproxy', style: styles.warn }, t('noProxy')));
      }

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
        h(
          'div',
          { style: styles.field },
          h('label', { style: styles.fieldLabel, htmlFor: 'dsh-agent-proxy-url' }, t('addressLabel')),
          h('input', {
            id: 'dsh-agent-proxy-url',
            type: 'text',
            spellCheck: false,
            autoComplete: 'off',
            value: draft,
            placeholder: t('addressPlaceholder'),
            disabled: busy || state === null,
            onChange: (event) => setDraft(event.target.value),
            onBlur: () => {
              saveAddress();
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            },
            style: styles.input,
            'aria-label': t('addressLabel'),
          }),
          h('div', { style: styles.hint }, t('addressHint')),
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
