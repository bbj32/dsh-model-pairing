window.__ModuleLoader__.load({
  id: '@workbuddy/dsh-antigravity-orchestrator',
  chunk: 'client.presentation.js',
  factory(require) {
    const h = require('react').createElement
    const commandSlot = 'conversation.chat.commandview'
    const locale = 'workbuddy.pairing.commands'
    const labels = {
      en: { on: 'Pairing enabled', use: 'Pairing enabled', off: 'Single model restored', set: 'Session pairing saved', default: 'Default pairing saved' },
      zh: { on: '已启用模型配对', use: '已启用模型配对', off: '已切回单模型', set: '已保存会话配对', default: '已保存默认配对' },
    }

    function route(value) {
      return typeof value?.provider === 'string' && !!value.provider && typeof value.model === 'string' && !!value.model
        && (value.reasoningEffort === undefined || typeof value.reasoningEffort === 'string')
    }

    function pair(value) { return route(value?.planner) && route(value.executor) }

    function savedCommand(node) {
      if (node.name !== 'orchestrator' || node.outcome?.kind !== 'success' || typeof node.outcome.text !== 'string') return null
      const args = /^(set|use|on|off|default)(?:\s+([\s\S]+))?$/.exec(node.args?.trim() ?? '')
      if (!args) return null
      const [, action, payload] = args
      try {
        if (payload ? action === 'off' || !pair(JSON.parse(payload)) : !['off', 'use'].includes(action)) return null
        const result = JSON.parse(node.outcome.text)
        if (result?.provider !== 'dsh-orchestrator' || result.model !== 'orchestrator' || typeof result.enabled !== 'boolean'
            || typeof result.configured !== 'boolean' || typeof result.busy !== 'boolean' || !pair(result.selection)
            || (action === 'off' && result.enabled) || (['on', 'use'].includes(action) && !result.enabled)) return null
        return action
      } catch { return null }
    }

    function registerCommands(ctx) {
      ctx.effect(() => ctx.locale.register(locale, labels))
      ctx.slots.inject(commandSlot, () => {
        const parent = ctx.slots.entriesOfSlot('conversation.chat.node').find(entry =>
          entry.options.key === 'command' && entry.locale === 'chat' && entry.children?.[commandSlot]?.kind === 'keyed')
        if (!parent) return () => {}
        const summary = ctx.locale.bind(locale)
        const nativeFallback = (_key, _props, options) => options.fallback
        return ctx.slots.register({ name: commandSlot, key: 'orchestrator', locale: 'chat' }, function PairingCommand({ node, t }) {
          const action = savedCommand(node)
          if (!action) return h(parent.component, { node: { data: node }, t, renderSlot: nativeFallback })
          return h('details', { style: { color: 'var(--dsw-alias-label-tertiary)', font: 'inherit' } },
            h('summary', { style: { cursor: 'pointer', width: 'fit-content' } }, `/orchestrator ${action} · ${summary(action)}`),
            h('pre', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '18em', overflow: 'auto',
              color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-markdown-code-block)',
              margin: '4px 0', padding: '12px 16px', borderRadius: 8, fontSize: 'inherit' } },
              `/${node.name} ${node.args}\n\n${node.outcome.text}`))
        })
      })
    }
    // v1.0.0 stripped the decision line before persisting a handoff as text.
    // Only the adapter's durable receipt identifies that text as a process step.
    function legacyProcess(event) {
      if (event.surfaceOp !== 'append' || event.data.interrupted) return null
      const { message } = event.data
      const source = message.source
      const record = source?.replayState?.response
      if (message.role !== 'assistant' || source?.provider !== 'dsh-orchestrator'
          || source.model !== 'orchestrator' || record?.owner !== 'workbuddy-orchestrator'
          || record.version !== 1) return null
      const planner = ['plan', 'review', 'replan'].includes(record.phase)
      const executor = record.phase === 'execute'
      if (!planner && !executor) return null
      const content = message.content
      if (!content.some(block => block.type === 'text' && block.text.trim() !== '')) return null
      const internal = (planner && record.action === 'delegate')
        || (executor && (record.action === 'report' || record.action === 'replan'))
        || record.action === 'repair'
        || (record.action === 'tools' && content.some(block => block.type === 'tool-call'))
      if (!internal) return null
      // rc.5 routes an exclusive event away from *all* Chat definitions, including
      // its exact turn-usage fold. Preserve any record which could supply that total.
      const usage = event.data.usage ?? event.data.stream?.findLast(item => item.type === 'chunk' && item.chunk.type === 'usage')?.chunk.usage
      if (usage && (usage.totalTokens !== undefined || (usage.cacheReadTokens !== undefined && usage.cacheWriteTokens !== undefined))) return null
      return { id: String(event.seq), role: 'start', exclusive: true }
    }

    function chatBlock(block) {
      switch (block.type) {
        case 'text':
        case 'reasoning': return { kind: 'reasoning', text: block.text }
        case 'image': return { kind: 'image', attachment: block.attachment }
        case 'tool-call': return { kind: 'tool-call', callId: String(block.id), name: block.name, argsRaw: block.arguments }
        default: return { kind: 'other', block }
      }
    }

    function registerPresentation(ctx) {
      registerCommands(ctx)
      return ctx.uiConversation.events.register({
        kind: 'workbuddy-orchestrator-process', target: 'chat',
        match: { 'assistant/message': legacyProcess },
        start(_context, { event, location }) {
          const { turn, step, message, usage } = event.data
          const blocks = message.content.map(chatBlock)
          const timing = { stepStartTime: location.kind === 'step' ? location.step.start?.time ?? null : null, firstTokenTime: null, completedTime: event.time }
          const finalNode = { kind: 'assistant', messageId: message.id, seq: event.seq, time: event.time, turn, step, blocks, usage, timing }
          return { status: 'settled', turn, step, time: event.time, blocks, finalNode, usage }
        },
        update: context => context.state,
        buildViewNode(context) {
          if (!context.start) return null
          // Choosing Chat's existing renderer also selects its native group splitting,
          // disclosure, Markdown, attachment gallery and all four work-detail modes.
          return {
            key: context.key, id: context.id, kind: 'assistant-step', target: 'chat',
            anchorSeq: context.start.event.seq, location: context.start.location,
            visibility: 'visible', data: context.state,
          }
        },
      })
    }

    return { registerPresentation }
  },
})
