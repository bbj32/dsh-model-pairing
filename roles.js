import { createHash } from 'node:crypto'
import { SOURCE, isContinuationMessage, receiptOf, roleForPhase } from './state.js'

// Only operations with a read-only contract enter planner/reviewer requests.
// A tool that combines navigation, editing or execution with observation belongs
// to the executor. Unknown tools are available there through the normal preset.
const reads = new Set([
  'read', 'read_image', 'glob', 'grep', 'skill', 'web_search', 'web_fetch',
  'cordis_inspect_list', 'cordis_inspect_query', 'session_search', 'session_trace',
  'session_event_search', 'session_event_read', 'session_event_trace',
  'list_agents', 'list_subagent_models', 'browser_observe', 'ask_user_question',
])

export function readOnlyTool(name) { return reads.has(name) }

export function isHumanMessage(message) { return message.source?.kind === 'user' }

export function phaseFor(state, step, messages) {
  if (step === 1 && state.continuation) {
    const inputs = messages.filter(isHumanMessage)
    if (inputs.length === 1 && isContinuationMessage(inputs[0])) {
      return { phase: state.continuation.phase, reason: 'continuation' }
    }
  }
  if (!state.roles || step === 1) return { phase: 'plan', reason: 'new_turn' }
  if (messages.some(isHumanMessage)) return { phase: 'review', reason: 'user_steering' }
  return { phase: state.view.phase, reason: state.view.reason }
}

export function stageMessage(phase, reason, roles, state) {
  const executor = phase === 'execute'
  const actor = executor ? roles.executor : roles.planner
  const guide = executor ? [
    'Carry out the latest request using the available tools. Resume from the latest result and verify the current artifact after changes, rebuilding it when needed. Reuse the current browser tab and its returned state. Capture new images for distinct visual checks or timed comparisons.',
    'Use [ORCH:REPLAN] for a genuine blocker, repeated failure or necessary change of approach. Use [ORCH:REVIEW] when ready for acceptance. Include verified results, deliverable paths and remaining limits.',
  ] : [
    'You are the read-only planner and reviewer. Use committed tool results and any checkpoint summary first. Read or observe only to settle a specific open question. Give file changes, commands and browser interactions to the executor.',
    'Use [ORCH:ANSWER] for a direct answer, an explicit plan-only request, a concrete blocker or verified completion. Include deliverable links and verification limits where relevant. Ask the user only for a specific decision or input that is needed.',
    'Use [ORCH:DELEGATE] for an action request or a revised approach. Give the next work and acceptance criteria, then hand off promptly. Keep routine checks and implementation details with the executor. If an optional lookup fails, continue from the evidence already available.',
    ...(phase === 'review' && state.plan ? ['Use [ORCH:CONTINUE] to return to the current plan. Include only new findings and the next unchecked item.'] : []),
  ]
  const notes = [
    phase === 'replan' ? 'Revise the plan using the blocker and available evidence before handing back.' : '',
    reason === 'continuation' ? 'The user asked to continue unfinished work. Use the original request and committed tool results. Resume with the first unchecked item. Verify uncertain outcomes before retrying an operation.' : '',
    reason === 'user_steering' ? 'The user steered the active turn. Reconcile their newest message with the executor’s progress and earlier requirements before taking the next decision.' : '',
    reason === 'periodic_review' ? 'Check recent results for blockers and steer the remaining work. Leave pending builds and multi-step checks with the executor. Accept only when the requested work is verified.' : '',
    reason === 'protocol' ? 'Use a decision marker or an available tool to move the task forward.' : '',
    state.plan ? `Current implementation plan\n${state.plan}` : '',
    state.view.progress && state.view.progress !== state.plan ? `Latest progress or blocker\n${state.view.progress}` : '',
  ].filter(Boolean)
  return {
    source: { kind: SOURCE, form: 'notice', summary: `${phase} · ${actor.provider}/${actor.model}`.slice(0, 120), record: 'stage', version: 1, phase, reason, roles },
    content: [{ type: 'text', text: [`DSH orchestration · ${phase} · ${actor.provider}/${actor.model}`, ...guide, ...notes,
      'For a text decision, put its marker on the first line and write the body in the user’s language. Use ordinary native tool calls for tool work.'].join('\n\n') }],
  }
}

// V4's physical codec can reorder object properties on restore. Hash semantic
// JSON fields in a stable order. IDs/timestamps of DSH log rows never go on wire.
function canonical(value) {
  return JSON.stringify(value, (_, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
  })
}
export function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex') }

function assistantHistory(message, record, binding, before) {
  const actor = record.actor
  const source = { kind: 'model', provider: actor.provider, model: actor.model }
  const native = record.native
  const intact = native && native.surface === digest(message.content)
  const same = intact && native.scope === binding && native.before === before
  // Never resurrect removed/replaced text from cached full transcripts. Only
  // invert the documented presentation edits on the CURRENT surface. A rewrite
  // or prefix change cannot reactivate a signature, response id or tool batch.
  const content = message.content.flatMap((block, i) => {
    if (intact && native.text?.includes(i)) {
      return [{ type: 'text', text: (same && native.first === i ? native.prefix ?? '' : '') + block.text }]
    }
    if (block.type === 'reasoning' && !same) return []
    if (same && native.first === i && block.type === 'text' && native.prefix) return [{ ...block, text: native.prefix + block.text }]
    return [block]
  })
  if (same && record.inner !== undefined) source.replayState = record.inner
  return { ...message, content, source }
}

// Auxiliary title/compaction requests get only the currently visible surface.
// Provider-private replay is valid only in the original role's exact prefix.
export function neutralMessages(messages) {
  return messages.map(message => {
    const record = receiptOf(message)
    return record ? assistantHistory(message, record, null, null) : message
  })
}

// Local preview was added after the browser's first release. A tool
// name alone neither admits the tool in this step nor guarantees this feature.
export function workspacePreviewGuide(tools = []) {
  const advertisesSvg = tool => /workspace.{0,40}svg|svg.{0,45}workspace/i.test(`${tool.description ?? ''} ${tool.parameters?.properties?.url?.description ?? ''}`)
  const navigation = tools.find(tool => tool.name === 'browser_act' && advertisesSvg(tool))
  if (navigation) return 'The executor can open a regular workspace SVG directly using browser_act with action new or navigate and its relative path, absolute path or file:/// URL in url. Observe the resulting tab. No HTTP server is needed. Honor actual missing-file, approval and access results.'
  if (tools.some(tool => tool.name === 'browser_task' && advertisesSvg(tool))) return 'The executor can give the workspace SVG path and visual checks to browser_task for direct preview. No HTTP server is needed. Honor actual missing-file, approval and access results.'
  return ''
}

export function roleRequest(options, config, stage, tools, previewGuide = '') {
  const role = roleForPhase(stage)
  const scope = digest(['dsh-pair/v2', options.sessionId, role, config]).slice(0, 32)
  const system = [`DSH model pairing · ${role} · ${scope}`, previewGuide, options.system].filter(Boolean).join('\n\n')
  const chain = createHash('sha256').update(canonical([system, tools]))
  const messages = []
  for (let message of options.messages) {
    if (message.source?.kind === SOURCE) {
      if (message.source.record !== 'stage' || roleForPhase(message.source.phase) !== role) continue
    }
    const record = receiptOf(message)
    if (record) {
      message = assistantHistory(message, record, scope, chain.copy().digest('hex'))
      if (!message.content.length) continue
    } else if (message.role === 'assistant') {
      // Pre-pairing turns, interrupted responses and foreign assistant messages
      // have no binding to either role. Keep portable content and tool pairings.
      const { provider, model } = message.source
      const content = message.content.filter(block => block.type !== 'reasoning')
      if (!content.length) continue
      message = { ...message, content, source: { kind: 'model', provider, model } }
    }
    messages.push(message)
    const native = message.role === 'assistant' ? message.source : null
    chain.update('\0').update(canonical([message.role, message.content, native, message.toolCallId ?? null, message.isError ?? null]))
  }
  return { system, messages, scope, before: chain.digest('hex') }
}

// Deliberately narrow execution evidence check. An informational or plan-only
// request may end in the planner, and a specific blocker may be asked directly.
const acknowledge = /^(?:好(?:的|啊|吧)?|行|可以|继续(?:吧|执行|操作)?|开始(?:吧|执行)?|确认|同意|yes|sure|ok(?:ay)?|continue|proceed|go ahead)(?:[\s，,]+(?:继续|开始|执行|continue|proceed))?[\s.!。！]*$/i
const planOnly = /(?:只(?:想|要|需要|需|给|提供|列|写)|仅(?:需|要|给|提供|列|写)|仅仅)[^。！？\n]{0,24}(?:方案|计划|思路|步骤|说明)|(?:plan|explanation|instructions) only|(?:only|just) (?:give|provide|write|want).{0,22}(?:plan|instructions)/i
const negativeClause = /^(?:(?:请|先|please)\s*)?(?:不要|不用|暂不|无需|先别|禁止|do not|don't|never)\s*/i
const operation = /^(?:(?:请你|请|麻烦你|麻烦|帮我|给我|帮忙|现在|直接|顺便|然后|先|并且|并|只|能否|能不能|可以帮我|把|将)\s*)*(?:打开|浏览|访问|点击|下载|上传|修改|编辑|删除|修复|安装|运行|执行|构建|部署|测试|核验|保存|写入|检查这个文件|验证这个文件)|^(?:(?:please|now|then|and|could you|can you|would you|go ahead and)\s+)*(?:open|visit|browse|click|download|upload|edit|modify|delete|fix|install|run|deploy|build|test|save|write to)\b/i
const drawSvg = /(?:用\s*svg\s*(?:给我)?(?:画|绘制|做|生成|制作)|(?:画|绘制|做|生成|制作).{0,28}svg|(?:draw|create|generate|make)\b.{0,65}\bsvg\b)/i
const externalSvg = /保存(?:为|到)|写入|另存|浏览器.{0,8}(?:实测|打开|核验)|(?:并|然后|再)(?:在浏览器中)?(?:打开|实测|验证|检查)|\b(?:save|write to|open it|verify in|in the browser)\b/i
const messageText = message => message?.content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim() ?? ''
const isRequest = message => isHumanMessage(message) && messageText(message)
  && !isContinuationMessage(message) && !acknowledge.test(messageText(message))

function requestedMessage(messages) {
  const lastInput = messages.findLastIndex(isHumanMessage)
  const latest = messages[lastInput]
  if (!isContinuationMessage(latest)) return messages.findLast(isRequest)
  // A bare continuation after a final answer does not reopen its tool actions.
  for (let index = lastInput - 1; index >= 0; index--) {
    const message = messages[index]
    if (receiptOf(message)?.action === 'answer') return latest
    if (isRequest(message)) return message
  }
  return latest
}
export function actionRequest(messages) {
  const text = messageText(requestedMessage(messages))
  if (planOnly.test(text)) return false
  const clauses = text.split(/[。！？!?；;，,\n]|\.\s+/).map(clause => clause.trim()).filter(clause => !negativeClause.test(clause))
  if (clauses.some(clause => operation.test(clause))) return 'external'
  if (!clauses.some(clause => drawSvg.test(clause))) return false
  return clauses.some(clause => externalSvg.test(clause)) ? 'external' : 'svg'
}

const blocker = /(?:\b(?:permission|access) (?:was |is )?denied\b|\b(?:file|path|url|directory|account) (?:is |was )?(?:missing|not found|unavailable)|\b(?:I (?:cannot|can't|couldn't)|I(?:'m| am) unable to) (?:access|locate|open|identify|authenticate|connect|fulfill)|\bwhich (?:one|file|directory|path|site|environment)|\b(?:need|provide|specify) (?:the |your |a )?(?:exact |full )?(?:path|url|login|credentials|permission))|(?:权限不足|访问被拒绝|没有(?:此|该|读取|写入|访问|打开)?权限|(?:未找到|找不到|缺少)(?:此|该|指定的|可用的)?(?:文件|目录|路径|输入|网址|工具|授权)|无法(?:访问|定位|打开|连接|登录)|请(?:先)?(?:提供|指定|选择|确认).{0,18}(?:路径|文件|网址|账号|登录|授权)|(?:哪个|哪一个)(?:文件|目录|路径|环境))/i
const futurePlan = /(?:shall|should|may|can|would you like) (?:i|me to) (?:begin|start|proceed|go ahead|continue|open|run)|\bI(?:'ll| will| plan to)\b|(?:是否|要不要|需要我|可以开始|要我)(?:.{0,8})(?:开始|继续|打开|执行|动手)|(?:我(?:将|会|准备)|下一步(?:是|我会))/i

const server = /(?:http(?:s)?\s*(?:server|serv(?:ice)?|服务)|python(?:\s+-m\s+http\.server|.{0,18}(?:http|server|服务))|(?:本地|静态)(?:服务器|服务)|localhost|local (?:web )?server)/i
const fileLimitation = /(?:file:\/{2,3}|本地(?:文件|路径)|local (?:files?|paths?)).{0,65}(?:cannot|can.t|unable|unsupported|blocked|not (?:available|supported|allowed)|不支持|不能|无法|不允许)|(?:cannot|can.t|unable|unsupported|blocked|不支持|不能|无法|不允许).{0,65}(?:file:\/{2,3}|本地(?:文件|路径)|local (?:files?|paths?))/i
export function untriedPreview(messages, guide) {
  if (!guide) return ''
  const requested = requestedMessage(messages)
  const text = messageText(requested)
  if (planOnly.test(text)) return ''
  const clauses = text.split(/[。！？!?；;，,\n]|\.\s+/).map(part => part.trim()).filter(part => !negativeClause.test(part))
  if (!clauses.some(part => operation.test(part) || /^(?:(?:请|帮我|麻烦|直接|可以)\s*)*(?:(?:用|在|使用)(?:共享|内置)?浏览器(?:中|里)?\s*)?(?:预览|核验|检查|查看|截图|打开)|^(?:(?:please|can you|could you)\s+)*(?:preview|render|inspect|verify|screenshot)\b/i.test(part))) return ''
  if (clauses.some(part => server.test(part) && /(?:启动|运行|搭建|架设|\b(?:start|serve|launch|run)\b|python\s+-m\s+http\.server)/i.test(part))) return ''
  const local = clauses.join(' ').replace(/https?:\/\/[^\s<>"'`，。]+/gi, '').match(/[^\s/\\:"'`<>，。；！？(（)）]+\.svg\b/i)
  if (!local) return ''
  const file = /[\p{Script=Latin}\p{N}_.-]+\.svg$/iu.exec(local[0])?.[0].toLowerCase() ?? local[0].toLowerCase()
  const calls = new Map()
  for (const msg of messages.slice(messages.indexOf(requested) + 1)) {
    if (msg.role === 'assistant') for (const block of msg.content) {
      if (block.type !== 'tool-call') continue
      const target = block.arguments.toLowerCase()
      let readable = target
      try { readable = decodeURIComponent(target).toLowerCase() } catch { /* Some tool arguments contain literal percent signs. */ }
      const targetNames = readable.match(/[^\s/\\:"'`<>，。；！？(（)）]+\.svg\b/gi) ?? []
      if (targetNames.some(name => file === name || file.endsWith(name) || name.endsWith(file))) calls.set(block.id, block.name)
    }
    if (msg.role === 'tool' && calls.has(msg.toolCallId)) {
      const name = calls.get(msg.toolCallId)
      // A returned browser state (including a pending human decision) or a
      // real filesystem/policy error is evidence; do not override it.
      // Prior releases committed the original tool name in this session's history.
      if (['browser_act', 'browser_task', 'antigravity_browser_act'].includes(name) || msg.isError || blocker.test(messageText(msg))) return ''
    }
  }
  return guide
}

const directive = /^\s*\[ORCH:(ANSWER|DELEGATE|REPLAN|REVIEW|CONTINUE)\][ \t]*(?:\r?\n|$)/i

function lateHandoff(text) {
  const marker = /([。！？.!?\n])[ \t]*\[ORCH:DELEGATE\][ \t]*\r?\n/i.exec(text)
  if (!marker || text.match(/\[ORCH:[A-Z]+\]/gi)?.length !== 1) return ''
  const before = text.slice(0, marker.index + marker[1].length).trim()
  const after = text.slice(marker.index + marker[0].length).trim()
  if (!after || /(?:```|~~~)/.test(before)) return ''
  return [before, after].filter(Boolean).join('\n\n')
}

export function decide(phase, content, restricted, steer, evidence = {}) {
  if (steer) return { action: 'report', summary: 'A user message arrived before the pending tool batch was dispatched. Review the latest message and the work already recorded.', replace: true }
  const calls = content.filter(block => block.type === 'tool-call')
  const text = content.filter(block => block.type === 'text').map(block => block.text).join('\n').trim()
  const match = directive.exec(text)
  const marker = match?.[1].toUpperCase()
  const summary = (match ? text.slice(match[0].length) : text).trim()
  const canResume = ['review', 'replan'].includes(phase) && evidence.hasPlan
  const canRecover = canResume && !evidence.resumedAutomatically
  if (restricted.length) {
    const names = [...new Set(restricted)].join(', ')
    if (canRecover && restricted.every(name => evidence.executionOnly?.has(name))) {
      const next = `Continue the outstanding work using the executor’s available tools. The reviewer requested ${names}. That batch did not run.`
      return { action: 'resume', summary: summary ? `${next}\n\n${summary}` : next, corrected: true, automaticResume: true }
    }
    return { action: 'repair', summary: `This step did not dispatch the requested tool batch. Unavailable in this phase: ${names}. Use a tool offered in this step or issue a decision.`, replace: true }
  }
  // Asking the user to authorize starting a web server can also be expressed
  // through DSH's question tool. Correct only this unsupported inference, never
  // a real policy decision or an explicitly requested server operation.
  const questionOnly = calls.length && calls.every(call => call.name === 'ask_user_question')
  const claim = questionOnly ? calls.map(call => call.arguments).join('\n') : text
  if (evidence.preview && (!calls.length || questionOnly) && server.test(claim)
    && (fileLimitation.test(claim) || /(?:需要|必须|启动|搭建|允许|授权|\b(?:need|must|start|launch|permission)\b)/i.test(claim))) {
    return { action: phase === 'execute' ? 'repair' : 'delegate', summary: evidence.preview, replace: true, corrected: true }
  }
  if (calls.length) return { action: 'tools', summary: '', replace: false }
  if (phase === 'review' && canResume && marker === 'CONTINUE') {
    return { action: 'resume', summary: summary || 'Continue the current plan from the latest tool result.', corrected: !summary }
  }
  if (phase !== 'execute' && !marker && summary) {
    const handoff = lateHandoff(summary)
    if (handoff) return { action: 'delegate', summary: handoff, corrected: true }
    if (canRecover && evidence.periodicReview && !blocker.test(summary)) {
      return { action: 'resume', summary, automaticResume: true }
    }
  }
  const delivered = evidence.needsAction === 'svg' && /<svg\b[^>]*>[\s\S]*?<(?:g|path|circle|rect|line|polygon|use|image|text)\b[\s\S]*?<\/svg>/i.test(summary)
  if (summary && evidence.needsAction && !delivered && !blocker.test(summary)) {
    if (phase === 'execute' && marker !== 'REPLAN' && !evidence.executorTools) {
      return { action: 'repair', summary: 'Carry out the authorized action using an available tool, or identify the specific missing permission, input or capability.', replace: true }
    }
    if (phase !== 'execute' && marker === 'ANSWER' && (!evidence.successfulTools || futurePlan.test(summary))) {
      return { action: 'delegate', summary: 'Carry out the original user request now. Use the available tools and verify the result before returning it for review.', replace: true, corrected: true }
    }
  }
  if (summary && phase === 'execute') {
    return { action: marker === 'REPLAN' ? 'replan' : 'report', summary, replace: !!marker }
  }
  if (summary && (marker === 'DELEGATE' || marker === 'ANSWER')) {
    return { action: marker === 'DELEGATE' ? 'delegate' : 'answer', summary, replace: true }
  }
  return { action: 'repair', summary: summary || 'A non-empty decision is required.', replace: true }
}

export function protocolPrefix(text) { return directive.exec(text)?.[0] ?? '' }

export function prefixForStreaming(text, phase) {
  const match = directive.exec(text)
  if (!match || !match[0].endsWith('\n')) return null
  if (phase !== 'execute' && match[1].toUpperCase() === 'ANSWER') return match[0].length
  return null
}
