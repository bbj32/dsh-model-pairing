import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import * as plugin from '../index.js'
import { createUserMessage } from '../runtime.js'
import { fold, initialState, KEY, receiptOf } from '../state.js'
import { roleRequest } from '../roles.js'
import { mountStorage } from './pairing-storage.mjs'

const host = createRequire(join(process.env.DSH_INSTALL_DIR, 'package.json'))
const { Context } = host('@deepseek-ai/cordis')
const { DeepSeekAdapter, resolveAdapterOptions } = host('@deepseek-ai/dsh-llm-deepseek')
const { sessionFormatCatalog } = host('@deepseek-ai/dsh-session-format-catalog')
const root = new Context()
const signal = AbortSignal.timeout(30000)
const cleanup = await mountStorage(root)
const savedFetch = globalThis.fetch
const wire = [], cached = [], fired = [], next = new Map(), effects = []
const human = text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
const route = { provider: 'fixture-native', model: 'shared', reasoningEffort: 'high' }
const pair = { planner: route, executor: route }
const config = resolveAdapterOptions({ baseURL: 'https://local-wire.invalid', models: [{ id: 'shared', contextWindow: 131072, maxTokens: 4096 }] })
const view = session => root.sessionProjections.snapshot(session, [KEY]).values[KEY]
const countFields = ['inputTokens', 'outputTokens', 'totalTokens', 'cacheReadTokens', 'cacheWriteTokens']

// This offline provider's tokenizer is exactly one UTF-8 byte per token. The
// endpoint caches whole 64-token pages and uses only wire content to match, with
// no knowledge of DSH roles, sessions or claimed hit counts. Real commercial
// providers use their own tokenizers, retention rules and routing policies.
function encode(body) {
  const header = [body.system, body.tools, body.model, body.thinking, body.output_config, body.max_tokens, body.temperature ?? null, body.stop_sequences ?? null]
  const segments = [JSON.stringify(header)]
  for (const message of body.messages) {
    segments.push(message.role, ...message.content.map(block => JSON.stringify(block)))
  }
  return Buffer.from(segments.join('\n') + '\n')
}
function shared(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i }
function frame(event) { return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n` }
function responseFrames(script, key, usage) {
  const native = [{ type: 'thinking', thinking: `private reasoning ${key}`, signature: `signed-${key}` }]
  if (script.text) native.push({ type: 'text', text: script.text })
  if (script.call) native.push({ type: 'tool_use', name: 'fixture_action', input: {}, id: script.call })
  const frames = [{ type: 'message_start', message: { usage } }]
  for (const [index, block] of native.entries()) {
    if (block.type === 'text') {
      frames.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } })
      for (const text of [block.text.slice(0, 6), block.text.slice(6, 17), block.text.slice(17)]) frames.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } })
    } else frames.push({ type: 'content_block_start', index, content_block: block })
    frames.push({ type: 'content_block_stop', index })
  }
  frames.push({ type: 'message_delta', delta: { stop_reason: script.call ? 'tool_use' : 'end_turn' }, usage: { output_tokens: Buffer.byteLength(script.text || script.call) } }, { type: 'message_stop' })
  return new Response(frames.map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } })
}
const text = value => ({ text: value })
const answer = value => text(`[ORCH:ANSWER]\n${value}`)
const work = round => [text(`[ORCH:DELEGATE]\nRun the fixture action ${round} and verify it.`), { text: 'I will check the result.', call: `action-${round}` }, text(`[ORCH:REVIEW]\nVerified fixture ${round}.`), answer(`Verified ${round}.`)]

async function command(a, input) {
  const result = (await root.commands.execute(a, `/orchestrator ${input}`, [], signal)).result
  assert.equal(result.kind, 'success', result.text)
}
async function run(a, question, responses) {
  next.set(a.id, [...responses]); a.followup(human(question)); await a.whenIdle()
  const end = a.session.snapshotEvents().findLast(e => e.type === 'turn/end')
  assert.equal(end.data.reason.kind, 'completed', JSON.stringify(end.data.reason))
  assert.equal(next.get(a.id).length, 0)
}
function stored(session) {
  const header = sessionFormatCatalog.encodeCurrentHeader({ ...session.header, delegationDepth: session.header.delegationDepth ?? 0 }, session.inheritedEventCount)
  const restore = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
  for (const event of session.snapshotEvents()) restore.decodeRow(JSON.parse(JSON.stringify(sessionFormatCatalog.encodeCurrentEvent(event))))
  return restore.finish()
}

try {
  for (const pkg of ['dsh-session-projection','dsh-agent','dsh-session','dsh-llm','dsh-system-prompt','dsh-tools','dsh-tool-executor-native','dsh-commands','dsh-agent-loop']) {
    const m = host(`@deepseek-ai/${pkg}`)
    await root.plugin(m.default ?? m, pkg === 'dsh-system-prompt' ? { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: 'Local native-wire cache fixture.' } : {})
  }
  globalThis.fetch = async (input, request) => {
    assert.equal(new URL(input).hostname, 'local-wire.invalid')
    const session = new Headers(request.headers).get('x-deepseek-harness-session-id')
    assert.ok(root.agents.get(session), 'native auth and transport must receive the actual live Session id')
    const script = next.get(session)?.shift(); assert.ok(script, `Unexpected model request (${session})`)
    const body = JSON.parse(request.body), tokens = encode(body)
    const hit = Math.floor(cached.reduce((best, prior) => Math.max(best, shared(tokens, prior)), 0) / 64) * 64
    const write = Math.floor((tokens.length - hit) / 64) * 64
    cached.push(tokens)
    const role = /^DSH model pairing · (planner|executor) · (\w+)/.exec(body.system); assert.ok(role)
    const key = `${role[1]}-${wire.length + 1}`
    wire.push({ session, role: role[1], scope: role[2], body, key, tokens, hit, write, output: Buffer.byteLength(script.text || script.call), missing: script.missing })
    const usage = { input_tokens: tokens.length - hit - write, ...(script.missing ? {} : { cache_read_input_tokens: hit, cache_creation_input_tokens: write }) }
    return responseFrames(script, key, usage)
  }
  const adapter = new DeepSeekAdapter({ options: () => config, resolveAuth: async () => ({ headers: {} }), resolveUserId: () => 'synthetic-user',
    discoverModels: async provider => [{ provider, id: 'shared', name: 'Shared' }], prepareExtensions: async () => ({ fields: {}, accept: async () => {} }) })
  root.llm.registerAdapter(['fixture-native', 'fixture-alias'], adapter)
  root.tools.register({ name: 'fixture_action', description: 'Run the in-memory test action.', parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_, result) => [{ type: 'text', text: result }] }, execute: (_, exec) => { effects.push(exec.agent.id); return 'Observed fixture change.' } })
  root.on('llm/stream', async function* (options, forward) {
    if (!options.purpose && ['fixture-native','fixture-alias'].includes(options.provider)) fired.push(options)
    yield* forward()
  })
  await root.plugin(plugin, {})
  const { agent: a } = await root.agents.create({ sessionId: 'cache-fixture-a', agentOptions: route })
  const { agent: b } = await root.agents.create({ sessionId: 'cache-fixture-b', agentOptions: route })
  await command(a, `on ${JSON.stringify(pair)}`); await command(b, `on ${JSON.stringify(pair)}`)
  await run(a, 'Run the first fixture.', work('one'))
  await run(a, 'Run the second fixture.', work('two'))
  await run(b, 'Run the first fixture.', work('other'))
  const own = wire.filter(r => r.session === a.id)
  assert.deepEqual(own.map(r => r.role), ['planner','executor','executor','planner','planner','executor','executor','planner'])
  assert.equal(new Set(own.map(r => r.scope)).size, 2)
  assert.ok(own.every(r => r.body.thinking.type === 'enabled' && r.body.output_config.effort === 'high'))
  const first = new Map()
  for (const r of wire) {
    const prev = first.get(r.scope)
    if (!prev) assert.equal(r.hit, 0, 'cold role/session has zero paid-prefix reuse in this provider')
    else assert.ok(r.hit >= Math.floor(prev.tokens.length / 64) * 64, `cache lost a prior complete page for ${r.key}: ${r.hit}/${prev.tokens.length}`)
    first.set(r.scope, r)
    const signatures = r.body.messages.flatMap(m => m.content).filter(b => b.type === 'thinking').map(b => b.signature)
    assert.ok(signatures.every(sig => sig?.startsWith(`signed-${r.role}-`)), `${r.key} replayed private state of a different role`)
    if (prev) assert.ok(signatures.includes(`signed-${prev.key}`), `lost the exact prior native response on ${r.key}`)
  }
  assert.equal(new Set(wire.map(r => r.scope)).size, 4)
  const usage = view(a.session).usage
  for (const name of ['planner', 'executor']) {
    const calls = own.filter(r => r.role === name)
    assert.equal(usage[name].requests, calls.length); assert.equal(usage[name].reported, calls.length)
    assert.equal(usage[name].cacheReadTokens, calls.reduce((s,r) => s+r.hit,0)); assert.equal(usage[name].cacheWriteTokens, calls.reduce((s,r) => s+r.write,0))
    assert.equal(usage[name].outputTokens, calls.reduce((s,r) => s+r.output,0)); assert.equal(usage[name].inputTokens, calls.reduce((s,r) => s+r.tokens.length-r.hit-r.write,0))
    console.log(`PASS native DeepSeek ${name} ${calls.map(r => r.hit).join(' → ')} read, ${usage[name].cacheWriteTokens} written, ${calls.length} calls`)
  }
  const physical = stored(a.session)
  assert.deepEqual(physical.events.reduce(fold, initialState()).view, view(a.session))
  assert.deepEqual(effects, [a.id,a.id,b.id]); assert.equal(fired.every(req => [a.id,b.id].includes(req.sessionId)), true)
  const nativeMessages = a.session.deriveMessages()
  const options = { sessionId: a.id, messages: nativeMessages }
  const initial = fired[0], header = { provider: initial.provider, model: initial.model, reasoningEffort: initial.reasoningEffort, maxTokens: initial.maxTokens }
  const candidates = roleRequest(options, header, 'review', initial.tools ?? [])
  const disk = physical.events.filter(e => e.surfaceOp === 'append').map(e => e.data.message ?? e.data)
  assert.deepEqual(roleRequest({ ...options, messages: disk }, header, 'plan', initial.tools ?? []), candidates)
  const changed = roleRequest(options, { ...header, temperature: 0.3 }, 'review', initial.tools ?? [])
  assert.notEqual(changed.scope, candidates.scope); assert.ok(!changed.messages.some(m => m.source?.replayState))
  // Actual DSH compaction surface rewrite: remove original input, preserve the
  // later assistant nodes. No old signature may enter the next native request.
  const replace = a.session.snapshotEvents().find(e => e.type === 'user/message' && e.data.source.kind === 'user')
  a.session.append('user/message', human('Compacted task summary.'), { surfaceOp: { op:'replace', startSeq:replace.seq, endSeq:replace.seq }, sourceEventSeqs:[replace.seq] })
  await run(a, 'Summarize the result.', [answer('The recorded work is complete.')])
  const compacted = wire.at(-1)
  assert.ok(!JSON.stringify(compacted.body).includes('Run the first fixture.'))
  assert.ok(!JSON.stringify(compacted.body).includes('signed-')); assert.ok(compacted.hit < own.at(-1).hit)
  const priorExecScope = own.find(r => r.role === 'executor').scope
  const newPair = { planner: route, executor: { ...route, provider:'fixture-alias', reasoningEffort:'low' } }
  await command(a, `set ${JSON.stringify(newPair)}`); await run(a, 'Run the changed fixture.', work('swapped'))
  const switched = wire.slice(-4); assert.notEqual(switched[1].scope, priorExecScope); assert.equal(switched[1].hit, 0)
  assert.equal(switched[1].body.output_config.effort, 'low'); assert.equal(switched[2].body.output_config.effort, 'low'); assert.ok(switched[2].hit > 0)
  assert.equal(switched[0].scope, compacted.scope); assert.ok(switched[0].hit > 0)
  await run(a, 'What happened?', [{ ...answer('Verified.'), missing: true }])
  const partial = view(a.session).usage.planner
  assert.equal(partial.last.cacheReadTokens, null); assert.equal(partial.last.cacheWriteTokens, null); assert.equal(partial.cacheReadTokens, null); assert.ok(partial.known.cacheReadTokens > 0)
  assert.equal(partial.coverage.cacheReadTokens, partial.requests - 1); assert.deepEqual(stored(a.session).events.reduce(fold, initialState()).view, view(a.session))
  assert.ok(own[0].hit === 0 && Number.isSafeInteger(own[0].hit)); assert.ok(countFields.every(k => k in partial.last))
  console.log('PASS identical model/role separation, independent Sessions, exact native signed replay, V4 restore, compaction, parameter and route changes, genuine zero versus missing usage')
  // The installed pi-ai Codex catalog route resolves only this fabricated
  // launch environment. Transport is SSE against an intercepted .invalid URL.
  const { createLaunchEnvironmentSnapshot } = host('@deepseek-ai/dsh-launch-environment')
  const testClaim = { 'https://api.openai.com/auth': { chatgpt_account_id: 'test-account-without-credentials' } }
  const fakeToken = 'fixture.' + Buffer.from(JSON.stringify(testClaim)).toString('base64') + '.not-a-signature'
  root.reflect.provide('launchEnvironment', createLaunchEnvironmentSnapshot([{ source:'process', values:{ PAIRING_TEST_ONLY:fakeToken } }]))
  const piModule = host('@deepseek-ai/dsh-llm-pi-ai')
  await root.plugin(piModule.default ?? piModule, { providers: { 'openai-codex': { baseURL:'https://codex-wire.invalid', apiKeyEnv:'PAIRING_TEST_ONLY', transport:'sse', cacheRetention:'short' } } })
  const models = await root.llm.listModels('openai-codex'); assert.ok(models.length)
  const codex = { provider:'openai-codex', model:models[0].id }
  const codexRows = [], pages = []
  globalThis.fetch = async (input, request) => {
    assert.equal(new URL(input).hostname, 'codex-wire.invalid')
    const h = new Headers(request.headers)
    assert.equal(h.get('chatgpt-account-id'), testClaim['https://api.openai.com/auth'].chatgpt_account_id)
    const body = JSON.parse(h.get('content-encoding') === 'zstd' ? zstdDecompressSync(request.body).toString() : request.body)
    assert.equal(body.prompt_cache_key, a.id); assert.equal(h.get('session-id'), a.id); assert.equal(h.get('x-client-request-id'), a.id)
    const script = next.get(a.id)?.shift(); assert.ok(script)
    const tokens = Buffer.from([body.instructions, JSON.stringify(body.tools ?? []), ...body.input.map(m => JSON.stringify(m))].join('\n')+'\n')
    const hit = Math.floor(pages.reduce((best, prior) => Math.max(best, shared(tokens, prior)), 0) / 64) * 64
    pages.push(tokens)
    const index = codexRows.length, id = `msg_fixture_${index}`
    const item = { id, type:'message', role:'assistant', phase:'final_answer', content:[{ type:'output_text', text:script.text, annotations:[] }] }
    const response = { id:`resp_${index}`, status:'completed', output:[item], usage:{ input_tokens:tokens.length, output_tokens:2, total_tokens:tokens.length+2, input_tokens_details:{cached_tokens:hit} } }
    const sequence = [{type:'response.created',response:{id:response.id}}, {type:'response.output_item.added',output_index:0,item:{...item,content:[]}}, {type:'response.output_text.delta', output_index:0,delta:script.text}, {type:'response.output_item.done',output_index:0,item}, {type:'response.completed',response}]
    codexRows.push({role:/DSH model pairing · (\w+)/.exec(body.instructions)?.[1], hit, tokens, body})
    return new Response(sequence.map(frame).join(''), { headers:{'content-type':'text/event-stream'} })
  }
  await command(a, `set ${JSON.stringify({planner:codex,executor:codex})}`)
  // A pure in-chat writing request needs no fixture tools, while exercising
  // plan, execute and acceptance across two rounds on the real Codex schema.
  const prose = n => [text(`[ORCH:DELEGATE]\nWrite a two-line story ${n}.`), text(`[ORCH:REVIEW]\nThe drafted story ${n}.`), answer(`The final story ${n}.`)]
  await run(a, 'Draft a two-line story.', prose(1)); await run(a, 'Draft the sequel.', prose(2))
  const previousByRole = new Map()
  for (const row of codexRows) {
    assert.ok(['planner','executor'].includes(row.role)); const prior = previousByRole.get(row.role)
    if (prior) assert.ok(row.hit >= Math.floor(prior.tokens.length/64)*64, `Codex ${row.role}: ${row.hit}/${prior.tokens.length}`)
    else assert.equal(row.hit, 0)
    previousByRole.set(row.role, row)
  }
  for (const [role, latest] of previousByRole) {
    const last = view(a.session).usage[role].last
    assert.equal(last.cacheReadTokens, latest.hit); assert.equal(last.cacheWriteTokens, null); assert.equal(last.totalTokens, latest.tokens.length+2)
    console.log(`PASS installed Codex SSE ${role} ${codexRows.filter(r=>r.role===role).map(r=>r.hit).join(' → ')} read, native session/affinity headers, missing cache write remains unknown`)
  }
} finally { globalThis.fetch = savedFetch; await root.fiber.dispose(); await cleanup() }
