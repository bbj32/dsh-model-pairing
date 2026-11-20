# DSH 模型配对

在同一个 DeepSeek Harness（DSH）会话里，规划模型负责拟定计划和验收，执行模型调用工具完成工作。模型配对可以单独使用。需要观察或操作网页时，可以另外安装浏览器插件。[DSH 内置浏览器](https://github.com/bbj32/dsh-browser)

## 安装

1. 准备兼容的 DSH，插件声明的版本范围为 `>=0.2.2-rc.5 <0.3.0`。先在 DSH 中配置至少一个可用模型。
2. 在 DSH 打开「插件 → 添加插件」，粘贴下面的安装地址。

   ```text
   https://github.com/bbj32/dsh-model-pairing/releases/download/v1.2.0/workbuddy-dsh-antigravity-orchestrator-1.2.0.tgz
   ```

3. 点击安装并启用「DSH 模型配对」。如果插件管理器提示重启，按提示重启 DSH。安装后显示的包名是 `@workbuddy/dsh-antigravity-orchestrator`。

也可以下载并解压对应版本的源码，在安装框输入 DSH 主机上插件根目录的绝对路径。DSH 直接从这里加载插件，请保留这个目录。[v1.2.0 源码 ZIP](https://github.com/bbj32/dsh-model-pairing/archive/refs/tags/v1.2.0.zip)

## 使用

在 DSH 会话中打开模型菜单，点「DSH 模型配对」，分别选择规划模型、执行模型及各自的思考级别，再点「启用配对」。两个角色可以使用同一模型，也可以跨提供方。角色使用 DSH 已配置的模型、权限、工具和计费。运行时直接调用这些提供方，两个角色在自己的步骤中都能看到该会话的上下文。

每个新用户轮次先由规划模型只读检查，再直接回答或把计划和验收条件交给执行模型。执行遇阻、同一校验操作失败两次、用户插话、达到进度复核间隔或提交完成报告时，规划模型会根据已有证据决定继续、调整计划或验收。进度复核可以沿用当前计划，只补充下一项待验收工作。复核误选执行侧工具时，插件可将后续工作交回执行模型，由它按 DSH 原生工具流程处理。

进行中的角色和阶段显示在输入区。配对按会话保存，默认配对可在配置窗口设置。变更默认配对在后续轮次生效。关闭配对会恢复原来的单模型及显式思考级别。默认每十二批执行工具进行一次进度复核，插件设置 `reviewEvery` 可调整间隔。用户插话在下一步骤生效，已开始的工具遵循 DSH 的取消语义。

规划和复核阶段开放读取、搜索和必要的提问。插件会拦截空白提问，同批的有效工具照常执行。启用内置浏览器后，规划者可用 `browser_observe` 观察当前页签，执行者可用 `browser_act` 操作，或用 `browser_task` 委派浏览任务。明确声明支持图片输入的角色可以使用原生 `read_image`，混合配对也会保留图片供视觉角色读取。工具遵循 DSH 原有的审批、取消和会话归属。仅开放 `run_code` 的预设由执行角色调用该工具，规划角色使用已有记录。该插件使用 DSH 实现 Google 公开描述的编排流程。模型名称及输出来自用户选定的 DSH 提供方。[Google Antigravity 模型文档](https://antigravity.google/docs/models#orchestrator)

## 对话和缓存

通过模型菜单查看、保存或启用配对时，设置直接保存到该会话。主对话展示给用户的最终答复，规划、执行交接和复核细节使用 DSH 自带的过程展示。工具结果及文件、需要回答的问题、执行错误仍可在原有位置查看。对允许调用工具的请求，配对会等本次模型响应结束后再显示最终正文，这样模型在正文之后追加的工具也能实际执行。无工具的普通答复可以实时显示。自己输入 `/orchestrator` 时，会话会留下该命令及结果。过去成功的配对写入显示为一行，展开可看原命令和完整 JSON。带有精确用量的旧版交接仍沿用该会话原有的工作详情显示方式，以保留整轮 token 统计。

规划、执行和复核分别发起模型请求，每次调用都计入该角色所选提供方的额度。同一轮完成工具操作并验收，通常会产生多次调用。

规划和执行各自使用稳定的请求前缀及工具顺序。同一角色再次调用同一模型和参数时，可以复用未变化的前缀及符合条件的提供方重放信息。复核使用规划模型的前缀。同一个模型同时担当两个角色时，两个角色各自保有可复用的前缀。实际会话 ID 沿用 DSH 的值，便于提供方关联本次调用。切换模型或思考级别、压缩上下文、缓存过期都可能减少命中。

配对窗口分别列出规划和执行的缓存读取 token 与写入 token。提供方明确上报零时，窗口显示零。缺少字段时显示未上报，只有部分请求返回用量时标明覆盖次数。首次请求通常需要预热，支持范围、最短前缀、保留时长和计费由各提供方决定。

## 会话命令

`/orchestrator` 显示当前配对和状态，`/orchestrator catalog` 列出本机 DSH 提供方与模型，`/orchestrator model {"provider":"提供方 ID","model":"模型 ID"}` 列出该模型的思考级别。以下命令中的占位值使用目录给出的精确 ID。

```text
/orchestrator on {"planner":{"provider":"提供方 A","model":"规划模型"},"executor":{"provider":"提供方 B","model":"执行模型"}}
/orchestrator off
```

`set` 接受相同的两角色 JSON，将选择保存到当前会话。`use` 启用已保存的配对，`default` 写入默认配对。可在任一角色中加入 `reasoningEffort`；省略时沿用该模型的提供方默认值。插件注册的原生编排路由为 `dsh-orchestrator/orchestrator`。

## 从源码运行测试

在本仓库的源码根目录运行。测试从 `DSH_INSTALL_DIR` 指向的 `@deepseek-ai/dsh` 安装目录解析 Host 模块，使用新的 Cordis 上下文、合成会话和临时 JSON 存储。缓存测试还使用 DSH 随附的 DeepSeek 与 pi-ai 适配器，把请求交给本地模拟响应。三项测试都可离线运行。

| 测试 | 涵盖内容 |
| --- | --- |
| [smoke.mjs](test/smoke.mjs) | 角色交接、只读规划、工具执行、复核、取消以及会话重放 |
| [client.mjs](test/client.mjs) | 模型菜单、权限、会话与默认配对、恢复单模型 |
| [cache.mjs](test/cache.mjs) | 每个角色的请求前缀、跨轮复用、切换模型及缓存用量统计 |

DSH Desktop 采用 ASAR 打包。以下 PowerShell 命令使用 DSH 终端提供的 `DSH_NODE_EXECUTABLE` 和 `DSH_INSTALL_DIR`，已在 DSH `0.2.2-rc.5` 的内置 Node.js 24 上验证。

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& $env:DSH_NODE_EXECUTABLE --test test/smoke.mjs test/client.mjs test/cache.mjs | Out-Host
```

在普通 Node.js 安装的 DSH 环境中，将 `DSH_INSTALL_DIR` 设为 `@deepseek-ai/dsh` 包目录的绝对路径，使用运行该 DSH 的 Node.js 执行同一组测试。

```sh
node --test test/smoke.mjs test/client.mjs test/cache.mjs
```

可选的浏览器集成测试会在临时工作区打开动态 SVG，比较两张截图并检查控制台。测试还会读回 PNG，检查旧图卸载后能否继续执行，以及混合配对是否只向视觉角色提供原生图片读取。准备 `dsh-browser` 1.3.1 的源码或解包目录，以及本机安装的 Edge、Chrome 或 Chromium。将 `DSH_TEST_BROWSER_DIR` 设为浏览器插件根目录。如浏览器安装在自定义位置，用 `DSH_BROWSER_EXECUTABLE` 指定可执行文件的绝对路径。[内置浏览器](https://github.com/bbj32/dsh-browser)

```powershell
$env:DSH_TEST_BROWSER_DIR = (Resolve-Path (Read-Host '浏览器插件目录')).Path
& $env:DSH_NODE_EXECUTABLE --test test/paired-workspace-svg.mjs | Out-Host
```

普通 Node.js 环境下使用 `node --test test/paired-workspace-svg.mjs`。这项测试只启动专属的临时浏览器实例。

## English

Install version 1.2.0 in DSH **Plugins → Add plugin**. Paste the HTTPS asset link for `workbuddy-dsh-antigravity-orchestrator-1.2.0.tgz`, or enter the absolute path to this source directory on the DSH host. Enable **DSH model pairing** and follow any restart prompt. The package is `@workbuddy/dsh-antigravity-orchestrator` and declares DSH `>=0.2.2-rc.5 <0.3.0`. [GitHub Releases](https://github.com/bbj32/dsh-model-pairing/releases)

Open the conversation model menu, choose **DSH model pairing**, select a planning model and an execution model, and enable the pairing. The planner inspects read-only tools, answers questions or hands a plan to the executor. The executor uses the session’s native tools and returns evidence for review. Progress review runs after twelve executor tool batches by default. The planner can resume the current plan, handle new user input and revise the plan after blockers or repeated failures. Both roles receive the session context during their own steps and use their providers’ ordinary quotas. **Switch to single model** restores the previous selection. The Host and Web Client load together from the same bundle.

Model pairing runs independently. For web tasks, the optional browser adds observation, interaction and delegated browsing. [Built-in browser](https://github.com/bbj32/dsh-browser)

The offline tests create synthetic sessions and model responses. Run them from the source checkout with the DSH runtime as shown above. The optional SVG test additionally uses the browser package directory and a locally installed Chromium-family browser. [Test commands](#从源码运行测试)
