window.__ModuleLoader__.load({
  id: '@workbuddy/dsh-antigravity-orchestrator',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'workbuddy.antigravity';
    const PROJECTION = 'workbuddyOrchestrator';
    const PROVIDER = 'dsh-orchestrator';
    const MODEL = 'orchestrator';

    const en = {
      title: 'DSH model pairing', configure: 'Configure DSH model pairing', enabled: 'Pairing enabled', single: 'Single model',
      intro: 'Choose the two models for this session. They can come from different DSH providers.',
      planner: 'Planning model', executor: 'Execution model',
      forkPairing: 'Choose and save a pairing for this fork. Its history contains no confirmed model pair.', inheritedPairing: 'This fork uses the last pairing recorded before its branch point.',
      cacheHeading: 'Prompt cache', cacheNoRequests: 'No requests for this role in this session yet.', cacheUnknown: 'Unreported',
      cacheSummary: 'Session cache hits · {tokens} · {count} requests', cacheLatest: 'Last request · {model}',
      cacheReadWrite: '{read} read from cache · {write} written to cache', cacheTokens: '{count} tokens', cachePartial: '{tokens} in {count} reporting requests',
      plannerHelp: 'Answers questions directly, plans work for the executor, revises the plan when blocked, and reviews the result.',
      executorHelp: 'Uses tools to carry out the plan and reports progress, blockers, and results to the planning model.',
      choose: 'Choose a model', effort: 'Reasoning effort', automatic: 'Provider default', automaticNamed: 'Provider default ({name})',
      account: 'DeepSeek Account', unavailable: 'Unavailable · {name}', staleEffort: 'The saved effort is unavailable. Saving will use the provider default.',
      close: 'Close', retry: 'Retry', save: 'Save pairing', enable: 'Enable pairing', disable: 'Switch to single model',
      defaults: 'Default pairing', defaultsHelp: 'Sessions without a saved pair can use this pairing when orchestration is enabled.', setDefault: 'Set as default pairing',
      busy: 'This session is running. You can change the pairing after it finishes.', loading: 'Loading session settings…', loadingModels: 'Loading models…',
      noModels: 'Add a provider and model in DSH Settings → Models to choose a pair.',
      catalogFailure: 'Could not load models. {message}', providerFailure: 'Could not list models for {name}. {message}',
      unavailableSession: 'Reopen the session to change its model pairing.',
      badReply: 'DSH returned an unreadable pairing result. Reopen the settings to check the session.', invalidPair: 'Choose an available model for each role.',
      saving: 'Saving…', saved: 'Pairing saved for this session.', activated: 'Pairing enabled for this session.',
      deactivated: 'Single-model mode restored.', defaultSaved: 'Default pairing saved.', previous: 'Switching back restores {name}.',
      stage: 'Current stage', round: 'Round {count}', 'phase.idle': 'Ready', 'phase.plan': 'Planning', 'phase.execute': 'Executing',
      'phase.review': 'Reviewing', 'phase.replan': 'Replanning', 'phase.complete': 'Complete', 'phase.error': 'Needs attention',
      'reason.new_turn': 'The planner is reading the request.', 'reason.handoff': 'The planner handed the plan to the executor.',
      'reason.executor_report': 'The executor returned its results for review.', 'reason.executor_blocked': 'The executor reported a blocker.',
      'reason.direct_answer': 'The planner answered directly.', 'reason.reviewed': 'The planner reviewed and accepted the result.',
      'reason.user_steering': 'The planner is considering your latest input.', 'reason.periodic_review': 'The planner is checking execution progress.',
      'reason.repeated_failure': 'A tool failed repeatedly. The planner is revisiting the approach.', 'reason.protocol': 'The model is retrying its handoff.',
      'reason.max_tokens': 'The model reached its output limit.', 'reason.blocked': 'The turn is blocked.', 'reason.error': 'The turn ended with an error.',
      refreshStatus: 'Refresh status', readHost: 'Reload pairing settings', settingsUnavailable: 'The session or default pairing settings are unavailable.',
      nativeSwitch: 'To choose another single model, close this panel and open the model menu in the composer.', returnToComposer: 'Return to composer',
      previousUnavailable: 'The previous model or its saved reasoning effort is currently unavailable ({name}).',
      latestMode: 'The change was saved. The model menu has since selected a different mode.',
      alreadySaving: 'A pairing change is already in progress.', savingBackground: 'DSH is saving this change. You can close the panel and reopen it to see the result.',
    };
    const zh = {
      title: 'DSH 模型配对', configure: '配置 DSH 模型配对', enabled: '已启用配对', single: '单模型',
      intro: '为当前会话选择两个模型，可以来自不同的 DSH 提供方。',
      planner: '规划模型', executor: '执行模型',
      forkPairing: '请为这个分叉会话选择并保存模型配对。继承的记录中没有可确认的配对。', inheritedPairing: '这个分叉会话沿用分叉点之前最后记录的模型配对。',
      cacheHeading: '提示词缓存', cacheNoRequests: '当前会话还没有这个角色的请求。', cacheUnknown: '未上报',
      cacheSummary: '本会话缓存命中 · {tokens} · 共 {count} 次请求', cacheLatest: '最近一次请求 · {model}',
      cacheReadWrite: '缓存读取 {read} · 缓存写入 {write}', cacheTokens: '{count} 个 token', cachePartial: '{count} 次已上报请求合计 {tokens}',
      plannerHelp: '直接回答询问，需要执行时制订计划并交接。执行遇阻时重新规划，完成后复核结果。',
      executorHelp: '按计划调用工具，把进展、遇到的阻碍和执行结果交回规划模型。',
      choose: '选择模型', effort: '思考级别', automatic: '提供方默认', automaticNamed: '提供方默认（{name}）',
      account: 'DeepSeek 账号', unavailable: '不可用 · {name}', staleEffort: '已保存的思考级别当前不可用，保存时将使用提供方默认值。',
      close: '关闭', retry: '重试', save: '保存配对', enable: '启用配对', disable: '切回单模型',
      defaults: '默认配对', defaultsHelp: '尚未保存配对的会话启用编排时，可以使用这组模型。', setDefault: '设为默认配对',
      busy: '当前会话正在运行，结束后可以更改配对。', loading: '正在读取会话配置…', loadingModels: '正在加载模型…',
      noModels: '请在 DSH 设置 → 模型中添加提供方和模型，然后选择配对。',
      catalogFailure: '模型目录加载失败。{message}', providerFailure: '无法读取 {name} 的模型。{message}',
      unavailableSession: '请重新打开会话以更改模型配对。',
      badReply: '无法读取 DSH 返回的配对状态，请重新打开设置查看当前会话。', invalidPair: '请为两个角色各选择一个可用模型。',
      saving: '正在保存…', saved: '已保存当前会话的模型配对。', activated: '已为当前会话启用模型配对。',
      deactivated: '已恢复单模型模式。', defaultSaved: '已保存默认配对。', previous: '切回单模型时将恢复 {name}。',
      stage: '当前阶段', round: '第 {count} 轮', 'phase.idle': '就绪', 'phase.plan': '规划中', 'phase.execute': '执行中',
      'phase.review': '复核中', 'phase.replan': '重新规划中', 'phase.complete': '已完成', 'phase.error': '需要处理',
      'reason.new_turn': '规划模型正在阅读请求。', 'reason.handoff': '规划模型已将计划交给执行模型。',
      'reason.executor_report': '执行模型已提交结果，等待复核。', 'reason.executor_blocked': '执行模型遇到阻碍，已请求重新规划。',
      'reason.direct_answer': '规划模型已直接回答询问。', 'reason.reviewed': '规划模型已复核并确认完成。',
      'reason.user_steering': '规划模型正在处理你补充的要求。', 'reason.periodic_review': '规划模型正在检查执行进度。',
      'reason.repeated_failure': '同一工具操作连续失败，规划模型正在重新评估。', 'reason.protocol': '模型正在重试交接。',
      'reason.max_tokens': '模型已达到输出长度上限。', 'reason.blocked': '当前轮次遇阻。', 'reason.error': '当前轮次因错误结束。',
      refreshStatus: '刷新状态', readHost: '重新读取配对设置', settingsUnavailable: '暂时无法读取当前会话或默认配对设置。',
      nativeSwitch: '要选择其他单模型，请关闭此窗口，打开输入框里的模型菜单。', returnToComposer: '返回输入框',
      previousUnavailable: '先前的单模型或其已保存的思考级别当前不可用（{name}）。',
      latestMode: '这次更改已保存，模型菜单随后切换了模式。',
      alreadySaving: '当前会话已有一项配对更改正在保存。', savingBackground: 'DSH 正在保存。可以关闭窗口，稍后重新打开查看结果。',
    };

    const css = `
      .wb-ag-menu, .wb-ag-dock, .wb-ag-btn, .wb-ag-close, .wb-ag-select { box-sizing: border-box; font: inherit; }
      .wb-ag-menu, .wb-ag-dock, .wb-ag-close { border: 0; background: transparent; color: inherit; cursor: pointer; }
      .wb-ag-menu { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px; padding: 5px 7px; border-radius: 7px; text-align: start; font-size: 13px; }
      .wb-ag-menu-state { margin-inline-start: auto; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .wb-ag-chevron { width: 6px; height: 6px; margin-inline: 2px; border-block-start: 1.5px solid var(--dsw-alias-menu-icon); border-inline-end: 1.5px solid var(--dsw-alias-menu-icon); transform: rotate(45deg); }
      .wb-ag-dock { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; padding: 3px 7px; border-radius: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
      .wb-ag-dot { flex: 0 0 6px; width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-idle-primary); }
      .wb-ag-dot[data-phase='plan'], .wb-ag-dot[data-phase='execute'], .wb-ag-dot[data-phase='review'], .wb-ag-dot[data-phase='replan'] { background: var(--dsw-alias-state-business-primary); }
      .wb-ag-dot[data-phase='complete'] { background: var(--dsw-alias-state-done-primary); }
      .wb-ag-dot[data-phase='error'] { background: var(--dsw-alias-state-error-primary); }
      .wb-ag-dialog { box-sizing: border-box; position: fixed; inset: max(16px, var(--dsh-frame-overlay-top, 16px)) 0 16px; margin: auto; padding: 0; border: 1px solid var(--dsw-alias-border-l3); border-radius: 16px; width: min(494px, calc(100% - 32px)); max-width: none; max-height: calc(100dvh - max(16px, var(--dsh-frame-overlay-top, 16px)) - 16px); overflow: auto; overscroll-behavior: contain; pointer-events: auto; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); font: inherit; }
      .wb-ag-dialog::backdrop { background: var(--dsw-alias-bg-mask-1); }
      .wb-ag-head, .wb-ag-body, .wb-ag-foot { padding-inline: 20px; }
      .wb-ag-head { padding-top: 18px; }
      .wb-ag-titlebar, .wb-ag-fields, .wb-ag-actions { display: flex; align-items: center; gap: 8px; }
      .wb-ag-titlebar h2 { flex: 1; min-width: 0; font-size: 17px; font-weight: 600; line-height: 1.4; margin: 0; }
      .wb-ag-close { flex: 0 0 30px; width: 30px; height: 30px; padding: 0; border-radius: 7px; color: var(--dsw-alias-label-secondary); font-size: 22px; line-height: 1; }
      .wb-ag-mode, .wb-ag-stage { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
      .wb-ag-mode { white-space: nowrap; }
      .wb-ag-copy, .wb-ag-status, .wb-ag-alert { margin: 5px 0 0; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
      .wb-ag-copy { color: var(--dsw-alias-label-secondary); }
      .wb-ag-body { display: grid; gap: 15px; padding-top: 16px; padding-bottom: 15px; }
      .wb-ag-role { min-width: 0; }
      .wb-ag-role h3 { margin: 0; font-size: 14px; font-weight: 600; line-height: 1.4; }
      .wb-ag-role .wb-ag-copy { margin-top: 2px; font-size: 12px; }
      .wb-ag-fields { align-items: end; flex-wrap: wrap; margin-top: 7px; }
      .wb-ag-model, .wb-ag-effort { display: grid; gap: 3px; min-width: 0; }
      .wb-ag-model { flex: 3 1 185px; }
      .wb-ag-effort { flex: 1 1 138px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .wb-ag-select { width: 100%; min-width: 0; height: 34px; padding: 4px 7px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; text-overflow: ellipsis; }
      .wb-ag-defaults { color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .wb-ag-defaults summary { width: fit-content; cursor: pointer; }
      .wb-ag-defaults .wb-ag-btn { margin-top: 8px; }
      .wb-ag-cache { margin-top: 7px; }
      .wb-ag-cache p { margin: 3px 0 0; overflow-wrap: anywhere; }
      .wb-ag-stage { background: var(--dsw-alias-bg-module-platform); border-radius: 8px; padding: 8px 10px; }
      .wb-ag-stage p { margin: 3px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 7em; overflow: auto; }
      .wb-ag-foot { padding-top: 12px; padding-bottom: 16px; border-top: 1px solid var(--dsw-alias-border-l2); }
      .wb-ag-actions { justify-content: flex-end; flex-wrap: wrap; }
      .wb-ag-btn { min-height: 32px; padding: 5px 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 7px; cursor: pointer; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); font-size: 13px; line-height: 1.4; }
      .wb-ag-btn.wb-ag-primary { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-inverted); }
      .wb-ag-notice + .wb-ag-actions { margin-top: 10px; }
      .wb-ag-status { color: var(--dsw-alias-label-secondary); }
      .wb-ag-alert { color: var(--dsw-alias-state-error-primary); }
      .wb-ag-dialog button:disabled, .wb-ag-menu:disabled, .wb-ag-select:disabled { opacity: .55; cursor: default; }
      .wb-ag-menu:focus-visible, .wb-ag-menu:hover:enabled, .wb-ag-close:hover:enabled, .wb-ag-dock:hover:enabled, .wb-ag-btn:hover:enabled { background: var(--dsw-alias-interactive-bg-hover); }
      .wb-ag-btn.wb-ag-primary:hover:enabled { background: var(--dsw-alias-button-primary-hover); }
      .wb-ag-dialog :focus-visible, .wb-ag-dock:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
      @media (pointer: coarse) { .wb-ag-select { font-size: 16px; min-height: 40px; } .wb-ag-btn { min-height: 40px; } }
    `;

    const identity = value => value;
    const isRunning = snapshot => snapshot.running;
    const isVirtual = route => route?.provider === PROVIDER && route.model === MODEL;
    const groupName = (group, t) => group.id === 'deepseek-account' ? t('account') : group.name;
    const phases = new Set(['idle', 'plan', 'execute', 'review', 'replan', 'complete', 'error']);
    const phaseOf = state => phases.has(state?.phase) ? state.phase : 'idle';
    const keyOf = route => route ? JSON.stringify([route.provider, route.model]) : '';
    const textOf = error => error instanceof Error ? error.message : String(error);

    function modelOf(groups, route) {
      return groups.find(group => group.id === route?.provider)?.models.find(item => item.id === route?.model);
    }

    function roleSelection(groups, route) {
      const model = modelOf(groups, route);
      if (!model || route.provider === PROVIDER) return null;
      const result = { provider: route.provider, model: model.id };
      if (model.reasoning?.efforts.some(level => level.id === route.reasoningEffort)) result.reasoningEffort = route.reasoningEffort;
      return result;
    }

    function source(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        getSnapshot: () => value,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        set(next) { value = next; for (const listener of listeners) listener(); },
      };
    }

    function catalogFor(native, retry) {
      if (!retry || retry.base !== native.groups || retry.baseFailures !== native.failures) return native;
      return { ...native, groups: retry.result?.groups ?? native.groups, failures: retry.result?.failures ?? native.failures,
        error: retry.error || (retry.result ? null : native.error), refreshing: retry.pending };
    }

    function sessionEditor(ctx, sessionId, binding, t) {
      const session = binding.session;
      const directory = ctx.modelDirectories.directoryFor(sessionId);
      const projection = session.projections.faceOf(PROJECTION);
      const form = ctx.configForms.get('workbuddy-model-orchestration');
      const operation = source(null);
      const catalogRetry = source(null);
      const settings = async (action, selection) => {
        if (ctx.sessions.binding(sessionId) !== binding) throw new Error(t('unavailableSession'));
        const reply = await ctx.connection.rpc.call('/api', 'workbuddy/model-pairing', { sessionId, action, ...(selection && { selection }) });
        if (!reply.ok) throw new Error(reply.error?.message || t('settingsUnavailable'));
        const state = reply.value;
        if (typeof state?.enabled !== 'boolean' || typeof state.busy !== 'boolean' || !Object.hasOwn(state, 'selection')) throw new Error(t('badReply'));
        if ((action === 'on' && !state.enabled) || (action === 'off' && state.enabled)) throw new Error(t('badReply'));
        return state;
      };
      async function retryCatalog() {
        const native = directory.store.getSnapshot();
        const prior = catalogRetry.getSnapshot();
        if (prior?.pending && prior.base === native.groups && prior.baseFailures === native.failures) return;
        const attempt = { base: native.groups, baseFailures: native.failures, pending: true,
          result: prior?.base === native.groups && prior.baseFailures === native.failures ? prior.result : null };
        catalogRetry.set(attempt);
        try {
          // ModelDirectory.load() caches even a partial catalog. This explicitly asks each provider again.
          const reply = await ctx.remote.session.modelCatalog();
          if (!reply.ok) throw new Error(reply.error.message);
          if (catalogRetry.getSnapshot() === attempt) catalogRetry.set({ ...attempt, pending: false, result: reply.value });
        } catch (error) {
          if (catalogRetry.getSnapshot() === attempt) catalogRetry.set({ ...attempt, pending: false, error: textOf(error) });
        }
      }
      return {
        sessionId, session, directory, projection, form, operation, catalogRetry, retryCatalog,
        read: () => settings('status'),
        async openState() {
          const before = operation.getSnapshot();
          const current = await this.read();
          const last = operation.getSnapshot();
          // A receipt already present on entry is historical; another window may have changed the native route since.
          const saved = (last !== before && last?.state) || current;
          const draft = (last?.pending || last?.error) && last.draft ? last.draft : saved.selection;
          return { saved, draft };
        },
        async save(action, draft) {
          if (operation.getSnapshot()?.pending) throw new Error(t('alreadySaving'));
          operation.set({ action, draft, pending: true });
          try {
            if (session.getSnapshot().running) throw new Error(t('busy'));
            let pair;
            if (action !== 'off') {
              const { groups } = catalogFor(directory.store.getSnapshot(), catalogRetry.getSnapshot());
              const planner = roleSelection(groups, draft?.planner);
              const executor = roleSelection(groups, draft?.executor);
              if (!planner || !executor) throw new Error(t('invalidPair'));
              pair = { planner, executor };
            }
            const state = await settings(action, pair);
            operation.set({ action, draft, state });
            return state;
          } catch (error) {
            operation.set({ action, draft, error: textOf(error) });
            throw error;
          }
        },
        clearNotice() { if (!operation.getSnapshot()?.pending) operation.set(null); },
      };
    }

    function useSource(source, selector = identity) {
      const subscribe = React.useCallback(listener => source.subscribe(listener), [source]);
      const snapshot = React.useCallback(() => selector(source.getSnapshot()), [source, selector]);
      return React.useSyncExternalStore(subscribe, snapshot);
    }

    function MenuEntry({ locked, dismiss, reportFailure, openEditor, useProjection, t }) {
      const state = useProjection(PROJECTION);
      const model = useProjection('modelSelection');
      const enabled = model?.next ? isVirtual(model.next) : state?.enabled;
      return h('button', {
        type: 'button', role: 'menuitem', className: 'wb-ag-menu', disabled: locked, 'aria-haspopup': 'dialog',
        onClick() { dismiss(); try { openEditor(); } catch (error) { reportFailure(textOf(error)); } },
      }, h('span', null, t('title')), h('span', { className: 'wb-ag-menu-state' }, enabled ? t('enabled') : null),
      h('span', { className: 'wb-ag-chevron', 'aria-hidden': true }));
    }

    function Dock({ sessionId, useSession, useSessions, useModelDirectory, useProjection, openEditor, closeEditor, t }) {
      const subagent = useSession(snapshot => snapshot.subagent !== null);
      const listedChild = useSessions(state => state.byId[sessionId]?.origin === 'subagent');
      const state = useProjection(PROJECTION);
      const directory = useModelDirectory(identity);
      const [error, setError] = React.useState('');
      React.useEffect(() => () => closeEditor(sessionId), [sessionId, closeEditor]);
      const enabled = directory.current ? isVirtual(directory.current) : state?.enabled;
      // The native menu opens directly into its model list when its saved route is unavailable.
      const missingRoute = directory.routable === false || (directory.status === 'error' && !directory.current);
      if (subagent || listedChild || (!enabled && !missingRoute)) return null;
      const phase = phaseOf(state);
      return h(React.Fragment, null, h('button', {
        type: 'button', className: 'wb-ag-dock', title: t('title'), 'aria-haspopup': 'dialog',
        onClick() { try { openEditor(); setError(''); } catch (reason) { setError(textOf(reason)); } },
      }, enabled && h('span', { className: 'wb-ag-dot', 'data-phase': phase, 'aria-hidden': true }),
      enabled ? h(React.Fragment, null, t('title'), h('span', { role: 'status' }, t('phase.' + phase))) : t('configure')),
      error && h('span', { role: 'alert', className: 'wb-ag-alert' }, error));
    }

    function RoleCache({ usage, t }) {
      if (!usage) return null;
      const tokens = value => Number.isSafeInteger(value) && value >= 0 ? t('cacheTokens', { count: value.toLocaleString() }) : t('cacheUnknown');
      const covered = usage.coverage?.cacheReadTokens;
      const total = usage.cacheReadTokens == null && covered > 0
        ? t('cachePartial', { count: covered, tokens: tokens(usage.known.cacheReadTokens) }) : tokens(usage.cacheReadTokens);
      const last = usage.last;
      return h('details', { className: 'wb-ag-defaults wb-ag-cache' },
        h('summary', null, t('cacheHeading'), usage.requests > 0 && ` · ${total}`),
        !usage.requests ? h('p', null, t('cacheNoRequests')) : h(React.Fragment, null,
          h('p', null, t('cacheSummary', { count: usage.requests, tokens: total })),
          last?.actor && h('p', null, t('cacheLatest', { model: `${last.actor.provider} / ${last.actor.model}` })),
          last && h('p', null, t('cacheReadWrite', { read: tokens(last.cacheReadTokens), write: tokens(last.cacheWriteTokens) }))));
    }

    function RoleFields({ role, route, groups, usage, onChange, disabled, t }) {
      const titleId = React.useId();
      const model = modelOf(groups, route);
      const efforts = model?.reasoning?.efforts ?? [];
      const effort = efforts.find(level => level.id === route?.reasoningEffort);
      const defaultEffort = efforts.find(level => level.id === model?.reasoning?.defaultEffort);
      return h('section', { className: 'wb-ag-role', 'aria-labelledby': titleId },
        h('h3', { id: titleId }, t(role)), h('p', { className: 'wb-ag-copy' }, t(role + 'Help')),
        h('div', { className: 'wb-ag-fields' },
          h('div', { className: 'wb-ag-model' }, h('select', {
            className: 'wb-ag-select', 'aria-labelledby': titleId, value: keyOf(route), disabled: disabled || !groups.length,
            onChange(event) { const [provider, id] = JSON.parse(event.target.value); onChange({ provider, model: id }); },
          }, h('option', { value: '', disabled: true }, t('choose')),
          route && !model && h('option', { value: keyOf(route), disabled: true }, t('unavailable', { name: `${route.provider} / ${route.model}` })),
          groups.map(group => h('optgroup', { key: group.id, label: groupName(group, t) }, group.models.map(item => {
            const key = keyOf({ provider: group.id, model: item.id });
            return h('option', { key, value: key }, `${item.name} · ${groupName(group, t)}`);
          }))))),
          efforts.length > 0 && h('label', { className: 'wb-ag-effort' }, t('effort'), h('select', {
            className: 'wb-ag-select', 'aria-label': `${t(role)} · ${t('effort')}`, disabled, value: effort?.id ?? '',
            onChange(event) { onChange({ provider: route.provider, model: route.model, ...(event.target.value ? { reasoningEffort: event.target.value } : {}) }); },
          }, h('option', { value: '' }, defaultEffort ? t('automaticNamed', { name: defaultEffort.name }) : t('automatic')),
          efforts.map(level => h('option', { key: level.id, value: level.id }, level.name))))),
        model && route.reasoningEffort && !effort && h('p', { className: 'wb-ag-copy' }, t('staleEffort')),
        h(RoleCache, { usage, t }));
    }

    function PairDialog({ editor, closeEditor, t }) {
      const dialogRef = React.useRef(null);
      const dirty = React.useRef(false);
      const titleId = React.useId();
      const directory = catalogFor(useSource(editor.directory.store), useSource(editor.catalogRetry));
      const operation = useSource(editor.operation);
      const receiptOnEntry = React.useRef(operation);
      const defaults = useSource(editor.form, form => form.value?.roles);
      const pending = operation?.pending ? operation.action : '';
      const wire = useSource(editor.projection);
      const running = useSource(editor.session, isRunning);
      const [saved, setSaved] = React.useState(null);
      const [draft, setDraft] = React.useState(null);
      const [loadError, setLoadError] = React.useState('');
      const [attempt, setAttempt] = React.useState(0);
      React.useLayoutEffect(() => {
        const dialog = dialogRef.current;
        dialog.showModal();
        return () => { if (dialog.open) dialog.close(); };
      }, []);
      React.useEffect(() => {
        let current = true;
        setLoadError('');
        editor.directory.load().catch(() => {}); // The directory publishes its own failure state.
        editor.openState().then(initial => {
          if (!current) return;
          setSaved(initial.saved);
          if (!dirty.current) setDraft(initial.draft);
        }, error => { if (current) setLoadError(textOf(error)); });
        return () => { current = false; };
      }, [editor, attempt, defaults]);
      React.useEffect(() => {
        if (!operation?.state || operation === receiptOnEntry.current) return;
        setSaved(operation.state);
        setDraft(operation.action === 'default' ? operation.draft : operation.state.selection);
        dirty.current = false;
      }, [operation]);
      React.useEffect(() => {
        if (!running) setSaved(last => last?.busy ? { ...last, busy: false } : last);
      }, [running]);
      const nativeKey = keyOf(directory.current);
      React.useEffect(() => {
        if (!nativeKey) return;
        const enabled = nativeKey === keyOf({ provider: PROVIDER, model: MODEL });
        setSaved(last => last && last.enabled !== enabled ? { ...last, enabled } : last);
      }, [nativeKey]);

      const groups = directory.groups.filter(group => group.id !== PROVIDER && group.models.length);
      const valid = Boolean(roleSelection(groups, draft?.planner) && roleSelection(groups, draft?.executor));
      const enabled = saved?.enabled ?? isVirtual(directory.current);
      const modeChanged = operation?.state && (operation.action === 'on' || operation.action === 'off') && operation.state.enabled !== enabled;
      const outcomes = { set: 'saved', on: 'activated', off: 'deactivated', default: 'defaultSaved' };
      const notice = operation && !pending ? operation.error || t(modeChanged ? 'latestMode' : outcomes[operation.action]) : '';
      const busy = running || saved?.busy === true;
      const locked = busy || Boolean(pending);
      const canSave = Boolean(saved) && valid && !locked;
      const stage = wire ?? saved;
      const phase = phaseOf(stage);
      const progress = stage?.progress;
      const reasonKey = 'reason.' + (stage?.reason === 'max-tokens' ? 'max_tokens' : stage?.reason);
      const reason = Object.hasOwn(en, reasonKey) ? t(reasonKey) : '';
      const failures = directory.failures.filter(failure => failure.id !== PROVIDER);
      const previous = saved?.previous ?? wire?.previous;
      const prevGroup = groups.find(group => group.id === previous?.provider);
      const prevModel = modelOf(groups, previous);
      const previousName = previous && (prevModel && prevGroup ? `${prevModel.name} · ${groupName(prevGroup, t)}` : `${previous.provider} / ${previous.model}`);
      const restorable = Boolean(prevModel && (!previous.reasoningEffort || prevModel.reasoning?.efforts.some(item => item.id === previous.reasoningEffort)));
      const close = () => closeEditor(editor.sessionId);
      const button = (action, label, disabled, primary) => h('button', {
        type: 'button', className: 'wb-ag-btn' + (primary ? ' wb-ag-primary' : ''), disabled,
        onClick: () => { if (!locked) editor.save(action, draft).catch(() => {}); },
      }, t(pending === action ? 'saving' : label));
      const changeRole = (role, route) => {
        dirty.current = true;
        editor.clearNotice();
        setDraft(pair => ({ ...pair, [role]: route }));
      };
      return h('dialog', {
        ref: dialogRef, className: 'wb-ag-dialog', 'aria-labelledby': titleId,
        onCancel(event) { event.preventDefault(); close(); },
        onClick(event) { if (event.target === event.currentTarget) close(); },
      }, h('div', null,
        h('header', { className: 'wb-ag-head' }, h('div', { className: 'wb-ag-titlebar' }, h('h2', { id: titleId }, t('title')),
          saved && h('span', { className: 'wb-ag-mode' }, t(enabled ? 'enabled' : 'single')),
          h('button', { type: 'button', className: 'wb-ag-close', 'aria-label': t('close'), onClick: close }, '×')),
        h('p', { className: 'wb-ag-copy' }, t('intro'))),
        h('div', { className: 'wb-ag-body' },
          loadError && h('div', null, h('p', { role: 'alert', className: 'wb-ag-alert' }, loadError),
            h('button', { className: 'wb-ag-btn', type: 'button', onClick: () => setAttempt(count => count + 1) }, t('readHost'))),
          !saved && !loadError && h('p', { role: 'status', className: 'wb-ag-status' }, t('loading')),
          (saved?.needsPairing || saved?.inheritedSelection) && h('p', { role: 'status', className: 'wb-ag-status' }, t(saved.needsPairing ? 'forkPairing' : 'inheritedPairing')),
          (directory.error || failures.length > 0) && h('div', null,
            directory.error && h('p', { role: 'alert', className: 'wb-ag-alert' }, t('catalogFailure', { message: directory.error })),
            failures.map(failure => h('p', { className: 'wb-ag-copy', key: failure.id }, t('providerFailure', { name: groupName(failure, t), message: failure.message }))),
            h('button', { className: 'wb-ag-btn', type: 'button', disabled: directory.refreshing, onClick: editor.retryCatalog }, t(directory.refreshing ? 'loadingModels' : 'retry'))),
          !groups.length && !directory.error && !failures.length && h('p', { role: 'status', className: 'wb-ag-status' }, t(directory.groups.length || directory.status === 'ready' ? 'noModels' : 'loadingModels')),
          ['planner', 'executor'].map(role => h(RoleFields, { key: role, role, groups, route: draft?.[role], usage: wire?.usage?.[role] ?? saved?.usage?.[role], onChange: route => changeRole(role, route), disabled: !saved || locked, t })),
          enabled && h('div', { className: 'wb-ag-stage' }, h('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': true },
            h('strong', null, `${t('stage')} · ${t('phase.' + phase)}`), stage?.rounds > 0 && h('span', null, ` · ${t('round', { count: stage.rounds })}`),
            reason && h('p', null, reason)), progress && h('p', null, progress)),
          enabled && h('p', { className: 'wb-ag-copy' }, previousName && (t(restorable ? 'previous' : 'previousUnavailable', { name: previousName }) + ' '), t('nativeSwitch')),
          h('details', { className: 'wb-ag-defaults' }, h('summary', null, t('defaults')), h('p', { className: 'wb-ag-copy' }, t('defaultsHelp')),
            button('default', 'setDefault', !canSave, false))),
        h('footer', { className: 'wb-ag-foot' }, (busy || pending || notice) && h('div', { className: 'wb-ag-notice' },
          busy && h('p', { className: 'wb-ag-status', role: 'status' }, t('busy')),
          busy && !running && h('button', { type: 'button', className: 'wb-ag-btn', onClick: () => setAttempt(count => count + 1) }, t('refreshStatus')),
          pending && h('p', { className: 'wb-ag-status', role: 'status' }, t('savingBackground')),
          notice && h('p', { className: operation.error ? 'wb-ag-alert' : 'wb-ag-status', role: operation.error ? 'alert' : 'status' }, notice)),
        h('div', { className: 'wb-ag-actions' }, enabled && (restorable ? button('off', 'disable', locked, false)
          : h('button', { type: 'button', className: 'wb-ag-btn', onClick: close }, t('returnToComposer'))),
          button('set', 'save', !canSave, enabled), !enabled && button('on', 'enable', !canSave, true)))));
    }

    function Overlay({ useEditor, closeEditor, t }) {
      const editor = useEditor(identity);
      return h(React.Fragment, null, h('style', null, css), editor && h(PairDialog, { key: editor.sessionId, editor, closeEditor, t }));
    }

    return {
      inject: ['slots', 'locale', 'connection', 'remote', 'remote.session', 'configForms', 'modelDirectories', 'sessions'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'DSH model pairing translations');
        ctx.inject(['uiConversation'], scope => {
          let active = true;
          scope.effect(() => () => { active = false; });
          return require.async('./client.presentation.js').then(({ registerPresentation }) => {
            if (active) registerPresentation(scope);
          });
        });
        const t = ctx.locale.bind(NS);
        ctx.slots.inject('shell.overlay', function* () {
          const editors = source(null);
          const byBinding = new WeakMap();
          const openFor = sessionId => () => {
            const binding = ctx.sessions.binding(sessionId);
            if (!binding) throw new Error(t('unavailableSession'));
            if (!byBinding.has(binding)) byBinding.set(binding, sessionEditor(ctx, sessionId, binding, t));
            editors.set(byBinding.get(binding));
          };
          const closeEditor = sessionId => {
            const current = editors.getSnapshot();
            if (current?.sessionId !== sessionId) return;
            current.clearNotice();
            editors.set(null);
          };
          yield ctx.slots.register({
            name: 'shell.overlay', id: 'workbuddy-antigravity-pair', locale: NS,
            inject: () => ({ hooks: { editor: editors }, closeEditor }),
          }, Overlay);
          yield ctx.slots.inject('conversation.input.model.options', () => ctx.slots.register({
            name: 'conversation.input.model.options', id: 'workbuddy-antigravity-pair', order: 5, locale: NS,
            inject: sessionId => ({ openEditor: openFor(sessionId) }),
          }, MenuEntry));
          yield ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
            name: 'conversation.composer.dock', id: 'workbuddy-antigravity-progress', order: 5, locale: NS,
            inject: sessionId => ({ hooks: { modelDirectory: ctx.modelDirectories.directoryFor(sessionId).store }, openEditor: openFor(sessionId), closeEditor }),
          }, Dock));
        });
      },
    };
  },
});
