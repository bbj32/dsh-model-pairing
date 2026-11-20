import { z } from './runtime.js'
import { MODEL, PROVIDER, ROUTE, SOURCE, isOrchestrator, pairSchema, realRoute, roleSchema } from './state.js'

const endpoint = 'workbuddy/model-pairing'
export const settingsPath = `/api/${endpoint}`
const requestEnvelope = z.strictObject({ type: z.literal('client-request'), method: z.literal(endpoint), rpcId: z.string().min(1), payload: z.unknown() })
const definitionId = '@workbuddy/dsh-antigravity-orchestrator'
const domainSpec = {
  name: 'workbuddy_model_pairing', version: 1, layout: 'per-record',
  tables: { sessions: { valueSchema: z.strictObject({ roles: pairSchema.nullable(), previous: roleSchema.nullable() }) } },
}
const address = { sessionId: z.string().min(1) }
const settingsRequest = z.union([
  z.strictObject({ ...address, action: z.enum(['status', 'off']) }),
  z.strictObject({ ...address, action: z.enum(['set', 'on', 'default']), selection: pairSchema }),
])

function idle(agent, signal) {
  signal.throwIfAborted()
  if (agent.status !== 'idle') throw new Error('当前会话正在运行，请在本轮结束或停止后更改配对。 / Change the pairing after this turn finishes or is stopped.')
}

function parsePair(input) {
  const parsed = pairSchema.safeParse(input)
  if (!parsed.success) throw new Error('Each role needs a provider, a model and an optional reasoning effort.')
  if (![parsed.data.planner, parsed.data.executor].every(realRoute)) throw new Error('The planner and executor must use underlying DSH models. Recursive orchestration is unavailable.')
  return parsed.data
}

async function checkRole(llm, role, signal) {
  if (!realRoute(role)) throw new Error('Select an underlying DSH model.')
  if (!llm.listProviders().some(entry => entry.id === role.provider)) throw new Error(`Provider is unavailable: ${role.provider}`)
  const models = await llm.listModels(role.provider)
  signal.throwIfAborted()
  if (!models.some(model => model.id === role.model)) throw new Error(`Model is unavailable: ${role.provider}/${role.model}`)
  const info = await llm.resolveModelInfo(role.provider, role.model, signal)
  const efforts = info.reasoning?.efforts ?? []
  if (role.reasoningEffort && !efforts.some(effort => effort.id === role.reasoningEffort)) throw new Error(`Unsupported reasoning effort ${role.reasoningEffort} for ${role.provider}/${role.model}.`)
  return { efforts: efforts.map(({ id, name }) => ({ id, name })), ...(info.reasoning?.defaultEffort ? { defaultEffort: info.reasoning.defaultEffort } : {}) }
}

async function catalog(llm) {
  const rows = llm.listProviders().filter(item => item.id !== PROVIDER)
  const providers = await Promise.all(rows.map(async ({ id, name }) => {
    try { return { id, name, models: (await llm.listModels(id)).map(item => ({ id: item.id, name: item.name })) } }
    catch (error) { return { id, name, models: [], error: error.message } }
  }))
  return { providers }
}

function registerSettingsRoute(ctx, commandHandler, operate) {
  ctx.inject(['connection', 'sessionController'], scope => {
    // Connection admits trusted, authenticated requests and restricts exact Fetch routes to owner Peers.
    scope.connection.fetch.register({
      path: settingsPath, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
          return Response.json({ error: 'Expected a JSON settings request.' }, { status: 415 })
        }
        let message
        try { message = requestEnvelope.parse(await request.json()) }
        catch { return new Response('Invalid DSH RPC envelope.', { status: 400 }) }
        const respond = result => Response.json({ type: 'server-response', rpcId: message.rpcId, result }, { headers: { 'cache-control': 'no-store' } })
        const failure = (code, error) => respond({ ok: false, error: { code, message: error, details: {} } })
        const decoded = settingsRequest.safeParse(message.payload)
        if (!decoded.success) return failure('gateway/bad-request', 'Invalid session, action or model pairing.')
        const body = decoded.data
        try {
          request.signal.throwIfAborted()
          const resolved = await scope.sessionController.resolveAgent(body.sessionId)
          if ('error' in resolved) return failure(resolved.error.code, resolved.error.message)
          const { agent } = resolved
          if (agent.id !== body.sessionId || agent.ctx.get('commands')?.find(agent, 'orchestrator')?.handler !== commandHandler) {
            return failure('model-pairing/unavailable', 'Model pairing is unavailable for this session preset.')
          }
          const value = await operate(agent, body.action, body.selection, request.signal)
          return respond({ ok: true, value })
        } catch (error) {
          return failure('model-pairing/operation-failed', error.message || String(error))
        }
      },
    })
  })
}

export async function mountSettings(ctx, config, read) {
  const domain = await ctx.storageDomain.open(domainSpec)
  ctx.effect(() => () => domain.close(), 'DSH model pairing session settings')
  const records = domain.table('sessions')
  // While an asynchronous write is outstanding, an intervening Agent turn still sees the last committed selection.
  const pending = new Map()
  const recordFor = agent => pending.has(agent.id) ? pending.get(agent.id) : records.get(agent.id)
  const defaultRoute = () => realRoute(ctx.get('agentDefaultModel')?.currentSelection())
  let savingDefault = false

  const forkSelections = new WeakMap()
  function forkSelection(agent, state, saved) {
    const session = agent?.session, cut = session?.inheritedEventCount ?? 0
    if (!cut || !isOrchestrator(agent.model.current()) || saved?.roles || state.lastConfiguredSeq >= cut) return undefined
    if (forkSelections.has(session)) return forkSelections.get(session)
    let pair = null
    // Native forks carry the exact prefix but do not identify its parent. Reuse the most recent proven selection in that prefix.
    for (let seq = cut - 1; seq >= 0; seq--) {
      const event = session.eventAt(seq)
      if (event?.type === 'model/selection') break
      let selection
      if (seq === state.lastConfiguredSeq && event?.type === 'command/done') {
        try { selection = JSON.parse(event.data.text).selection } catch { break }
      } else if (event?.type === 'user/message') {
        const source = event.data.source
        if (source?.kind !== SOURCE || source.record !== 'stage' || source.version !== 1 || source.form !== 'notice' || !['plan', 'execute', 'replan', 'review'].includes(source.phase)) continue
        selection = source.roles
      } else continue
      const candidate = pairSchema.safeParse(selection)
      if (candidate.success && realRoute(candidate.data.planner) && realRoute(candidate.data.executor)) pair = candidate.data
      break
    }
    forkSelections.set(session, pair)
    return pair
  }

  function rolesFor(agent) {
    const state = agent && read(agent.session)
    const saved = agent && recordFor(agent)
    const inherited = forkSelection(agent, state, saved)
    if (inherited !== undefined) return inherited
    const configured = saved?.roles ?? state?.override ?? config.roles.get()
    if (configured) return parsePair(configured)
    const route = realRoute(agent?.model.current()) ?? state?.view.previous ?? saved?.previous ?? defaultRoute()
    return route ? { planner: route, executor: route } : null
  }

  function status(agent) {
    const state = read(agent.session), saved = recordFor(agent), inherited = forkSelection(agent, state, saved)
    return { ...state.view, provider: PROVIDER, model: MODEL, enabled: isOrchestrator(agent.model.current()), busy: agent.status !== 'idle',
      needsPairing: inherited === null, inheritedSelection: Boolean(inherited), configured: Boolean(saved?.roles ?? state.override), previous: realRoute(agent.model.current()) ?? state.view.previous ?? saved?.previous ?? defaultRoute(),
      selection: inherited !== null && agent.status === 'running' && state.roles ? state.roles : rolesFor(agent) }
  }

  async function operate(agent, action, selection, signal) {
    signal.throwIfAborted()
    if (action === 'status') return status(agent)
    idle(agent, signal)
    if (pending.has(agent.id) || (action === 'default' && savingDefault)) throw new Error('Another model selection is being saved. Try again after it finishes.')
    const oldRecord = records.get(agent.id), before = status(agent), startingRoute = agent.model.current()
    const checkCurrent = () => {
      const current = agent.model.current()
      if (ctx.agents.get(agent.id) !== agent || current?.provider !== startingRoute?.provider || current?.model !== startingRoute?.model || current?.reasoningEffort !== startingRoute?.reasoningEffort) {
        throw new Error('The session or model selection changed. Reopen the model pairing settings.')
      }
    }
    const commit = operation => agent.runMaintenance(async stopped => {
      const active = AbortSignal.any([signal, stopped])
      active.throwIfAborted()
      checkCurrent()
      return operation(active)
    })
    pending.set(agent.id, oldRecord)
    if (action === 'default') savingDefault = true
    try {
      if (action === 'off') {
        if (!before.enabled) return before
        if (!before.previous) throw new Error('Choose a model in the native model selector to leave pairing.')
        await checkRole(ctx.llm, before.previous, signal)
        idle(agent, signal)
        await commit(() => agent.model.select(before.previous))
      } else {
        const pair = selection != null ? parsePair(selection) : action === 'use' ? before.selection : null
        if (!pair) throw new Error('请在模型菜单中为两个角色选择模型。 / Select both roles in the model menu or pass their JSON selections.')
        await Promise.all([checkRole(ctx.llm, pair.planner, signal), checkRole(ctx.llm, pair.executor, signal)])
        idle(agent, signal)
        if (action === 'default') {
          const entry = ctx.fiber.entry, editor = ctx.get('configEditor')
          if (!entry || !editor) throw new Error('Saving a default requires a writable DSH profile.')
          await commit(() => editor.edit(entry, current => ({ ...current, roles: pair })))
        } else {
          const newRecord = { roles: selection != null ? pair : oldRecord?.roles ?? null, previous: before.previous }
          await commit(async active => {
            await records.put(agent.id, newRecord)
            try {
              active.throwIfAborted()
              checkCurrent()
              if ((action === 'on' || action === 'use') && !isOrchestrator(startingRoute)) agent.model.select(ROUTE)
              // A waiting human prompt can start immediately as maintenance settles.
              pending.set(agent.id, newRecord)
            } catch (error) {
              if (oldRecord) await records.put(agent.id, oldRecord)
              else await records.delete(agent.id)
              throw error
            }
          })
        }
      }
      pending.delete(agent.id)
      return status(agent)
    } finally {
      pending.delete(agent.id)
      if (action === 'default') savingDefault = false
    }
  }

  async function commandHandler({ agent, rawInput, signal }) {
    try {
      const [, action = 'status', payload = ''] = /^(\S+)?(?:\s+([\s\S]*))?$/.exec(rawInput.trim())
      let result
      if (action === 'catalog') result = await catalog(ctx.llm)
      else if (action === 'model') result = await checkRole(ctx.llm, roleSchema.parse(JSON.parse(payload)), signal)
      else {
        if (!['status', 'on', 'set', 'use', 'off', 'default'].includes(action) || (action === 'off' && payload)) {
          throw new Error('Usage: /orchestrator [status | catalog | model <route> | set <roles> | on <roles> | use [roles] | off | default <roles>]')
        }
        result = await operate(agent, action, action !== 'status' && payload ? JSON.parse(payload) : undefined, signal)
      }
      return { kind: 'success', text: JSON.stringify(result) }
    } catch (error) { return { kind: 'error', text: error.message || String(error) } }
  }
  ctx.effect(() => ctx.commands.register({
    definitionId, name: 'orchestrator', description: 'Configure planning, execution and review models for this conversation',
    input: { hint: 'status | catalog | model <route> | set <roles> | on <roles> | use | off | default <roles>' }, handler: commandHandler,
  }))
  ctx.provide('modelPairing', { selectionFor(agent) {
    const { enabled, selection } = status(agent)
    return { enabled, selection }
  } })
  registerSettingsRoute(ctx, commandHandler, operate)
  return rolesFor
}
