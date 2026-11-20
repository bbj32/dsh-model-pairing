import { BlockAssembler, LlmAdapter, LlmError } from './runtime.js'
import { MODEL, PROVIDER, SOURCE, realRoute } from './state.js'
import { actionRequest, decide, digest, isHumanMessage, neutralMessages, prefixForStreaming, protocolPrefix, readOnlyTool, roleRequest, untriedPreview, workspacePreviewGuide } from './roles.js'

const modelInfo = { id: MODEL, provider: PROVIDER, name: 'DSH 模型配对', description: 'Select two DSH models for planning, execution and review.' }
const failed = (message, code = 'ORCHESTRATOR_PROTOCOL') => ({ type: 'finish', reason: { kind: 'error', failure: { code, message } } })

function* emitBlock(block, index) {
  yield { type: 'block-start', blockType: block.type, index }
  if (block.type === 'text' || block.type === 'reasoning') yield { type: `${block.type}-delta`, text: block.text, index }
  if (block.type === 'tool-call') yield { type: 'tool-call-delta', id: block.id, name: block.name, argumentsDelta: block.arguments, index }
  yield { type: 'block-end', block, index }
}

function* finishBlocks(blocks, liveReasons, streamed) {
  let index = liveReasons.size
  let remaining = blocks.slice(index)
  for (const live of liveReasons.values()) {
    if (!live.closed) yield { type: 'block-end', index: live.index, block: blocks[live.index] }
  }
  if (streamed !== null) {
    const firstText = remaining.findIndex(block => block.type === 'text')
    const block = firstText < 0 ? { type: 'text', text: streamed } : remaining[firstText]
    if (block.text.startsWith(streamed) && block.text.length > streamed.length) yield { type: 'text-delta', index, text: block.text.slice(streamed.length) }
    yield { type: 'block-end', index: index++, block }
    remaining = remaining.filter((_, position) => position !== firstText)
  }
  for (const block of remaining) yield* emitBlock(block, index++)
}

export class OrchestratorAdapter extends LlmAdapter {
  constructor(ctx, read, rolesFor, reviewEvery) {
    super()
    this.ctx = ctx
    this.read = read
    this.rolesFor = rolesFor
    this.reviewEvery = reviewEvery
  }

  providerInfo() { return { id: PROVIDER, name: 'DSH 模型配对' } }
  async listModels() { return [modelInfo] }

  async resolveModel(provider, model, signal) {
    if (model !== MODEL) throw new LlmError('Unknown orchestration model.', 'INVALID_MODEL_INFO')
    const agent = this.ctx.agents.currentInitiator()
    if (!agent) return { ...modelInfo }
    const pair = (agent.status === 'running' && this.read(agent.session).roles) || this.rolesFor(agent)
    if (!pair) return { ...modelInfo }
    const routes = [pair.planner, pair.executor]
    const infos = await Promise.all(routes.map(route => this.ctx.llm.resolveModelInfo(route.provider, route.model, signal)))
    const sizes = infos.map(info => info.context?.contextWindow)
    // Preserve shared images for the visual role in a mixed pair. The prepared
    // underlying route projects them and decides whether it can use read_image.
    const acceptsImages = infos.some(info => info.inputModalities?.includes('image'))
    const inputModalities = acceptsImages ? ['text', 'image'] : infos.every(info => info.inputModalities) ? ['text'] : undefined
    return {
      ...modelInfo,
      ...(sizes.every(size => size > 0) ? { context: { contextWindow: Math.min(...sizes) } } : {}),
      ...(inputModalities ? { inputModalities } : {}),
    }
  }

  async *stream(options) {
    const agent = options.sessionId ? this.ctx.agents.get(options.sessionId) : undefined
    const state = agent && this.read(agent.session)
    const isConversation = !options.purpose && !!state?.roles && !!options.sessionId && state.view.enabled && state.lastDirective >= 0
    if (!isConversation && !options.purpose) { yield failed('Interactive orchestration requires a live DSH conversation.', 'ORCHESTRATOR_SESSION_REQUIRED'); return }
    const pair = isConversation ? state.roles : this.rolesFor(agent)
    if (!pair) { yield failed('Choose a planner and executor in the DSH model menu first.', 'ORCHESTRATOR_UNCONFIGURED'); return }
    const stage = isConversation ? state.dispatch : 'plan'
    const actor = realRoute(stage === 'execute' ? pair.executor : pair.planner)
    if (!actor) { yield failed('Choose a registered underlying model. Orchestration cannot route back into itself.', 'ORCHESTRATOR_INVALID_ROLE'); return }
    // The outer loop has already resolved its step-owned tool set. A change in a
    // backend's registration order alone must not disturb its prompt prefix.
    const { toolHistory, tools, reasoningEffort, ...base } = options
    if (!isConversation) { yield* this.ctx.llm.stream({ ...base, ...actor, tools, messages: neutralMessages(options.messages) }); return }
    if (state.repairs >= 2) { yield failed(`The ${stage} step did not produce a usable decision after two attempts. See its responses in the session details.`); return }
    const controls = { ...actor, ...base.temperature === undefined ? {} : { temperature: base.temperature }, ...base.maxTokens === undefined ? {} : { maxTokens: base.maxTokens }, ...base.stop === undefined ? {} : { stop: base.stop } }
    const prepared = await this.ctx.llm.prepareCall(controls, options.signal)
    const effectiveActor = realRoute(prepared.config)
    const acceptsImages = prepared.inputModalities?.includes('image')
    const allowed = (tools ?? []).filter(tool => (stage === 'execute' || readOnlyTool(tool.name))
      && (tool.name !== 'read_image' || acceptsImages)).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    const guide = workspacePreviewGuide(tools)
    const { scope, before, messages, system } = roleRequest(base, prepared.config, stage, allowed, guide)
    const request = { ...base, ...prepared.config, messages, system, ...(allowed.length ? { tools: allowed } : {}) }
    const preview = untriedPreview(options.messages, guide)
    const needsAction = actionRequest(options.messages) || Boolean(preview)
    const assembler = new BlockAssembler()
    let sawFinish = false
    let firstTextIndex, prefix = '', consumed = null, streamed = null
    let mayStream = true, reasoningPrefix = true
    const liveReasons = new Map(), pendingText = []
    // A capable provider can interleave an ANSWER prefix and a later tool. The
    // finish reason settles that ambiguity. Tool-free direct replies can stream
    // immediately. Tool-capable replies retain the provider's delta boundaries.
    const publicNow = !needsAction && !allowed.length
    for await (const chunk of prepared.stream(request)) {
      options.signal?.throwIfAborted()
      assembler.push(chunk)
      if (chunk.type === 'finish') sawFinish = true
      const kind = chunk.blockType ?? chunk.block?.type ?? (chunk.type === 'reasoning-delta' ? 'reasoning' : chunk.type === 'text-delta' ? 'text' : chunk.type === 'tool-call-delta' ? 'tool-call' : null)
      if (kind === 'reasoning' && (reasoningPrefix || liveReasons.has(chunk.index))) {
        let live = liveReasons.get(chunk.index)
        if (!live) {
          live = { index: liveReasons.size, closed: false }
          liveReasons.set(chunk.index, live)
          yield { type: 'block-start', index: live.index, blockType: 'reasoning' }
        }
        if (chunk.type !== 'block-start') yield { ...chunk, index: live.index }
        if (chunk.type === 'block-end') live.closed = true
        continue
      }
      if (kind) reasoningPrefix = false
      if (kind && kind !== 'text' && streamed === null) mayStream = false
      if (chunk.type !== 'text-delta' || !mayStream) continue
      firstTextIndex ??= chunk.index
      if (chunk.index !== firstTextIndex) continue
      if (consumed !== null) {
        if (publicNow) {
          streamed += chunk.text
          yield { type: 'text-delta', index: liveReasons.size, text: chunk.text }
        } else pendingText.push(chunk.text)
        continue
      }
      prefix += chunk.text
      consumed = prefixForStreaming(prefix, stage)
      if (consumed === null) {
        if (prefix.length > 48 || prefix.includes('\n') && prefix.trimStart()[0] !== '[') { mayStream = false; prefix = '' }
        continue
      }
      const body = prefix.slice(consumed)
      if (publicNow) {
        streamed = body
        yield { type: 'block-start', index: liveReasons.size, blockType: 'text' }
        if (body) yield { type: 'text-delta', index: liveReasons.size, text: body }
      } else if (body) pendingText.push(body)
      prefix = ''
    }
    options.signal?.throwIfAborted()
    if (!sawFinish) { yield failed('The underlying adapter ended without a terminal result.'); return }
    const finish = assembler.finish
    if (finish.kind === 'aborted' || finish.kind === 'error') {
      if (assembler.usage) yield { type: 'usage', usage: assembler.usage }
      yield { type: 'finish', reason: finish, replayState: { response: { owner: SOURCE, version: 1, phase: stage, actor: effectiveActor, action: 'failure' } } }
      return
    }
    const raw = assembler.blocks()
    const calls = raw.filter(block => block.type === 'tool-call')
    const names = new Set(allowed.map(tool => tool.name))
    const restricted = calls.map(call => call.name).filter(name => !names.has(name))
    const steered = stage === 'execute' && calls.length > 0 && agent.inbox.nextStep.some(isHumanMessage)
    // With no admitted tools, a fabricated late call cannot supersede a public
    // reply. Every supported call, including a call after candidate answer text,
    // takes the ordinary tools path with its native ID and real result.
    const toolFreeReply = streamed !== null && !allowed.length
    const output = toolFreeReply && calls.length ? raw.filter(block => block.type !== 'tool-call') : raw
    const evidence = {
      needsAction, preview, executorTools: state.executorTools, successfulTools: state.successfulTools,
      hasPlan: Boolean(state.plan), periodicReview: state.view.reason === 'periodic_review',
      resumedAutomatically: state.resumedAutomatically,
      executionOnly: restricted.length ? new Set((tools ?? []).filter(tool => !readOnlyTool(tool.name)).map(tool => tool.name)) : undefined,
    }
    const decision = finish.kind === 'max-tokens' ? { action: 'limit', summary: '' }
      : decide(stage, output, toolFreeReply ? [] : restricted, steered, evidence)
    const receipt = {
      owner: SOURCE, version: 1, phase: stage, actor: effectiveActor, action: decision.action,
      summary: decision.summary, reviewEvery: this.reviewEvery(),
      ...(decision.automaticResume ? { automaticResume: true } : {}),
    }
    const internal = decision.action !== 'answer' && (decision.action !== 'limit' || stage === 'execute')
    const suppressed = decision.corrected || decision.action === 'repair' || steered
    let blocks
    if (suppressed) {
      blocks = [...raw.filter(block => !['text', 'tool-call'].includes(block.type)), { type: 'reasoning', text: decision.summary }]
    } else {
      const first = output.findIndex(block => block.type === 'text')
      const marker = first >= 0 ? protocolPrefix(output[first].text) : ''
      const text = []
      blocks = output.map((block, index) => {
        if (block.type !== 'text') return block
        if (internal) text.push(index)
        return { type: internal ? 'reasoning' : 'text', text: index === first ? block.text.slice(marker.length) : block.text }
      })
      // Only reversible presentation operations get a native replay binding.
      // Block contents live on the surface; metadata carries only removed marker
      // bytes and type positions. Compaction must never restore removed output.
      if (output === raw) {
        receipt.native = { scope, before, surface: digest(blocks), ...(text.length ? { text } : {}), ...(marker ? { first, prefix: marker } : {}) }
        if (assembler.replayState !== undefined) receipt.inner = assembler.replayState
      }
    }
    if (!internal && pendingText.length && blocks[liveReasons.size]?.type === 'text') {
      const candidate = pendingText.join('')
      if (blocks[liveReasons.size].text.startsWith(candidate)) {
        streamed = candidate
        yield { type: 'block-start', index: liveReasons.size, blockType: 'text' }
        for (const text of pendingText) yield { type: 'text-delta', index: liveReasons.size, text }
      }
    }
    yield* finishBlocks(blocks, liveReasons, streamed)
    if (assembler.usage) yield { type: 'usage', usage: assembler.usage }
    yield { type: 'finish', reason: { kind: finish.kind === 'max-tokens' ? 'max-tokens' : decision.action === 'tools' ? 'tool-calls' : 'stop' }, replayState: { response: receipt } }
  }
}
