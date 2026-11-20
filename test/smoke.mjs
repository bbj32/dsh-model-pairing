import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import * as plugin from '../index.js'
import { mountStorage } from './pairing-storage.mjs'
import { LlmAdapter, createUserMessage } from '../runtime.js'
import { KEY, fold, initialState, receiptOf } from '../state.js'
import { phaseFor, readOnlyTool, stageMessage, untriedPreview, workspacePreviewGuide } from '../roles.js'

const requireHost = createRequire(join(process.env.DSH_INSTALL_DIR, 'package.json'))
const { Context } = requireHost('@deepseek-ai/cordis')
const root = new Context()
const timeout = setTimeout(() => { console.error('In-memory DSH test exceeded 25 s'); process.exit(1) }, 25000)
const scripts = new Map()
const seen = []
const effects = []
const roles = { planner: { provider: 'local-test-a', model: 'planner', reasoningEffort: 'deep' }, executor: { provider: 'local-test-b', model: 'worker', reasoningEffort: 'quick' } }
const swap = { planner: roles.executor, executor: roles.planner }
const answer = text => ({ text: `[ORCH:ANSWER]\n${text}` })
const delegate = text => ({ text: `[ORCH:DELEGATE]\n${text}` })
const requestTool = (name, id, args = {}) => ({ call: { name, id, arguments: JSON.stringify(args), type: 'tool-call' } })
const human = text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })

class ScriptedAdapter extends LlmAdapter {
  constructor(provider, model, effort) { super(); Object.assign(this, { provider, model, effort }) }
  async listModels() { return [{ provider: this.provider, id: this.model, name: this.model }] }
  async resolveModel() { return { ...(await this.listModels())[0], context: { contextWindow: 32000 }, reasoning: { efforts: [{ id: this.effort, name: this.effort }] } } }
  async *stream(options) {
    const script = scripts.get(options.sessionId)?.shift()
    assert.ok(script, `Unexpected request to ${this.provider} from ${options.sessionId}`)
    const stage = options.messages.findLast(message => message.source?.record === 'stage')?.source.phase
    const row = { session: options.sessionId, phase: stage, provider: this.provider, effort: options.reasoningEffort, tools: (options.tools ?? []).map(tool => tool.name), messages: options.messages }
    seen.push(row)
    const response = typeof script === 'function' ? await script(row, options) : script
    if (response.failure) { yield { type: 'finish', reason: { kind: 'error', failure: response.failure } }; return }
    if (response.text) {
      yield { type: 'block-start', blockType: 'text', index: 0 }
      yield { type: 'text-delta', index: 0, text: response.text.slice(0, 6) }
      yield { type: 'text-delta', index: 0, text: response.text.slice(6) }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: response.text } }
    }
    const calls = response.calls ?? (response.call ? [response.call] : [])
    for (const [index, block] of calls.entries()) yield { type: 'block-end', index: index + Number(Boolean(response.text)), block }
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } }
    yield { type: 'finish', reason: { kind: calls.length ? 'tool-calls' : 'stop' }, replayState: { response: { fixture: this.provider } } }
  }
}

const signal = new AbortController().signal
async function command(agent, args = '') { return (await root.commands.execute(agent, `/orchestrator${args ? ` ${args}` : ''}`, [], signal)).result }
async function ok(agent, args) { const result = await command(agent, args); assert.equal(result.kind, 'success', result.text); return JSON.parse(result.text) }
async function send(agent, prompt, sequence, expected = 'completed') {
  scripts.set(agent.id, [...sequence]); agent.followup(human(prompt)); await agent.whenIdle()
  const events = agent.session.snapshotEvents()
  const ending = events.findLast(event => event.type === 'turn/end')
  assert.equal(ending?.data.reason.kind, expected, JSON.stringify(ending?.data.reason))
  assert.equal(scripts.get(agent.id).length, 0)
  const start = events.findLast(event => event.type === 'turn/start')
  const turn = events.filter(event => event.seq >= start.seq && event.seq <= ending.seq)
  const values = root.sessionProjections.snapshot(agent.session, [KEY]).values[KEY]
  assert.deepEqual(events.reduce(fold, initialState()).view, values, 'cold log replay equals live wire projection')
  return { values, messages: turn.filter(event => event.type === 'assistant/message').map(event => event.data.message), turn }
}
function tool(name, handler, description = `Test ${name}`, properties = {}) {
  root.tools.register({ name, description, parameters: { type: 'object', properties }, output: { schema: { type: 'string' }, render: (_, value) => [{ type: 'text', text: value }] }, execute: handler })
}
function textOf(message) { return message.content.filter(block => block.type === 'text').map(block => block.text).join('\n') }
function localAgent(sessionId) { return root.agents.create({ sessionId, agentOptions: roles.planner }) }
function rowsFor(id) { return seen.filter(row => row.session === id) }

const cleanStorage = await mountStorage(root)
try {
  for (const name of ['dsh-session-projection', 'dsh-agent', 'dsh-session', 'dsh-llm', 'dsh-system-prompt', 'dsh-tools', 'dsh-tool-executor-native', 'dsh-commands', 'dsh-agent-loop']) {
    const module = requireHost(`@deepseek-ai/${name}`)
    await root.plugin(module.default ?? module, name === 'dsh-system-prompt' ? { includeHarnessIdentity: false, includeRuntimeContext: false, personaPrefix: 'DSH local integration test' } : {})
  }
  root.llm.registerAdapter(['local-test-a'], new ScriptedAdapter('local-test-a', 'planner', 'deep'))
  root.llm.registerAdapter(['local-test-b'], new ScriptedAdapter('local-test-b', 'worker', 'quick'))
  await root.plugin(plugin, {})
  assert.ok(root.llm.listProviders().some(route => route.id === 'dsh-orchestrator'), 'orchestrator mounted')
  tool('read', async (_args, exec) => `Read observation from ${exec.agent.id}`)
  tool('browser_observe', async () => 'Same tab, observed')
  tool('browser_act', async (args, exec) => {
    if (args.url?.endsWith('denied.svg')) throw new Error('Access denied by the workspace filesystem.')
    effects.push(exec.agent.id); return 'Same tab, action applied'
  }, 'Open workspace SVGs directly by file URL or path.', { action: { type: 'string', enum: ['new', 'navigate'] }, url: { type: 'string' } })
  let questions = 0
  tool('ask_user_question', async () => { questions++; return 'Fixture user answer.' }, 'Request user input.', {
    questions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, question: { type: 'string' } } } },
  })
  tool('edit', async () => 'Source updated.')
  tool('pwsh', async ({ command }) => command === 'build fixture' ? 'Build completed.' : '[exit code: 1]', 'Run a scripted check.', { command: { type: 'string' } })
  const { agent: a } = await localAgent('orchestration-smoke-a')
  const { agent: b } = await localAgent('orchestration-smoke-b')
  assert.equal((await ok(a)).enabled, false)
  assert.equal((await ok(a, 'catalog')).providers.length, 2)
  assert.deepEqual((await ok(a, `model ${JSON.stringify(roles.planner)}`)).efforts.map(item => item.id), ['deep'])
  assert.equal((await command(a, `on ${JSON.stringify({ ...roles, planner: { ...roles.planner, reasoningEffort: 'invalid' } })}`)).kind, 'error')
  assert.equal((await command(a, `on ${JSON.stringify({ ...roles, planner: { provider: 'dsh-orchestrator', model: 'orchestrator' } })}`)).kind, 'error')
  assert.equal((await ok(a, `on ${JSON.stringify(roles)}`)).enabled, true)
  assert.equal((await ok(b, `on ${JSON.stringify(swap)}`)).enabled, true)
  console.log('PASS native catalog, effort validation, recursive selection rejection, independent session pairing')
  const [first, other] = await Promise.all([send(a, 'Explain it', [answer('Direct A')]), send(b, 'Explain B', [answer('Direct B')])])
  assert.equal(textOf(first.messages.at(-1)), 'Direct A'); assert.equal(textOf(other.messages.at(-1)), 'Direct B')
  assert.deepEqual(rowsFor(a.id).map(row => [row.phase, row.provider, row.effort]), [['plan', 'local-test-a', 'deep']])
  assert.equal(rowsFor(b.id)[0].provider, 'local-test-b')
  console.log('PASS direct answers, per-role effort, parallel isolated Sessions, true answer streamed once')
  const saved = await send(a, 'Implement and verify', [
    requestTool('browser_observe', 'read-tab'), delegate('Change the tab and check the new value.'),
    requestTool('browser_act', 'write-tab'), { text: '[ORCH:REVIEW]\nApplied the requested change.' },
    requestTool('read', 'check'), answer('The final check passed.'),
  ])
  assert.deepEqual(saved.messages.map(m => receiptOf(m).phase), ['plan', 'plan', 'execute', 'execute', 'review', 'review'])
  assert.equal(textOf(saved.messages.at(-1)), 'The final check passed.')
  assert.deepEqual(effects, [a.id]); assert.equal(saved.values.reason, 'reviewed')
  for (const row of rowsFor(a.id)) assert.equal(row.tools.includes('browser_act'), row.phase === 'execute')
  assert.ok(rowsFor(a.id).at(-1).messages.some(m => m.role === 'tool' && m.toolCallId === 'write-tab'))
  console.log('PASS native browser observe/action, logged tool results, planner → execution → read-only acceptance')
  const repaired = await send(a, 'Handle failed validation', [delegate('Run the check.'), requestTool('pwsh', 'bad1'), requestTool('pwsh', 'bad2'), delegate('Use another check.'), { text: '[ORCH:REPLAN]\nInterface disagrees with the plan.' }, delegate('Use the verified interface.'), { text: 'Verified the interface.' }, answer('Reviewed')])
  assert.ok(repaired.messages.some(m => receiptOf(m).phase === 'replan')); assert.equal(repaired.values.rounds, 3)
  console.log('PASS repeated failed exit status, explicit executor escalation, revised plans and final review')
  const periodic = await send(a, 'Build an offline HTML demo.', [
    delegate('Build the HTML and verify the released artifact.'),
    ...[1, 2, 3].map(i => requestTool('read', `prep-${i}`)),
    requestTool('edit', 'first-edit'), requestTool('pwsh', 'first-build', { command: 'build fixture' }),
    ...[6, 7, 8, 9, 10, 11].map(i => requestTool('read', `check-${i}`)),
    requestTool('edit', 'last-edit'),
    { text: '## 审查结论\n补丁已写入，当前浏览器仍运行旧版。先构建，再确认微距性能。' },
    (row) => {
      assert.equal(row.phase, 'execute')
      const notice = textOf(row.messages.findLast(m => m.source?.record === 'stage'))
      assert.match(notice, /Build the HTML and verify the released artifact/)
      assert.match(notice, /先构建，再确认微距性能/)
      return requestTool('pwsh', 'last-build', { command: 'build fixture' })
    },
    { text: '[ORCH:REVIEW]\nThe updated HTML was built and verified.' }, answer('Verified the updated HTML.'),
  ])
  assert.deepEqual(periodic.messages.slice(1, 13).map(m => receiptOf(m).phase), Array(12).fill('execute'))
  assert.equal(receiptOf(periodic.messages[13]).action, 'resume')
  assert.equal(periodic.values.rounds, 1)
  assert.equal(periodic.turn.filter(e => e.data.source?.reason === 'periodic_review').length, 1)
  assert.equal(receiptOf(periodic.messages.at(-1)).phase, 'review')
  assert.ok(periodic.turn.some(e => e.type === 'tool/result' && e.data.message.toolCallId === 'last-build' && !e.data.message.isError))
  console.log('PASS default checkpoint at twelve batches, uninterrupted edit/build at batch four, and unmarked progress review resumes the plan')
  const recovered = await send(a, 'Check and finish the local build.', [
    delegate('Check the pending edit and build the updated artifact.'),
    { text: '[ORCH:REVIEW]\nThe edit is in place. The build still needs to run.' },
    { text: '[ORCH:REVIEW]\nThe build is pending.' },
    requestTool('pwsh', 'reviewer-build', { command: 'build fixture' }),
    (row) => {
      assert.equal(row.phase, 'execute')
      assert.match(textOf(row.messages.findLast(m => m.source?.record === 'stage')), /requested pwsh/)
      return requestTool('pwsh', 'executor-build', { command: 'build fixture' })
    },
    { text: '[ORCH:REVIEW]\nBuilt. One final check is pending.' },
    { text: '[ORCH:CONTINUE]\nCheck the updated output.' },
    requestTool('read', 'check-built'), { text: '[ORCH:REVIEW]\nThe output check passed.' }, answer('Verified and complete.'),
  ])
  assert.deepEqual(recovered.messages.map(m => receiptOf(m).action), ['delegate', 'report', 'repair', 'resume', 'tools', 'report', 'resume', 'tools', 'report', 'answer'])
  assert.equal(recovered.turn.some(e => e.type === 'tool/call' && e.data.callId === 'reviewer-build'), false)
  assert.ok(recovered.turn.some(e => e.type === 'tool/result' && e.data.message.toolCallId === 'executor-build' && !e.data.message.isError))
  const bounded = await send(a, 'Check the pending build.', [
    delegate('Verify the output.'), { text: '[ORCH:REVIEW]\nStill pending.' }, requestTool('pwsh', 'first-rejected'),
    { text: '[ORCH:REVIEW]\nNo progress.' }, requestTool('pwsh', 'second-rejected'), answer('The build remains pending.'),
  ])
  assert.deepEqual(bounded.messages.map(m => receiptOf(m).action), ['delegate', 'report', 'resume', 'report', 'repair', 'answer'])
  assert.equal(bounded.turn.some(e => e.type === 'tool/call'), false)
  const lateMarker = await send(a, 'Finish the requested checks.', [
    { text: '还需要验证。[ORCH:DELEGATE]\n请读取最新的报告。' }, requestTool('read', 'latest-report'),
    { text: '[ORCH:REVIEW]\n报告已核对。' }, answer('检查完成。'),
  ])
  assert.equal(receiptOf(lateMarker.messages[0]).summary, '还需要验证。\n\n请读取最新的报告。')
  assert.equal(textOf(lateMarker.messages[0]), '')
  console.log('PASS misplaced handoff marker, known execution tool recovery after repair, explicit resume, and bounded automatic recovery')
  const blocked = await send(a, 'Planner tried to modify', [requestTool('browser_act', 'forbidden'), answer('Read-only')])
  assert.deepEqual(effects, [a.id]); assert.equal(blocked.turn.some(event => event.type === 'tool/call'), false)
  const steered = await send(a, 'Steer in flight', [delegate('Open tab.'), () => { a.steer(human('Stop opening the tab; answer now.')); return requestTool('browser_act', 'stale') }, answer('Stopped as requested.')])
  assert.equal(receiptOf(steered.messages.at(-1)).phase, 'review'); assert.deepEqual(effects, [a.id]);
  console.log('PASS periodic review, blocked planner writes, in-flight user steering prevents stale execution')
  const svg = await send(a, '用svg画一个动态的鹈鹕骑自行车', [answer('我将生成SVG文件然后用浏览器实测。要我开始吗？'), { text: '下一步是生成 SVG，再打开它。' }, requestTool('browser_act', 'svg-open'), { text: '[ORCH:REVIEW]\n已生成并核验。' }, answer('已生成并核验了动画。')])
  assert.deepEqual(svg.messages.map(m => receiptOf(m).action), ['delegate', 'repair', 'tools', 'report', 'answer'])
  assert.equal(svg.values.phase, 'complete')
  for (const e of svg.turn.filter(e => e.type === 'assistant/message' && receiptOf(e.data.message)?.action !== 'answer')) {
    assert.ok(e.data.message.content.every(block => block.type !== 'text'))
    assert.ok(e.data.stream.every(row => row.type !== 'text-chunks' && row.chunk?.block?.type !== 'text' && row.chunk?.blockType !== 'text'))
  }
  const inline = '<svg viewBox="0 0 30 20"><circle r="5"><animate attributeName="r" values="5;8;5" dur="1s" repeatCount="indefinite"/></circle></svg>'
  await send(a, '用SVG画一个动画圆', [answer(inline)])
  await send(a, '只给我计划，不要打开网页', [answer('先确认路径，再打开本地文件。')])
  await send(a, '只给SVG代码', [answer(inline)])
  await send(a, '打开这个本地 SVG 并核验', [answer('请提供本地 SVG 文件路径。')])
  const compound = await send(a, '用 SVG 画一只鹈鹕，保存为 pelican.svg 并打开它确认外观。', [answer(inline), requestTool('browser_act', 'open-saved'), { text:'[ORCH:REVIEW]\nThe file is open.' }, { ...answer('待验证的摘要'), ...requestTool('browser_observe', 'verify-late') }, answer('The final screenshot verified it.')])
  assert.deepEqual(compound.messages.map(m => receiptOf(m).action), ['delegate','tools','report','tools','answer'])
  assert.ok(compound.turn.some(e => e.type === 'tool/result' && e.data.message.toolCallId === 'verify-late'))
  const late = compound.turn.find(e => e.type === 'assistant/message' && e.data.message.content.some(b => b.id === 'verify-late'))
  assert.ok(late.data.stream.every(row => row.type !== 'text-chunks' && row.chunk?.block?.type !== 'text'))
  const partialNegative = await send(a, '不要运行 Python 服务。请打开工作区中的 pelican.svg，检查它实际显示的内容。', [answer('我会打开，可以开始吗？'), requestTool('browser_act', 'open-local'), { text:'[ORCH:REVIEW]\nThe file was opened.' }, answer('Verified.')])
  assert.equal(receiptOf(partialNegative.messages[0]).action, 'delegate')
  await send(a, '好的，继续', [answer('I will open it. Shall I begin?'), requestTool('browser_act', 'continue-local'), { text:'[ORCH:REVIEW]\nComplete.' }, answer('Verified again.')])
  const serverClaim = '浏览器无法打开 file://，需要启动 Python HTTP 服务，你允许吗？'
  const pathRequest = '请打开工作区中的 ./pelican.svg，检查它实际显示的内容。'
  const originalName = 'antigravity_browser_act'
  const oldMessages = [human(pathRequest),
    { role: 'assistant', content: [requestTool(originalName, 'legacy-preview', { url: './pelican.svg' }).call] },
    { role: 'tool', toolCallId: 'legacy-preview', content: [{ type: 'text', text: 'Opened.' }] }]
  const oldBytes = JSON.stringify(oldMessages)
  assert.equal(untriedPreview(oldMessages, 'Try opening the SVG'), '')
  assert.equal(JSON.stringify(oldMessages), oldBytes)
  assert.equal(workspacePreviewGuide([{ name: originalName, description: 'Open a workspace SVG' }]), '')
  assert.equal(readOnlyTool('antigravity_browser_observe'), false)
  const directSvg = await send(a, pathRequest, [(_row, o) => { assert.match(o.system, /workspace SVG directly/); return answer(serverClaim) },
    requestTool('ask_user_question', 'unneeded-server-question', { questions: [{ id: 'server', question: serverClaim }] }),
    requestTool('browser_act', 'direct-svg', { action:'navigate', url:'./pelican.svg' }), { text:'[ORCH:REVIEW]\nThe SVG was rendered directly.' }, answer('已打开文件并核验外观。')])
  assert.deepEqual(directSvg.messages.map(m => receiptOf(m).action), ['delegate','repair','tools','report','answer'])
  assert.equal(questions, 0); assert.equal(directSvg.turn.filter(e=>e.type==='tool/call').length, 1)
  assert.match(receiptOf(directSvg.messages[0]).summary, /new or navigate/)
  const denied = await send(a, '请打开工作区中的 ./denied.svg', [delegate('Open the local SVG.'),
    requestTool('browser_act', 'file-access-denied', { action:'navigate', url:'./denied.svg' }),
    {text:'[ORCH:REVIEW]\n权限不足，浏览器无法打开本地文件。'}, answer('权限不足，无法打开本地文件。')])
  assert.equal(denied.values.phase, 'complete'); assert.ok(denied.turn.some(e=>e.type==='tool/result' && e.data.message.isError))
  const delegatedTabs = []
  tool('browser_task', async ({ task }) => { delegatedTabs.push(task); return 'Browser specialist verified the SVG.' }, 'Open a workspace SVG path in the built-in browser and return evidence.', {task:{type:'string'}})
  const withoutDirect = a.ctx.tools.restrict({ deny:['browser_act'] })
  try {
    const viaChild = await send(a, pathRequest, [(_row, o) => { assert.match(o.system, /workspace SVG path.+browser_task/); return answer(serverClaim) }, requestTool('browser_task', 'delegated-preview', {task:'Verify ./pelican.svg in the built-in browser.'}), {text:'[ORCH:REVIEW]\nThe specialist verified the drawing.'}, answer('已由浏览器验证。')])
    assert.equal(receiptOf(viaChild.messages[0]).action, 'delegate'); assert.equal(delegatedTabs.length, 1)
  } finally { withoutDirect() }
  const undoBrowser = a.ctx.tools.restrict({ deny:['browser_act','browser_task'] })
  try {
    const unavailable = await send(a, pathRequest, [(_row, o) => { assert.doesNotMatch(o.system, /workspace SVG directly/); return answer(serverClaim) }])
    assert.equal(receiptOf(unavailable.messages[0]).action, 'answer')
  } finally { undoBrowser() }
  await send(a, '为什么打开 pelican.svg 有时需要本地 HTTP 服务？', [answer('服务端的 URL 可供不同页面引用。')])
  console.log('PASS direct scoped workspace SVG capability, no unnecessary Python or approval question, genuine permission denial, unavailable browser and informational question')
  const clarification = await send(a, 'Check the report.', [
    { calls: [
      requestTool('ask_user_question', 'blank-question', { questions: [{ id: 'no-op', question: ' \u3000' }] }).call,
      requestTool('read', 'paired-read').call,
    ] },
    requestTool('ask_user_question', 'empty-questions', { questions: [] }),
    requestTool('ask_user_question', 'valid-question', { questions: [{ id: 'report', question: 'Which report should I inspect?' }] }),
    answer('The report was checked.'),
  ])
  const resultOf = id => clarification.turn.find(e => e.type === 'tool/result' && e.data.message.toolCallId === id)?.data.message
  assert.match(textOf(resultOf('blank-question')), /non-blank question/)
  assert.match(textOf(resultOf('empty-questions')), /non-blank question/)
  assert.equal(resultOf('paired-read').isError, false)
  assert.equal(resultOf('valid-question').isError, false)
  assert.equal(questions, 1)
  console.log('PASS blank and empty question guards, mixed-batch native read, and real clarification')
  const maxed = await send(a, '打开这个本地 SVG 并核验', [answer('I will open it. Shall I begin?'), { text: 'I will open the file now.' }, { text: 'I will start now.' }], 'error')
  assert.equal(maxed.values.phase, 'error'); assert.ok(maxed.turn.some(e => e.data.reason?.error?.code === 'ORCHESTRATOR_PROTOCOL'))
  console.log('PASS real SVG action, no future-tense final or white handoff, inline SVG and plan-only answers, real missing path, bounded repair')
  const failed = await send(a, 'Provider failure', [{ failure: { message: 'fixture quota', code: 'QUOTA' } }], 'error')
  assert.equal(failed.values.phase, 'error'); assert.equal(failed.turn.at(-1).data.reason.error.code, 'QUOTA')
  const restored = await ok(a, 'off'); assert.equal(restored.enabled, false); assert.deepEqual(a.model.current(), roles.planner)
  assert.equal((await ok(b)).enabled, true)
  console.log('PASS provider error propagation, original model restored and other Session unaffected')
  await ok(a, 'use')
  const started = Promise.withResolvers()
  scripts.set(a.id, [async (_row, options) => {
    started.resolve()
    await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }))
    return answer('Canceled output')
  }])
  a.followup(human('Cancel while streaming'))
  await started.promise
  assert.equal((await command(a, `set ${JSON.stringify(swap)}`)).kind, 'error')
  a.cancel({ kind: 'user' })
  await a.whenIdle()
  assert.equal(a.session.snapshotEvents().findLast(event => event.type === 'turn/end').data.reason.kind, 'aborted')
  await send(a, 'New turn after cancellation', [answer('Fresh plan')])

  const disconnected = { failure: { message: 'Connection error.', code: 'TRANSPORT' } }
  const interrupted = await send(a, 'Build and verify the HTML demo.', [
    delegate('Keep the built demo and verify the latest preview.'),
    requestTool('pwsh', 'demo-build', { command: 'build fixture' }),
    disconnected,
  ], 'error')
  assert.equal(interrupted.turn.at(-1).data.reason.error.code, 'TRANSPORT')
  assert.equal(interrupted.values.phase, 'error')
  const pending = a.session.snapshotEvents().reduce(fold, initialState())
  const legacy = [
    { type: 'turn/start', data: { turn: pending.turn + 1 } },
    { type: 'user/message', data: human('继续') },
    { type: 'user/message', data: stageMessage('plan', 'new_turn', roles, initialState()) },
    { type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'ORCHESTRATOR_PROTOCOL' } } } },
    { type: 'turn/start', data: { turn: pending.turn + 2 } },
  ].reduce(fold, pending)
  assert.deepEqual(phaseFor(legacy, 1, [human('继续')]), { phase: 'execute', reason: 'continuation' })
  assert.equal(fold(legacy, { type: 'session/end-seed', data: { inherited: true } }).continuation, null)
  await send(a, '继续', [disconnected], 'error')
  assert.equal(rowsFor(a.id).at(-1).phase, 'execute')
  const resumed = await send(a, '继续', [
    requestTool('browser_act', 'verify-after-retry'),
    { text: '[ORCH:REVIEW]\nThe built demo was verified in the browser.' }, answer('The demo is verified.'),
  ])
  assert.deepEqual(resumed.messages.map(message => receiptOf(message).phase), ['execute', 'execute', 'review'])
  assert.deepEqual(resumed.turn.filter(event => event.type === 'tool/call').map(event => event.data.name), ['browser_act'])
  const resumedRequest = rowsFor(a.id).at(-3)
  assert.ok(resumedRequest.messages.some(message => message.toolCallId === 'demo-build' && !message.isError))
  const resumedNotice = resumedRequest.messages.findLast(message => message.source?.record === 'stage')
  assert.match(textOf(resumedNotice), /Keep the built demo and verify the latest preview/)
  assert.equal(resumed.values.rounds, 1)
  await send(a, '继续', [answer('The earlier request is complete.')])
  assert.equal(rowsFor(a.id).at(-1).phase, 'plan')

  await send(b, 'Build the second demo.', [
    delegate('Build and record the output.'), requestTool('pwsh', 'second-build', { command: 'build fixture' }),
    { text: '[ORCH:REVIEW]\nThe second build completed.' }, disconnected,
  ], 'error')
  await ok(b, `set ${JSON.stringify(roles)}`)
  const review = await send(b, 'Please continue.', [row => {
    assert.equal(row.phase, 'review')
    assert.equal(row.provider, roles.planner.provider)
    assert.ok(!row.tools.includes('pwsh'))
    const notice = row.messages.findLast(message => message.source?.record === 'stage')
    assert.match(textOf(notice), /second build completed/)
    return answer('The second build passed final review.')
  }])
  assert.equal(review.values.reason, 'reviewed')
  await send(b, 'Build the third demo.', [delegate('Build the third demo.'), disconnected], 'error')
  await send(b, 'Explain a new topic.', [row => { assert.equal(row.phase, 'plan'); return disconnected }], 'error')
  await send(b, '继续', [answer('Continuing the explanation.')])
  assert.equal(rowsFor(b.id).at(-1).phase, 'plan')
  console.log('PASS continue after a transport error restores execution or read-only review, honors the newly selected pair, and clears stale work')
  const { sessionFormatCatalog } = requireHost('@deepseek-ai/dsh-session-format-catalog')
  const header = sessionFormatCatalog.encodeCurrentHeader({ ...a.session.header, delegationDepth: a.session.header.delegationDepth ?? 0 }, a.session.inheritedEventCount)
  const restore = sessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
  for (const event of a.session.snapshotEvents()) restore.decodeRow(JSON.parse(JSON.stringify(sessionFormatCatalog.encodeCurrentEvent(event))))
  const physical = restore.finish()
  assert.deepEqual(physical.events.reduce(fold, initialState()).view, root.sessionProjections.snapshot(a.session, [KEY]).values[KEY])
  assert.ok(physical.events.some(event => event.type === 'user/message' && event.data.source.record === 'stage'), 'role directives survived v4 disk codec')
  assert.ok(physical.events.some(event => event.type === 'assistant/message' && receiptOf(event.data.message)?.actor?.provider === roles.executor.provider), 'real executor identity survived v4 disk codec')
  console.log('PASS cancellation, busy-setting rejection, fresh planning after cancel, strict DSH V4 writer/reader round trip')
} finally {
  await root.fiber.dispose()
  await cleanStorage()
  clearTimeout(timeout)
}
