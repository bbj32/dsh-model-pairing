import { z } from './runtime.js'

export const PROVIDER = 'dsh-orchestrator'
export const MODEL = 'orchestrator'
export const ROUTE = Object.freeze({ provider: PROVIDER, model: MODEL })
export const SOURCE = 'workbuddy-orchestrator'
export const KEY = 'workbuddyOrchestrator'

export const roleSchema = z.strictObject({
  provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().min(1).optional(),
})
export const pairSchema = z.strictObject({ planner: roleSchema, executor: roleSchema })
const phaseSchema = z.enum(['idle', 'plan', 'execute', 'replan', 'review', 'complete', 'error'])
const usageFields = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']
const counts = initial => Object.fromEntries(usageFields.map(key => [key, initial]))
const scalar = z.number().int().nonnegative()
const totals = Object.fromEntries(usageFields.map(key => [key, scalar.nullable()]))
const counted = z.object(Object.fromEntries(usageFields.map(key => [key, scalar])))
const roleUsage = z.object({ requests: scalar, reported: scalar, ...totals, known: counted, coverage: counted, last: z.object({ actor: roleSchema, ...totals }).nullable() })
const usageSchema = z.object({ planner: roleUsage, executor: roleUsage })
const emptyUsage = () => ({ requests: 0, reported: 0, ...counts(null), known: counts(0), coverage: counts(0), last: null })
export const roleForPhase = phase => phase === 'execute' ? 'executor' : 'planner'

function addUsage(usage, phase, actor, reported) {
  const role = roleForPhase(phase)
  const prior = usage[role]
  const next = { ...prior, requests: prior.requests + 1, reported: prior.reported + Number(reported != null), known: { ...prior.known }, coverage: { ...prior.coverage }, last: { actor } }
  for (const key of usageFields) {
    const value = reported?.[key]
    next.last[key] = Number.isSafeInteger(value) && value >= 0 ? value : null
    if (next.last[key] !== null) { next.known[key] += value; next.coverage[key]++ }
    next[key] = next.coverage[key] === next.requests ? next.known[key] : null
  }
  return { ...usage, [role]: next }
}

const viewSchema = z.object({
  enabled: z.boolean(), configured: z.boolean(), phase: phaseSchema, reason: z.string(), progress: z.string(), rounds: z.number().int(),
  selection: pairSchema.nullable(), previous: roleSchema.nullable(), usage: usageSchema,
})
const resumablePhases = ['execute', 'review', 'replan']
const continuationPrompt = /^(?:(?:请\s*)?继续(?:\s*(?:吧|执行|操作|(?:上次|刚才)的?任务))?|接着做|(?:please\s+)?(?:continue|resume)(?:\s+(?:please|the (?:previous|last) task))?)[\s.!?。！？]*$/iu

export function isContinuationMessage(message) {
  return message?.source?.kind === 'user' && message.content.length > 0 && message.content.every(block => block.type === 'text')
    && continuationPrompt.test(message.content.map(block => block.text).join(' ').trim())
}

const continuationSchema = z.object({
  phase: z.enum(resumablePhases), reason: z.string(), plan: z.string().min(1), progress: z.string(),
  rounds: scalar, batches: scalar, successfulTools: scalar, executorTools: scalar,
})
const stateSchema = z.object({
  view: viewSchema, override: pairSchema.nullable(), roles: pairSchema.nullable(), turn: z.number().int(),
  dispatch: phaseSchema, plan: z.string(), continuation: continuationSchema.nullable(), continueStep: z.boolean(), batches: z.number().int(),
  resumedAutomatically: z.boolean(), successfulTools: scalar, executorTools: scalar, repairs: z.number().int(),
  lastConfiguredSeq: z.number().int(), lastDirective: z.number().int(), commands: z.record(z.string(), z.string()),
  calls: z.record(z.string(), z.object({ name: z.string(), key: z.string() })), failures: z.record(z.string(), z.number().int()),
})

export function isOrchestrator(route) {
  return route?.provider === PROVIDER && route.model === MODEL
}

export function realRoute(route) {
  if (!route?.provider || !route.model || route.provider === PROVIDER) return null
  return { provider: route.provider, model: route.model, ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}) }
}

function idleView() {
  return { enabled: false, configured: false, phase: 'idle', reason: '', progress: '', rounds: 0, selection: null, previous: null, usage: { planner: emptyUsage(), executor: emptyUsage() } }
}

export function initialState() {
  return { view: idleView(), override: null, roles: null, turn: 0, dispatch: 'idle', plan: '', continuation: null, continueStep: false,
    batches: 0, resumedAutomatically: false, successfulTools: 0, executorTools: 0, repairs: 0,
    lastConfiguredSeq: -1, lastDirective: -1, commands: {}, calls: {}, failures: {} }
}

export function receiptOf(message) {
  const record = message?.source?.replayState?.response
  return message?.role === 'assistant' && message.source?.kind === 'model' && message.source.provider === PROVIDER && record?.owner === SOURCE && record.version === 1 ? record : null
}

function selectRoute(state, route) {
  if (!route?.provider || !route.model) return state
  const enabled = isOrchestrator(route)
  if (enabled === state.view.enabled && (enabled || JSON.stringify(state.view.previous) === JSON.stringify(realRoute(route)))) return state
  const previous = realRoute(route) ?? state.view.previous
  const view = { ...state.view, enabled, previous, phase: 'idle', progress: '', reason: '', rounds: 0 }
  return { ...state, view, roles: null, continuation: null, dispatch: 'idle', continueStep: false, lastDirective: -1 }
}

function settleCommand(state, data, seq) {
  if (!Object.hasOwn(state.commands, data.commandId)) return state
  const { [data.commandId]: operation, ...commands } = state.commands
  if (data.kind !== 'success') return { ...state, commands }
  let response
  try { response = JSON.parse(data.text) } catch { return { ...state, commands } }
  const selected = pairSchema.safeParse(response?.selection)
  if (!selected.success) return { ...state, commands }
  const override = response.configured ? selected.data : state.override
  const previous = realRoute(response.previous) ?? state.view.previous
  return { ...state, commands, override, lastConfiguredSeq: operation.endsWith(':pair') ? seq : state.lastConfiguredSeq, view: { ...state.view, configured: override !== null, selection: selected.data, previous } }
}

function scopedKey(name, args) {
  // Descriptions and time limits frequently change between two runs of the same check.
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const normalized = Object.fromEntries(Object.entries(args).filter(([key]) => !['description', 'timeoutMs', 'timeout_ms'].includes(key)).sort(([a], [b]) => a.localeCompare(b)))
    return `${name} ${JSON.stringify(normalized)}`
  }
  return `${name} ${JSON.stringify(args)}`
}

function recordAssistant(state, record, usage) {
  const stage = record.phase
  const action = record.action
  let phase = stage
  let reason = state.view.reason
  let progress = record.summary || state.view.progress
  let plan = state.plan
  let rounds = state.view.rounds
  let batches = state.batches
  let failures = state.failures
  let repairs = 0
  if (action === 'delegate') {
    phase = 'execute'; reason = 'handoff'; plan = record.summary; rounds++; batches = 0; failures = {}
  } else if (action === 'resume') {
    phase = 'execute'; reason = 'handoff'; batches = 0
  } else if (action === 'report') {
    phase = 'review'; reason = 'executor_report'; batches = 0
  } else if (action === 'replan') {
    phase = 'replan'; reason = 'executor_blocked'; batches = 0
  } else if (action === 'answer') {
    phase = 'complete'; reason = stage === 'plan' ? 'direct_answer' : 'reviewed'; progress = ''
  } else if (action === 'repair') {
    reason = 'protocol'; repairs = state.repairs + 1
  } else if (action === 'limit') {
    phase = 'error'; reason = 'max_tokens'
  } else if (action === 'tools' && stage === 'execute' && ++batches >= record.reviewEvery) {
    phase = 'review'; reason = 'periodic_review'; batches = 0
  }
  return { ...state, dispatch: stage, plan, batches, failures, repairs,
    resumedAutomatically: state.resumedAutomatically || record.automaticResume === true,
    continueStep: ['delegate', 'resume', 'report', 'replan', 'repair'].includes(action),
    view: { ...state.view, phase, reason, rounds, progress, usage: addUsage(state.view.usage, stage, record.actor, usage) } }
}

function recordResult(state, data) {
  const callId = data.message.toolCallId
  if (!Object.hasOwn(state.calls, callId)) return state
  const { [callId]: call, ...calls } = state.calls
  const text = data.message.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
  const failedExit = ['pwsh', 'bash', 'run_code'].includes(call.name) && /\[exit code:\s*(?!0\b)-?\d+\]/i.test(text)
  const failed = data.message.isError || failedExit
  if (state.dispatch !== 'execute') return { ...state, calls, successfulTools: state.successfulTools + Number(!failed) }
  const failures = { ...state.failures }
  if (!failed) {
    delete failures[call.key]
    return { ...state, calls, failures, resumedAutomatically: false, successfulTools: state.successfulTools + 1, executorTools: state.executorTools + 1 }
  }
  const count = (failures[call.key] ?? 0) + 1
  failures[call.key] = count
  if (count < 2) return { ...state, calls, failures }
  const progress = `${call.name}: ${text.slice(0, 600)}`
  return { ...state, calls, failures, batches: 0, view: { ...state.view, phase: 'replan', reason: 'repeated_failure', progress } }
}

export function fold(state, event) {
  const data = event.data
  switch (event.type) {
    case 'command/run': {
      if (data.name !== 'orchestrator') return state
      const input = (data.args ?? '').trim()
      const op = input.split(/\s/, 1)[0]
      const operation = /^(?:on|set|use)\s+\{/.test(input) ? `${op}:pair` : op
      return ['on', 'set', 'use', 'off'].includes(op) ? { ...state, commands: { ...state.commands, [data.commandId]: operation } } : state
    }
    case 'command/done': return settleCommand(state, data, event.seq)
    case 'session/end-seed': {
      if (!data.inherited) return state
      // A fork sees its ancestor's transcript, but its own accounting starts at its creation boundary.
      return { ...state, continuation: null, view: { ...state.view, usage: { planner: emptyUsage(), executor: emptyUsage() } } }
    }
    case 'model/selection': return selectRoute(state, data)
    case 'request/header': {
      // The actual selection may already be pending for the next step. A header
      // from an older, already prepared step must not override a user's switch.
      if (state.view.enabled && !isOrchestrator(data.header.config)) return state
      if (!state.view.enabled && state.view.previous) return state
      const { config, adapterDefaults } = data.header
      return selectRoute(state, { ...config, reasoningEffort: adapterDefaults?.reasoningEffort ? undefined : config.reasoningEffort })
    }
    case 'turn/start': {
      const next = { ...initialState(), commands: state.commands, override: state.override, lastConfiguredSeq: state.lastConfiguredSeq,
        continuation: state.continuation, turn: data.turn }
      return { ...next, view: state.view.enabled ? { ...state.view, phase: 'plan', reason: 'new_turn', progress: '', rounds: 0 } : state.view }
    }
    case 'user/message': {
      const source = data.source
      if (source?.kind === 'user' && state.continuation && !isContinuationMessage(data)) return { ...state, continuation: null }
      if (source?.kind !== SOURCE || source.record !== 'stage' || source.version !== 1) return state
      const pending = source.reason === 'continuation' ? state.continuation : null
      return { ...state, roles: source.roles, dispatch: source.phase, continueStep: false, lastDirective: event.seq,
        continuation: pending ? null : state.continuation,
        ...(pending ? { plan: pending.plan, batches: pending.batches, successfulTools: pending.successfulTools, executorTools: pending.executorTools } : {}),
        resumedAutomatically: state.resumedAutomatically && source.reason !== 'user_steering',
        view: { ...state.view, enabled: true, phase: source.phase, reason: pending?.reason ?? source.reason, selection: source.roles,
          ...(pending ? { rounds: pending.rounds, progress: pending.progress } : {}) } }
    }
    case 'assistant/message': {
      const record = receiptOf(data.message)
      if (record && !data.interrupted) {
        if (state.view.enabled && state.lastDirective >= 0) return recordAssistant(state, record, data.usage)
        // A model switch during this request ends dispatch but its usage is still real.
        return { ...state, view: { ...state.view, usage: addUsage(state.view.usage, record.phase, record.actor, data.usage) } }
      }
      if (!data.interrupted || !state.view.enabled || !state.roles || state.lastDirective < 0) return state
      const actor = state.roles[roleForPhase(state.dispatch)]
      return { ...state, view: { ...state.view, usage: addUsage(state.view.usage, state.dispatch, actor, data.usage) } }
    }
    case 'assistant/attempt': {
      const finish = data.stream.findLast(row => row.type === 'chunk' && row.chunk.type === 'finish')?.chunk
      if (finish?.reason?.failure?.code?.startsWith('ORCHESTRATOR_')) return state
      const failure = finish?.replayState?.response
      const pinned = failure?.owner === SOURCE && failure.version === 1 && failure.action === 'failure'
      if (!pinned && (!state.view.enabled || !state.roles || state.lastDirective < 0)) return state
      const phase = pinned ? failure.phase : state.dispatch
      const actor = pinned ? failure.actor : state.roles[roleForPhase(phase)]
      const usage = data.stream.findLast(row => row.type === 'chunk' && row.chunk.type === 'usage')?.chunk.usage
      return { ...state, view: { ...state.view, usage: addUsage(state.view.usage, phase, actor, usage) } }
    }
    case 'tool/call': {
      if (!state.roles || !state.view.enabled) return state
      let args = data.arguments
      try { args = JSON.parse(args) } catch { /* Keep the malformed argument as its own failure identity. */ }
      return { ...state, calls: { ...state.calls, [data.callId]: { name: data.name, key: scopedKey(data.name, args) } } }
    }
    case 'tool/result': return recordResult(state, data)
    case 'turn/end': {
      if (!state.view.enabled) return state
      const reason = data.reason.kind
      if (reason === 'completed' && state.view.phase === 'complete') return state
      const { phase: activePhase, reason: activeReason, progress, rounds } = state.view
      const canContinue = ['error', 'aborted', 'interrupted'].includes(reason) && state.plan.trim() && resumablePhases.includes(activePhase)
      // Older versions sent a bare continuation through planning. Preserve the
      // prior unfinished work when that extra turn failed before handing it off.
      const failedLegacyContinuation = activePhase === 'plan' && reason === 'error' && data.reason.error?.code === 'ORCHESTRATOR_PROTOCOL'
      const continuation = canContinue ? {
        phase: activePhase, reason: activeReason, plan: state.plan, progress, rounds,
        batches: state.batches, successfulTools: state.successfulTools, executorTools: state.executorTools,
      } : failedLegacyContinuation ? state.continuation : null
      const phase = ['aborted', 'interrupted', 'forked', 'completed'].includes(reason) ? 'idle' : 'error'
      return { ...state, continuation, continueStep: false, calls: {}, dispatch: 'idle', view: { ...state.view, phase, reason, progress: data.reason.error?.message ?? '' } }
    }
    default: return state
  }
}

export const projection = { key: KEY, stateVersion: 4, stateSchema, init: initialState, apply: fold,
  wire: { viewSchema, view: state => state.view, summary: false } }
