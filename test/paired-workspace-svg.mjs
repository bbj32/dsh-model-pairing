import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const browserDirectory = process.env.DSH_TEST_BROWSER_DIR
const skip = browserDirectory ? false : 'Set DSH_TEST_BROWSER_DIR to the local dsh-browser package directory.'

await test('paired models review a workspace SVG and read images according to role capability', { skip }, async () => {
  // The two Host plugins run in an independent DSH context with synthetic models.
  assert.ok(process.env.DSH_INSTALL_DIR, 'Set DSH_INSTALL_DIR to the installed @deepseek-ai/dsh package directory.')
  const runtime = createRequire(path.join(process.env.DSH_INSTALL_DIR, 'package.json'))
  const { Context } = runtime('@deepseek-ai/cordis')
  const { LlmAdapter, createUserMessage } = runtime('@deepseek-ai/dsh-llm')
  const orchestration = await import('../index.js')
  const { receiptOf } = await import('../state.js')
  const browser = await import(pathToFileURL(path.resolve(browserDirectory, 'host.js')).href)

  const ctx = new Context()
  const routes = new Map(), shots = [], calls = []
  const peer = { id: 'fixture-browser', principal: { kind: 'owner' } }
  const selection = {
    planner: { provider: 'fixture-planner', model: 'local' },
    executor: { provider: 'fixture-executor', model: 'local' },
  }
  const text = value => ({ type: 'text', text: value })
  const call = (id, name, args) => ({ type: 'tool-call', id, name, arguments: JSON.stringify(args) })
  const plans = [
    text('[ORCH:DELEGATE]\nOpen the workspace illustration and verify two animation phases and the console.'),
    { failure: { message: 'Offload the oldest image.', code: 'IMAGE_OFFLOAD_REQUIRED', offloadImages: 1 } },
    options => {
      const first = options.messages.find(message => message.toolCallId === 'first')
      assert.ok(first?.content.some(block => block.type === 'image' && block.offloaded))
      assert.ok(options.tools.some(tool => tool.name === 'read_image'))
      return call('read-snapshot', 'read_image', { file_path: 'fixture-capture.png' })
    },
    options => {
      const snapshot = options.messages.find(message => message.toolCallId === 'read-snapshot')
      assert.ok(snapshot?.content.some(block => block.type === 'image' && !block.offloaded))
      return text('[ORCH:ANSWER]\n已验证动画的两个相位，控制台没有错误。')
    },
  ]
  const steps = [
    call('open', 'browser_act', { action: 'navigate', url: 'sample.svg' }),
    call('first', 'browser_observe', { action: 'screenshot', delayMs: 150 }),
    call('second', 'browser_observe', { action: 'screenshot', delayMs: 350 }),
    call('console', 'browser_observe', { action: 'diagnostics' }),
    text('[ORCH:REVIEW]\nThe two PNGs differ. The console was checked.'),
  ]

  class LocalModel extends LlmAdapter {
    constructor(provider, sequence, inputModalities = ['text', 'image']) {
      super()
      this.provider = provider
      this.sequence = sequence
      this.inputModalities = inputModalities
    }
    async listModels() { return [{ provider: this.provider, id: 'local', name: 'Local deterministic fixture', inputModalities: this.inputModalities }] }
    async resolveModel() { return (await this.listModels())[0] }
    async *stream(options) {
      const action = this.sequence.shift()
      assert.ok(action, 'Unexpected extra model request')
      const next = typeof action === 'function' ? action(options) : action
      if (next.failure) {
        yield { type: 'finish', reason: { kind: 'error', failure: next.failure } }
        return
      }
      calls.push({ provider: this.provider, sessionId: options.sessionId })
      yield { type: 'block-end', index: 0, block: next }
      yield { type: 'usage', usage: { inputTokens: 128, outputTokens: 15 } }
      yield { type: 'finish', reason: { kind: next.type === 'tool-call' ? 'tool-calls' : 'stop' } }
    }
  }

  async function mount(name, config = {}) {
    const plugin = runtime('@deepseek-ai/' + name)
    const fiber = await ctx.plugin(plugin.default ?? plugin, config)
    if (fiber.error) throw fiber.error
  }

  const signal = AbortSignal.timeout(55000)
  const dir = await realpath(tmpdir())
  const temp = await mkdtemp(path.join(dir, 'dsh-paired-svg-'))
  try {
    await writeFile(path.join(temp, 'sample.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280"><rect width="400" height="280" fill="#cdddd4"/><circle cy="100" r="28" fill="#753b28"><animate attributeName="cx" from="38" to="364" dur="1.6s" repeatCount="indefinite"/></circle></svg>')
    await mount('dsh-storage')
    await mount('dsh-storage-json', { root: path.join(temp, 'settings') })
    await mount('dsh-storage-domain', { backend: 'json' })
    await mount('dsh-session-projection')
    await mount('dsh-agent')
    await mount('dsh-session')
    await mount('dsh-session-persistence-jsonl', { root: path.join(temp, 'sessions'), compression: 'none' })
    await mount('dsh-llm')
    await mount('dsh-system-prompt', { includeHarnessIdentity: false, includeRuntimeContext: false })
    await mount('dsh-tools')
    await mount('dsh-tool-executor-native')
    await mount('dsh-commands')
    await mount('dsh-sandbox-policy', { defaultMode: 'read-only', workspaceRoot: temp })
    await mount('dsh-fs-sandbox', { cwd: temp })
    await mount('dsh-working-directory', { defaultDirectory: temp })
    await mount('dsh-agent-loop')

    for (const key of ['sessionController', 'connection', 'attachments', 'subagents', 'webServer', 'webApp']) ctx.provide(key)
    ctx.set('sessionController', { async resolveAgent(id) {
      const agent = ctx.agents.get(id)
      return agent ? { agent } : { error: { code: 'session/not-found', message: 'missing session' } }
    } })
    ctx.set('connection', {
      browserPeer: peer, admit: () => ({ peer }),
      fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } },
    })
    ctx.set('attachments', {
      imageLimits: { mediaTypes: ['image/png'], maxImageBytes: 5_000_000, maxMessageImageBytes: 5_000_000 },
      async saveImage({ data, mediaType, name }) {
        const bytes = Buffer.from(data)
        assert.equal(mediaType, 'image/png')
        assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        const attachmentId = createHash('sha256').update(bytes).digest('hex')
        if (name !== 'fixture-capture.png') {
          if (!shots.length) await writeFile(path.join(temp, 'fixture-capture.png'), bytes)
          shots.push(attachmentId)
        }
        return { attachmentId, mediaType, name, bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
      },
    })
    await mount('dsh-tool-fs', { read: false, write: false, edit: false })
    await mount('dsh-compaction-image-offload')
    ctx.set('subagents', { rootOf: agent => agent, namesOf: () => ({ self: 'fixture' }) })
    const origin = 'http://fixture.invalid'
    ctx.set('webServer', { getOrigin: () => origin })
    ctx.set('webApp', { getAdvertisedUrl: () => origin })
    ctx.llm.registerAdapter([selection.planner.provider], new LocalModel(selection.planner.provider, plans))
    ctx.llm.registerAdapter([selection.executor.provider], new LocalModel(selection.executor.provider, steps))
    const fiber = await ctx.plugin(orchestration, { reviewEvery: 8 })
    if (fiber.error) throw fiber.error
    const webFiber = await ctx.plugin(browser, {})
    if (webFiber.error) throw webFiber.error

    const { agent } = await ctx.agents.create({ sessionId: 'pair-browser-menu', agentOptions: selection.planner, meta: { cwd: temp } })
    const endpoint = 'workbuddy/model-pairing'
    const route = routes.get('/api/' + endpoint)
    assert.ok(route)
    const request = new Request(origin + route.path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal,
      body: JSON.stringify({ type: 'client-request', rpcId: 'paired-svg', method: endpoint, payload: { sessionId: agent.id, action: 'on', selection } }),
    })
    const result = await (await route.fetch(request)).json()
    assert.equal(result.result.ok, true, JSON.stringify(result))
    assert.deepEqual(result.result.value.selection, selection)
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [text('打开工作区 sample.svg，验证两个动画相位并检查控制台。')] }))
    await agent.whenIdle()
    signal.throwIfAborted()

    const events = agent.session.snapshotEvents()
    const results = events.filter(event => event.type === 'tool/result').map(event => event.data.message)
    const errors = results.filter(message => message.isError).map(({ toolCallId, content }) => ({ toolCallId, content }))
    assert.deepEqual(errors, [], 'Browser tools should complete in the fixture workspace')
    const ended = events.findLast(event => event.type === 'turn/end')
    assert.equal(ended?.data.reason.kind, 'completed', JSON.stringify(ended?.data))
    assert.equal(events.some(event => event.type === 'command/run' || event.type === 'command/done'), false)
    assert.deepEqual(results.map(message => message.toolCallId), ['open', 'first', 'second', 'console', 'read-snapshot'])
    assert.equal(results.at(-1).content.find(block => block.type === 'image').attachment.attachmentId, shots[0])
    assert.equal(events.filter(event => event.type === 'image/offload').length, 1)
    const diagnostic = JSON.parse(results.find(message => message.toolCallId === 'console').content.find(block => block.type === 'text').text)
    assert.deepEqual(diagnostic.console, [])
    assert.equal(shots.length, 2)
    assert.notEqual(shots[0], shots[1])
    const messages = events.filter(event => event.type === 'assistant/message').map(event => event.data.message)
    const visible = messages.flatMap(message => message.content.filter(block => block.type === 'text').map(block => block.text))
    assert.deepEqual(visible, ['已验证动画的两个相位，控制台没有错误。'])
    const hidden = messages.filter(message => ['delegate', 'report'].includes(receiptOf(message)?.action))
    assert.equal(hidden.length, 2)
    assert.ok(hidden.every(message => message.content.some(block => block.type === 'reasoning')))
    assert.equal(plans.length + steps.length, 0)
    assert.ok(calls.every(call => call.sessionId === agent.id))

    const textRoute = { provider: 'fixture-text', model: 'local' }
    const expectTextOnly = options => {
      assert.ok(!options.tools.some(tool => tool.name === 'read_image'))
      assert.ok(options.messages.every(message => !message.content.some(block => block.type === 'image')))
    }
    const textSteps = [
      options => { expectTextOnly(options); return text('[ORCH:DELEGATE]\nRead the saved image and report its dimensions.') },
      options => { expectTextOnly(options); return text('[ORCH:ANSWER]\nThe image dimensions were verified.') },
      options => { expectTextOnly(options); return text('[ORCH:ANSWER]\nThe text summary is ready.') },
    ]
    ctx.llm.registerAdapter([textRoute.provider], new LocalModel(textRoute.provider, textSteps, ['text']))
    steps.push(
      options => {
        assert.ok(options.tools.some(tool => tool.name === 'read_image'))
        assert.ok(options.messages.some(message => message.content.some(block => block.type === 'image' && !block.offloaded)))
        return call('mixed-read', 'read_image', { file_path: 'fixture-capture.png' })
      },
      text('[ORCH:REVIEW]\nThe saved image dimensions were read.'),
    )
    for (const [pair, prompt] of [
      [{ planner: textRoute, executor: selection.executor }, 'Check the dimensions of the preview image.'],
      [{ planner: textRoute, executor: textRoute }, 'Summarize the result.'],
    ]) {
      const changed = await ctx.commands.execute(agent, `/orchestrator set ${JSON.stringify(pair)}`, [], signal)
      assert.equal(changed.result.kind, 'success', changed.result.text)
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [text(prompt)] }))
      await agent.whenIdle()
      signal.throwIfAborted()
      const last = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
      assert.equal(last?.data.reason.kind, 'completed', JSON.stringify(last?.data))
    }
    const mixedRead = agent.session.snapshotEvents().find(event => event.type === 'tool/result' && event.data.message.toolCallId === 'mixed-read')
    assert.equal(mixedRead?.data.message.isError, false)
    assert.equal(textSteps.length + steps.length, 0)
  } finally {
    try { await ctx.fiber.dispose() } finally {
      const owned = await realpath(temp)
      assert.equal(path.dirname(owned), dir)
      assert.ok(path.basename(owned).startsWith('dsh-paired-svg-'))
      await rm(owned, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 })
    }
  }
})
