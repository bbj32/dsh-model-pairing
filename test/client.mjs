import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import * as host from '../index.js'
import { settingsPath } from '../settings.js'
import { createUserMessage } from '../runtime.js'
import { stageMessage } from '../roles.js'
import { initialState } from '../state.js'
import { mountStorage } from './pairing-storage.mjs'

// Use the running DSH distribution, including Electron's ASAR reader on Desktop.
const installed = createRequire(join(process.env.DSH_INSTALL_DIR, 'package.json'))
const { Context } = installed('@deepseek-ai/cordis')
const { AgentModel, modelSelectionProjectionDefinition } = installed('@deepseek-ai/dsh-agent')
const root = new Context()
const native = { provider: 'alpha', model: 'common', reasoningEffort: 'high' }
const pair = {
  planner: { provider: 'beta', model: 'common', reasoningEffort: 'deep' },
  executor: { provider: 'alpha', model: 'common', reasoningEffort: 'low' },
}
const groups = [
  { id: 'alpha', name: 'Alpha', models: [model('common', ['high', 'low']), model('plain')] },
  { id: 'beta', name: 'Beta', models: [model('common', ['deep', 'off'])] },
  { id: 'dsh-orchestrator', name: 'DSH', models: [model('orchestrator')] },
]
function model(id, levels) {
  return { id, name: id, ...(levels && { reasoning: { efforts: levels.map(id => ({ id, name: id })) } }) }
}

// Invoke the same registered slot actions that the menu uses. This test does not render a page.
async function mountClient(bindings, directoryFor, modelCatalog, profileRoles, connection) {
  let bundle, dictionaries
  const slots = new Map()
  globalThis.window = { __ModuleLoader__: { load: value => { bundle = value } } }
  await import('../client.js')
  delete globalThis.window
  assert.equal(bundle.id, '@workbuddy/dsh-antigravity-orchestrator')
  const client = bundle.factory(request => { assert.equal(request, 'react'); return {} })
  client.apply({
    sessions: { binding: id => bindings.get(id) }, modelDirectories: { directoryFor }, remote: { session: { modelCatalog } }, connection,
    inject(keys) { assert.deepEqual(keys, ['uiConversation']) },
    configForms: {
      get(ns) { assert.equal(ns, 'workbuddy-model-orchestration'); return { getSnapshot: () => ({ status: 'ready', value: { roles: profileRoles() } }) } },
      describe: () => ({ ensure: async () => {} }),
    },
    locale: { register: (_ns, dict) => { dictionaries = dict }, bind: () => key => dictionaries.en[key] },
    effect: operation => operation(),
    slots: {
      register(entry) { slots.set(entry.name, entry); return () => {} },
      inject(_name, register) {
        const result = register()
        if (result?.next) for (const dispose of result) assert.equal(typeof dispose, 'function')
        return () => {}
      },
    },
  })
  assert.deepEqual([...slots.keys()], ['shell.overlay', 'conversation.input.model.options', 'conversation.composer.dock'])
  assert.deepEqual(Object.keys(dictionaries.zh).sort(), Object.keys(dictionaries.en).sort())
  const overlay = slots.get('shell.overlay').inject()
  function open(id) {
    overlay.closeEditor(id)
    slots.get('conversation.input.model.options').inject(id).openEditor()
    return overlay.hooks.editor.getSnapshot()
  }
  return Object.assign(open, { close: overlay.closeEditor })
}

const cleanStorage = await mountStorage(root)
const requestSignal = new AbortController().signal
try {
  root.provide('credentials', { modifyRecord: async (_key, update) => update(undefined) })
  for (const name of ['dsh-session', 'dsh-session-projection', 'dsh-commands', 'dsh-client-connection']) {
    const plugin = installed('@deepseek-ai/' + name)
    await root.plugin(plugin.default ?? plugin)
  }
  const nativeProjection = await root.sessionProjections.register(modelSelectionProjectionDefinition)
  const agents = new Map(), bindings = new Map()
  let providers = groups, profilePair = null, responseOverride, waitForModels
  root.provide('llm', {
    listProviders: () => providers, listModels: async id => {
      if (waitForModels) { waitForModels.entered.resolve(); await waitForModels.resume.promise }
      return providers.find(group => group.id === id).models
    },
    resolveModelInfo: async (id, modelId) => providers.find(group => group.id === id).models.find(item => item.id === modelId),
    registerAdapter: () => () => {},
  })
  root.provide('agents', { get: id => agents.get(id) })
  root.provide('tools', { guard: () => () => {} })
  root.provide('configEditor', { edit: async (_entry, edit) => { profilePair = edit({ roles: profilePair }).roles } })
  root.provide('sessionController', { resolveAgent: async id => agents.has(id) ? { agent: agents.get(id) } : { error: { code: 'session/not-found', message: 'Unknown session' } } })
  const settingsHost = { name: host.name, inject: host.inject, apply: ctx => host.apply(ctx, { roles: { get: () => profilePair }, reviewEvery: { get: () => 4 } }) }
  let hostFiber = await root.plugin(settingsHost)
  hostFiber.entry = {}
  if (hostFiber.error) throw hostFiber.error
  const transport = root.connection.createSharedFetchHandler('/api')
  const origin = 'http://127.0.0.1:28000', endpoint = 'workbuddy/model-pairing'
  const headers = { host: new URL(origin).host }
  let cookie
  root.connection.authorizeIndex({ method: 'GET', url: root.connection.authenticatedUrl(origin), headers }, {
    writeHead(code, response) { assert.equal(code, 303); cookie = response['set-cookie'].split(';')[0] }, end() {},
  })
  const owner = root.connection.admit({ headers: { ...headers, origin, cookie } }).peer
  assert.equal(owner.id, root.connection.browserPeer.id)
  const post = (body, peer = owner) => transport.fetch(new Request(origin + settingsPath, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', method: endpoint, payload: body, rpcId: 'fixture-rpc' }) }), peer)
  const outcome = async body => (await (await post(body)).json()).result
  const noAccess = root.connection.createPeer({ principal: { kind: 'test-readonly' } })
  assert.equal((await post({ action: 'status', sessionId: 'unaddressable' }, noAccess)).status, 403)
  assert.equal((await outcome({ action: 'status', sessionId: 'unaddressable' })).error.code, 'session/not-found')
  assert.equal((await outcome({ action: 'status', sessionId: 'unaddressable', other: 1 })).error.code, 'gateway/bad-request')
  assert.equal((await transport.fetch(new Request(origin + settingsPath, { method: 'POST', body: 'unreadable' }), owner)).status, 415)
  assert.equal(transport.requestBodyMode({ method: 'POST', url: new URL(settingsPath, origin) }), 'buffered')
  assert.deepEqual(root.connection.admit({ headers: { host: '127.0.0.1:28000' } }), { rejection: 401 })
  assert.deepEqual(root.connection.admit({ headers: { host: '127.0.0.1:28000', origin: 'http://cross-origin.invalid' } }), { rejection: 403 })

  function attach(log) {
    const id = log.id
    const agent = { id, status: 'idle', session: log, model: new AgentModel(nativeProjection.readerFor(log), log, native), runMaintenance: job => job(requestSignal) }
    agent.ctx = installed('@deepseek-ai/dsh-scope').createScope(root, agent).ctx
    agents.set(id, agent)
    bindings.set(id, { session: {
      getSnapshot: () => ({ running: agent.status === 'running' }),
      projections: { faceOf: key => ({ getSnapshot: () => root.sessionProjections.snapshot(log).values[key] }) },
    } })
    return agent
  }
  const session = (id, seed) => attach(root.sessions.create(id, seed ? { seed } : {}))
  let calls = 0, reads = 0, catalogCalls = 0, gate, shown = groups, failures = []
  const clientRoot = new Context()
  const { installConnection } = installed('@deepseek-ai/dsh-client-connection/client')
  installConnection(clientRoot, { location: { hostname: 'app' }, transport: { ownsHost: true, fetch: async (route, init) => {
    assert.equal(route, settingsPath.slice(1), 'DSH passes a mount-relative route to a Desktop or Web carrier')
    assert.equal(init.method, 'POST')
    const message = JSON.parse(init.body)
    assert.equal(message.method, endpoint)
    if (message.payload.action === 'status') reads++
    else {
      calls++
      if (gate) await gate.promise
    }
    if (responseOverride) return Response.json({ type: 'server-response', rpcId: message.rpcId, result: responseOverride })
    return transport.fetch(new Request(new URL(route, origin), init), owner)
  } } })
  const reopen = await mountClient(bindings,
    id => ({ store: { getSnapshot: () => ({ groups: shown, failures, current: agents.get(id).model.current() }) } }),
    async () => { catalogCalls++; return { ok: true, value: { groups: providers, failures: [], default: native } } }, () => profilePair, clientRoot.connection)
  const first = session('client-pair'), second = session('client-single')
  let editor = reopen(first.session.id)
  assert.deepEqual((await editor.read()).selection, { planner: native, executor: native })
  await reopen(first.session.id).read()
  assert.equal(calls, 0, 'opening an inherited pair twice leaves the conversation untouched')
  assert.equal(first.session.seq, 0)
  assert.equal((await editor.save('on', pair)).enabled, true)
  assert.deepEqual(first.model.current(), { provider: 'dsh-orchestrator', model: 'orchestrator' })
  const savedCalls = calls
  editor = reopen(first.session.id)
  assert.deepEqual((await editor.read()).selection, pair)
  assert.equal(calls, savedCalls, 'explicit pair reopens from the durable projection')
  const edit = { planner: { provider: 'alpha', model: 'plain' }, executor: pair.planner }
  assert.deepEqual((await editor.save('set', { ...edit, planner: { ...edit.planner, reasoningEffort: 'obsolete' } })).selection, edit)
  assert.equal((await editor.save('off')).enabled, false)
  assert.deepEqual(first.model.current(), native)
  assert.ok(first.session.snapshotEvents().every(event => !event.type.startsWith('command/')))
  await hostFiber.dispose()
  hostFiber = await root.plugin(settingsHost)
  hostFiber.entry = {}
  assert.deepEqual((await reopen(first.session.id).read()).selection, edit, 'reopening the real JSON storage unit restores the session override')
  assert.deepEqual(first.model.current(), native)
  assert.deepEqual(root.modelPairing.selectionFor(first), { enabled: false, selection: edit })
  await editor.save('default', pair)
  assert.deepEqual((await reopen(second.session.id).read()).selection, pair)
  assert.deepEqual((await reopen(first.session.id).read()).selection, edit)
  console.log('PASS model menu actions, first use, cross-provider efforts, save and reopen, log replay, single-model restoration, session and default pairings')

  first.status = 'running'
  const busyCalls = calls
  await assert.rejects(editor.save('on', pair), /session is running/)
  assert.equal(calls, busyCalls)
  first.status = 'idle'
  await assert.rejects(editor.save('set', { ...pair, planner: { provider: 'dsh-orchestrator', model: 'orchestrator' } }), /available model/)
  providers = groups.filter(group => group.id !== 'beta')
  await assert.rejects(editor.save('on', pair), /Provider is unavailable/)
  assert.deepEqual(first.model.current(), native)
  providers = groups
  shown = groups.filter(group => group.id === 'dsh-orchestrator')
  failures = [{ id: 'beta', name: 'Beta', message: 'offline' }]
  await assert.rejects(editor.save('set', pair), /available model/)
  await editor.retryCatalog()
  assert.equal(catalogCalls, 1, 'a retry bypasses a cached partial native directory')
  assert.deepEqual((await editor.save('set', pair)).selection, pair)
  shown = groups; failures = []
  gate = Promise.withResolvers()
  const started = editor.save('on', pair)
  reopen.close(first.session.id)
  const resumed = reopen(first.session.id)
  assert.equal(resumed.operation.getSnapshot().pending, true)
  const pendingCalls = calls
  await assert.rejects(resumed.save('on', pair), /already in progress/)
  assert.equal(calls, pendingCalls)
  reopen.close(first.session.id)
  gate.resolve(); gate = null
  await started
  first.model.select({ provider: 'alpha', model: 'plain' })
  editor = reopen(first.session.id)
  assert.equal(editor.operation.getSnapshot().state.enabled, true, 'a save that finished while closed still has its receipt')
  const returned = await editor.openState()
  assert.equal(returned.saved.enabled, false, 'a newer native route wins over an earlier background-save receipt')
  assert.deepEqual(returned.saved.previous, { provider: 'alpha', model: 'plain' })
  assert.deepEqual(returned.draft, pair)
  await editor.save('off')
  console.log('PASS inherited reads produce zero chat events, partial provider catalog recovery, and closing/reopening during an in-flight save')
  // The owner may not displace an ongoing turn. Concurrent saves share the per-session lock, including the manual command.
  waitForModels = { entered: Promise.withResolvers(), resume: Promise.withResolvers() }
  const slowSave = outcome({ sessionId: first.id, action: 'on', selection: edit })
  await waitForModels.entered.promise
  assert.match((await outcome({ sessionId: first.id, action: 'set', selection: pair })).error.message, /already|Another model selection/)
  first.status = 'running'; waitForModels.resume.resolve(); waitForModels = null
  assert.match((await slowSave).error.message, /Change the pairing after this turn/)
  first.status = 'idle'
  assert.deepEqual(root.modelPairing.selectionFor(first), { enabled: false, selection: pair })
  // A native model-selection failure after the storage ack restores the prior durable value.
  const select = first.model.select.bind(first.model)
  first.model.select = () => { throw Error('fixture selection conflict') }
  assert.match((await outcome({ sessionId: first.id, action: 'on', selection: edit })).error.message, /fixture selection conflict/)
  first.model.select = select
  assert.deepEqual(root.modelPairing.selectionFor(first), { enabled: false, selection: pair })
  assert.ok(first.session.snapshotEvents().every(event => !event.type.startsWith('command/')))
  const scope = first.ctx.get('commands')
  const removeShadow = scope.register({ name: 'orchestrator', description: 'Preset override', handler: () => ({ kind: 'success', text: 'scoped' }) })
  await assert.rejects(editor.read(), /unavailable for this session preset/)
  assert.equal((await root.commands.execute(first, '/orchestrator', [], requestSignal)).result.text, 'scoped')
  removeShadow()
  const commandsBefore = first.session.snapshotEvents().filter(event => event.type.startsWith('command/')).length
  const manual = await root.commands.execute(first, '/orchestrator status', [], requestSignal)
  assert.deepEqual(JSON.parse(manual.result.text).selection, pair)
  assert.equal(first.session.snapshotEvents().filter(event => event.type.startsWith('command/')).length, commandsBefore + 2)
  const invalid = await root.commands.execute(first, '/orchestrator set broken', [], requestSignal)
  assert.equal(invalid.result.kind, 'error')
  assert.equal(first.session.snapshotEvents().at(-1).data.kind, 'error')
  const oldReceipt = session('client-v1', [
    { type: 'command/run', seq: 0, time: 1, data: { commandId: 'old', name: 'orchestrator', args: ' set ' + JSON.stringify(edit), source: { kind: 'user' } } },
    { type: 'command/done', seq: 1, time: 2, data: { commandId: 'old', kind: 'success', text: JSON.stringify({ enabled: false, selection: edit, configured: true, previous: native }) } },
  ])
  assert.deepEqual((await reopen(oldReceipt.id).read()).selection, edit)
  // Newly forked histories only prove the model route. Saving a child pair must never change the parent's sidecar.
  await editor.save('on', pair)
  const child = attach(root.sessions.fork(first.session, undefined, 'client-fork'))
  const forkStatus = await outcome({ sessionId: child.id, action: 'status' })
  assert.equal(forkStatus.value.needsPairing, true)
  assert.equal(forkStatus.value.selection, null)
  assert.deepEqual((await outcome({ sessionId: child.id, action: 'set', selection: edit })).value.selection, edit)
  assert.deepEqual((await editor.read()).selection, pair)
  const cut = first.session.append('user/message', createUserMessage(stageMessage('plan', 'new_turn', pair, initialState())), { surfaceOp: 'append' }).seq
  await editor.save('set', edit)
  const proven = attach(root.sessions.fork(first.session, cut, 'client-fork-evidence'))
  const provenStatus = await outcome({ sessionId: proven.id, action: 'status' })
  assert.deepEqual(provenStatus.value.selection, pair, 'fork takes its cut’s proven pair even when its parent silently selects a different pair afterwards')
  assert.equal(provenStatus.value.inheritedSelection, true)
  assert.equal(provenStatus.value.needsPairing, false)
  assert.deepEqual((await editor.read()).selection, edit)
  responseOverride = { ok: false, error: { code: 'transport/error', message: 'Connection unavailable', details: {} } }
  await assert.rejects(editor.save('on', pair), /Connection unavailable/)
  responseOverride = { ok: true, value: { wrong: 'unreadable' } }
  await assert.rejects(editor.save('on', pair), /unreadable/)
  responseOverride = { ok: true, value: null }
  await assert.rejects(editor.save('on', pair), /unreadable/)
  bindings.delete(first.session.id)
  await assert.rejects(editor.save('on', pair), /Reopen the session/)
  assert.ok(reads >= 2)
  console.log('PASS owner-only Connection, mount-relative Desktop carrier, preset shadowing, explicit slash-command receipts, legacy replay, fork selection, stale bindings and error responses')
  await clientRoot.fiber.dispose()
} finally {
  await root.fiber.dispose()
  await cleanStorage()
}
