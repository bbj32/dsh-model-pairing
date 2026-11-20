import { createUserMessage, schema } from './runtime.js'
import { OrchestratorAdapter } from './adapter.js'
import { PROVIDER, SOURCE, isOrchestrator, projection } from './state.js'
import { phaseFor, readOnlyTool, stageMessage } from './roles.js'
import { mountSettings } from './settings.js'

export const name = 'workbuddy-model-orchestration'
export const inject = ['llm', 'agents', 'commands', 'tools', 'sessionProjections', 'storageDomain']
const actorConfig = () => schema.object({ provider: schema.string().required(), model: schema.string().required(), reasoningEffort: schema.string() })
export const Config = schema.object({
  roles: schema.union([schema.const(null), schema.object({ planner: actorConfig().required(), executor: actorConfig().required() })]).default(null).volatile(),
  reviewEvery: schema.number().min(1).step(1).default(4).volatile(),
})

export async function apply(ctx, config) {
  const projectionHandle = await ctx.sessionProjections.register(projection)
  const read = session => projectionHandle.stateOf(session)
  const rolesFor = await mountSettings(ctx, config, read)
  const adapter = new OrchestratorAdapter(ctx, read, rolesFor, () => config.reviewEvery.get())
  ctx.effect(() => ctx.llm.registerAdapter([PROVIDER], adapter))
  ctx.on('agent/pre-step', async ({ agent, turn, step, modelSelection }, next) => {
    const decision = await next()
    if (!isOrchestrator(modelSelection) || decision.kind !== 'enter' || (!decision.messages.length && step === 1)) return decision
    const state = read(agent.session)
    const pair = state.roles && state.turn === turn ? state.roles : rolesFor(agent)
    if (!pair) throw new Error('请在模型菜单中选择规划和执行模型。 / Select a planner and executor in the model menu.')
    let { phase, reason } = phaseFor(state, step, decision.messages)
    if (phase === 'complete' || phase === 'idle' || phase === 'error') { phase = 'review'; reason = 'user_steering' }
    const changed = state.dispatch !== phase || state.lastDirective < 0 || state.continueStep || reason === 'user_steering'
    if (!changed) return decision
    const notice = createUserMessage(stageMessage(phase, reason, pair, state))
    return { ...decision, messages: [...decision.messages, notice] }
  })
  ctx.on('agent/turn-stopping', ({ agent, turn, signal }) => {
    if (signal.aborted || !isOrchestrator(agent.model.current())) return
    const state = read(agent.session)
    if (!state.continueStep || state.turn !== turn || agent.inbox.nextStep.length) return
    const summary = `Continue orchestration · ${state.view.phase}`
    agent.steer(createUserMessage({ source: { kind: SOURCE, form: 'notice', summary }, content: [{ type: 'text', text: summary }] }))
  })
  ctx.effect(() => ctx.tools.guard(exec => {
    if (!exec.agent) return
    const state = read(exec.agent.session)
    if (state.view.enabled && ['plan', 'replan', 'review'].includes(state.dispatch) && !readOnlyTool(exec.name)) {
      return 'The current orchestration step is read-only. Hand work requiring this tool to the executor.'
    }
  }))
}
