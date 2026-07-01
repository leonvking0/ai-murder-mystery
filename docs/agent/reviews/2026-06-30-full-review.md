# Full review — 2026-06-30

> Produced by a multi-agent review workflow (run `wf_0d0409a1-7a9`): 8 finder dimensions → adversarial verification → completeness critic → synthesis.
> 93 agents, ~3.3M tokens, 81 findings (73 CONFIRMED / 8 PLAUSIBLE; severities adversarially calibrated). This is the archived source; the live, deduped to-do list is `../KNOWN-ISSUES.md`.

## Synthesis report

# AI 剧本杀（storm-mansion）代码评审报告

> 评审范围：Next.js App Router 单人 AI 剧本杀；5 个 AI NPC + GM/阶段引擎。核心规则为 **Information Isolation**（信息隔离）。部署目标 Vercel。
> 所有结论均已对照实际代码核实（file:line 已校验）。下方按**严重度分组并去重**，最后给出 **P0/P1/P2 改进路线图**。

---

## 一、致命问题（Critical）—— 必须先修，否则游戏在生产环境既不可玩也不成立

### C1. 全套谜底直接泄露给客户端（信息隔离被彻底击穿）
这是**同一个根因（服务端把未脱敏的 scenario / session 原样下发）在 4 个入口同时发生**，任一入口都能让玩家在不推理的情况下拿到凶手与真相。已去重合并：

- **`app/page.tsx:6`** —— `import scenario from '@/data/scenarios/storm-mansion.json'` 在 **client component** 里静态 import 整个剧本。任何访客（游戏都没开始）打开首页 JS bundle 即可读到 `case.truth`、`isKiller`（凶手为 `wang-daming`/王大明）、每个 NPC 的 `privateScript`、`alibi.truth`、`secrets`。
- **`app/api/game/create/route.ts:23-27`** —— 创建会话即在响应里返回整个 `scenario`（含 truth/isKiller/私密剧本）。
- **`app/api/game/[id]/state/route.ts:22-25`** —— 每次加载都返回**完整 scenario + 完整 session**。注意 session 里的 `characterMemories` 同样内嵌 `privateScript`/suspicions，**即使有人只脱敏 scenario，仍会经 `characterMemories` 二次泄露**（独立泄露向量）。
- **`app/api/game/[id]/investigate/route.ts:55`** —— 搜查一次即返回整个 `scenario.locations`，玩家可一次性读完所有地点、两轮的全部公共+私密线索（如打破密室的 `basement` 暗道线索、直接点名王大明的 `kitchen-clue-02`/`living-clue-04`），调查阶段被架空。

**修复（统一方案）**：建立服务端 `ScenarioPublic` 投影，剥离 `case.truth`、`characters[].{isKiller,privateScript,alibi.truth,secrets}`、`relationships[].privateRelation`、`isPublicKnowledge=false` 的 timeline、未发现的 clue、以及 GM-only 的 `clue.significance`；session 仅返回已发现线索与脱敏 memory。所有读接口（create/state/investigate）只发投影；真相只在 `currentPhase==='REVEAL'` 经专用端点下发；`page.tsx` 改为 server component 只传 `id/title/description/setting/difficulty/duration`。`isCorrect` 已在 vote 路由服务端计算，客户端无需知道凶手 id。

### C2. 会话存储为进程内 Map，在 Vercel serverless 上根本无法工作
- **`lib/store/game-sessions.ts:11`** —— `const gameSessions = new Map()` 为模块级内存。Vercel 上每个路由是独立 serverless 实例、可横向扩容并缩容到零。`POST /api/game/create` 写在实例 A 的 Map，紧接着 `GameClient` 挂载时的 `GET /state` 很可能落到实例 B（空 Map）→ `getSession` 返回 `undefined` → `state/route.ts:13-14` 返回 404 `Session not found` → 前端显示「无法读取游戏数据」（GameClient.tsx:133-134, 315-321）。任何冷启动/扩容/重新部署都会**整盘清空所有进行中的对局**（阶段、聊天、NPC 记忆、线索、投票）。
- 同时该 Map **无 TTL/无上限**（line 27），在 `next start`/自托管/长 warm 实例上会无界增长。
- **`better-sqlite3`（package.json:15）已声明但从未 import**，且本地 SQLite 文件在 Vercel 上也救不了（文件系统临时、按实例隔离、`/tmp` 不共享）。

**修复**：用共享持久层（Vercel KV / Upstash Redis / Postgres）替换 Map，`get/create/updateSession` 改为异步原子操作，所有路由 `await`；设置会话 TTL。移除 `better-sqlite3` + `@types/better-sqlite3`，更新 `.env.local.example` 与文档。

---

## 二、高危问题（High）

### H1. `clue.significance`（GM 专用解题分析）直接展示给玩家
- **`components/game/InvestigationPanel.tsx:124`** —— `{clue.type ...} / {clue.significance}`。INVESTIGATION_1 第一次搜查就把「管家是投毒者」之类 GM 推断递给玩家，整局推理塌缩为 no-op，直接违反 #1 规则。注意 Notebook 面板并不显示 significance，二者不一致。
- **修复**：移除该字段渲染，改为只显示线索类型 + 地点名（与 Notebook 一致）；如需提示，在 schema 增加独立的非剧透 hint 字段。

### H2. 所有端点无鉴权、无限流（LLM 成本 DoS）
- **`app/api/game/chat/route.ts:21`** 等全部 LLM 路由对外开放，匿名脚本可循环 POST 跑高 Anthropic/Google 账单并耗尽函数执行；唯一「鉴权」是持有 session UUID，URL 泄露即等于全读写。
- **`chat/route.ts:33`** 消息无长度上限，可发巨型 prompt 放大 token 成本 + 内存压力，并被回放进 `summarizeConversations`。
- **修复**：在所有调用 LLM 的路由前加限流（Upstash/KV 令牌桶，按 IP + sessionId），限制并发；用 create 时下发的签名 httpOnly cookie 绑定会话；消息长度上限（如 1000-2000 字）→ 400；考虑 Edge middleware 全局限流。

> 说明：客户端 bundle 里仍硬编码了 `DEFAULT_KILLER_ID='wang-daming'`（GameClient.tsx:33、RevealPanel.tsx:88 字面量「王大明/wang-daming」、vote/route.ts:14），属于 C1 的纵深泄露，需一并清除——客户端仅依赖服务端 `VoteResponse.isCorrect`，凶手 id 只在 REVEAL 下发。

---

## 三、中危问题（Medium）

### M1. investigate 路由用过期快照整体覆盖 session（丢失并发更新）
- **`app/api/game/[id]/investigate/route.ts:49`** —— 用请求开始时读到的快照构造整个新 session 写回。若期间有其他请求修改 session（私聊流收尾、群聊 append、阶段推进），这些改动会被**静默丢弃**——比 chat 的局部 lost-update 更具破坏性。
- **修复**：改用 `updateSession(id, current => …)` 函数式更新，仅在最新 `current` 上合并 `discoveredClues`、系统消息、公共事实 memory。

---

## 四、低危问题（Low）—— 按类别去重后

**Bug / 状态一致性**
- 聊天记忆基于「请求开始的快照」而非 `current` 写回（`chat/route.ts:104`、chat-sync 同样），群聊与私聊并发到同一 NPC 时互相覆盖，`characterMemories` 与 `chatHistories` 失同步。修复：在函数式更新里以 `current.characterMemories[id]` 为基重算。
- 一轮对话仅在整条流成功后才持久化（`chat/route.ts:141`）；中途断流则该回合在服务端整体丢失，与前端乐观更新分叉。修复：玩家消息先行落库，NPC 文本在 finally 里落已累计部分。
- 摘要重复摘要保留的 6 条 + 无界追加「近期对话摘要」到 `knownFacts`（`chat/route.ts:116`），prompt 膨胀、token 上涨。修复：摘要后丢弃被摘条目、替换而非追加摘要项；群聊路径也应摘要（目前不摘）。
- `appendConversation` 硬编码 `round:0`（`memory-manager.ts:35`），`ConversationSummary.round` 永远为 0。修复：传入 `session.round`。
- `foundAt: locationId`（`clue-manager.ts:81`）导致笔记/REVEAL 显示内部 slug（study/basement）而非中文地点名。修复：存 `location.name`。
- `validate-scenario.ts` 因 schema.ts 使用参数属性 + `.ts` import 在 Node 类型剥离下崩溃，且无 npm script，**无法运行**（`scripts/validate-scenario.ts:4`）。
- Gemini 模型 id `gemini-3-flash-preview`（`llm-provider.ts:9`）与 README 漂移且为 `-preview`（易被下线）；任何 LLM 失败都被吞为同一句兜底（`npc-agent.ts:88`），误配的部署「看起来在跑」实则不可玩。修复：统一稳定模型 id、启动期校验、区分「未配置」与「请求失败」并向客户端发 SSE error。

**前端 UX**
- 群聊 SSE 中途出错时从陈旧闭包 state 读取，已流式的部分文本被丢弃（`GroupChat.tsx:251`）；且群聊**完全无错误反馈**（line 249），失败时「NPC 正在讨论中…」直接消失。修复：用局部变量/ref 累积 activeId/activeText 并在 catch 保存；新增 error banner。
- ChatPanel 把后端/传输错误（session 不存在、阶段禁用、限流）伪装成 NPC 台词（`ChatPanel.tsx:207`），玩家无法分辨真实故障，掩盖了 C2。修复：区分出独立可见错误态。
- 阶段过场 modal 每次刷新/重访都重新弹出（`GameClient.tsx:156`），LOBBY 首屏也误弹；角色选择每次刷新重置到第一个 NPC（line 159）。修复：仅在真实阶段切换时弹；仅在未选择时默认选。
- SSE error 事件未取消 reader（`ChatPanel.tsx:172`，连接泄露）；流式气泡每次 render 重建对象+UUID（line 245）；输入框/流式输出缺少 aria-label / aria-live / role=alert（无障碍）。

**死代码 / 设计漂移**（与 brief 描述不符，强烈误导维护者）
- **整个 LLM GM agent 是死代码**：`streamGMResponse`/`buildGMSystemPrompt`/`fallbackGMResponse`/`GM_SYSTEM_PROMPT_TEMPLATE`/`shouldAdvancePhase` 无任何调用方（`gm-agent.ts:62,74,174`）。所谓「GM/阶段引擎驱动」运行时**没有 AI GM**、无自动推进、无防卡顿。且 `buildGMSystemPrompt` 内嵌 `case.truth`，是「上膛但未扣扳机」的泄露隐患。建议删除或真正接线（接线时只转发 narration，绝不转发原始流）。
- 阶段引擎硬编码 `PHASE_CONFIGS`/`PHASE_SEQUENCE`（`phase-manager.ts:49,11`），完全无视 scenario 的 `phases/duration/round`；`canAdvance` 的 round 闸是死代码且 round→phase 映射在 `phase-manager` 与 `advance/route.ts:14` 重复（易分叉）；`PHASE_SEQUENCE` 含**永不可达的 LOBBY**，导致进度条从 2/10 起跳。
- 悬疑/记忆子系统全死：`updateSuspicion`、`addDiscoveredClue`（`memory-manager.ts:92,132`）从不调用，suspicion 恒为初始值且**从不进入 NPC prompt**；per-NPC `discoveredClues` 永远为空，NPC 永远收不到玩家挖到的私密线索 → 被对质时只会否认/岔开（`npc-base.ts:120`），调查与对话脱节、审讯无后果。
- 两套 scenario 系统并存：运行时走未校验的静态 import（`game-sessions.ts:8`），而 `loader.ts`/`schema.ts`（含路径穿越防护与校验，约 280 行）**运行时完全死**，且 `validateScenario` 太弱（不查唯一凶手、clue id 唯一性、引用完整性）。
- `playerCharacterId` 半成品：类型/请求/「你扮演 X」UI 分支（GameClient.tsx:357-369）齐全，但 `createSession` 从不接收、create 路由丢弃（`create/route.ts:21`），分支永远走不到——玩家始终是「外部侦探」，与剧本杀惯例相悖。
- 群聊一回合内多 NPC 共享冻结快照、看不到彼此刚生成的回复（`group-chat-manager.ts:77`），LLM 未配置时多 NPC 还会吐同一句兜底。
- NPC 从不投票/指认（`vote/route.ts:61` 只写 `votes['player']`），VOTING 沦为单人选择题；无最小参与度闸门，玩家可从 READING 一路点到 VOTING 零线索猜凶（`phase-manager.ts:137`）；无调查预算、第二轮线索是第一轮超集（`clue-manager.ts:73`），搜查无取舍。

**内容一致性 / 文档**
- 投毒方式自相矛盾：最具杀伤力线索 `kitchen-clue-02` 写药用 digoxin，而 canonical 方法是手工提取毛地黄（`storm-mansion.json:414`）。
- 时钟偏差 12 分钟线索无归属、无可对应的人物时间（`storm-mansion.json:386`），玩家无法将其解进解答。
- 凶手固定 + 线索过度指向，难度标 medium 实则第一轮即破，「New Game」重放同一已知解，复玩价值近零（`storm-mansion.json:414`）。
- `AGENTS.md:13` 技术栈描述过期（提 @anthropic-ai/sdk + SQLite），会误导 AI agent 写出冲突代码；无 `typecheck` script（package.json）；`next.config.ts` 空（无安全头）；`maxOutputTokens:5000` 对 1-3 句回复过大（`npc-agent.ts:73`，延迟/成本尾部风险）。

**重复代码（drift 风险）**
- SSE 客户端助手（isIOSDevice/parseSSEEvent/…）在 ChatPanel 与 GroupChat 各抄一份（约 70 行，iOS 修复要改两处）；chat 与 chat-sync 业务逻辑整段重复（4 路由）；服务端 `sseHeaders/createSSEData` 两份；`isDiscussionPhase` 4 处实现、签名不一；硬编码凶手 3 文件；`InvestigationResult` 在 clue-manager.ts 与 types/game.ts 各声明一次。建议各抽公共模块。
- LLM 流式路由未设 `maxDuration`（`group-chat/route.ts`），一回合最多串行驱动 5 个 NPC 可能超时被杀、留下半更新 session。修复：`export const maxDuration = 60;`（Node runtime）。

---

## 五、改进路线图（按优先级）

### P0 —— 上线前阻断项（安全 + 可玩性，必须全做）
1. **修复信息隔离（C1）**：建立 `ScenarioPublic` 服务端投影 + REVEAL 专用端点；脱敏 create/state/investigate 与 `page.tsx`；移除客户端硬编码凶手；移除 `InvestigationPanel` 的 `significance`（H1）。这是 #1 规则，必须一次性彻底做完（含 `characterMemories` 脱敏）。
2. **持久化会话（C2）**：用 Vercel KV/Upstash 替换内存 Map，store API 改异步原子 + TTL；移除 `better-sqlite3`；给流式路由加 `maxDuration`。
3. **限流 + 会话绑定 + 消息长度上限（H2）**：所有 LLM 路由前置限流、cookie 绑定 session、长度 400。

### P1 —— 正确性与体验（紧随 P0）
4. 修复并发 lost-update：investigate（M1）与 chat/chat-sync 一律改函数式更新（基于 `current`）；玩家消息先落库、断流 finally 保存部分。
5. 错误可见性：ChatPanel/GroupChat 区分真实故障与 NPC 台词、加 error banner、修复群聊部分文本丢失与 reader 泄露。
6. 修复过场 modal 重弹、角色选择重置、`foundAt` 显示 slug、`round:0`、Gemini 模型 id 漂移 + 失败可观测。
7. 让校验真正运行：修好 `validate-scenario.ts` + 加 `validate`/`typecheck` script，启动期 `validateScenario(stormMansion)`，并补强校验（唯一凶手 / clue id 唯一 / 引用可解析）。修内容矛盾（投毒方式、时钟偏差线索）。

### P2 —— 深度、复玩与可维护性（产品化）
8. 清理死代码或真正接线（择一并文档化）：GM agent、suspicion/discoveredClues、scenario loader 双系统、LOBBY、`playerCharacterId`、重复 SSE/路由/常量。
9. 让审讯有后果：把玩家出示的私密线索注入对应 NPC 记忆（保持隔离）、suspicion 进入 prompt 并随事件变化；给每个 NPC 自己的 alibi/secrets/相关 timeline 以抑制幻觉。
10. 复玩与社交推理：NPC 投票 + 票数结算；最小参与度闸门 + 调查预算；难度真正影响线索产出/NPC 坦白度。
11. 内容规模化：接通多剧本 loader + 选剧本首页；数据驱动阶段流（读 `scenario.phases`）；为玩家暴露 timeline 推理板。
12. AI 质量与成本：Anthropic prompt caching（拆静态 persona 前缀）、NPC `maxOutputTokens` 降到 ~400、群聊改真正多轮 ModelMessage 并在回合内增量拼接上下文。

---

## 附：去重说明
原始清单中关于「内存 Map 不适配 Vercel」「全套谜底进 client bundle / state 返回完整 scenario / create 返回完整 scenario」「better-sqlite3 未用」「Gemini 模型漂移」「loader/schema 死代码」「playerCharacterId 死代码」「duplicated round 映射 / isDiscussionPhase / SSE 助手」「GM agent 死代码」「suspicion/discoveredClues 死代码」等均存在多条重复条目，已分别合并为 C2、C1、H2、Low 各对应单条，并标注全部已核实命中的 file:line。

---

## All verified findings (81)

Sorted by severity. `V` = adversarial verdict.

| Sev | V | Cat | Title | File:line |
|---|---|---|---|---|
| critical | ✓ | deploy | Sessions live only in a module-level in-memory Map — not durable or shared across Vercel serverless instances (immediate 404s + total loss on restart/redeploy) | `lib/store/game-sessions.ts:11` |
| critical | ✓ | security | Full solution (case.truth, killer, every private script) is bundled into the public client JS via app/page.tsx import | `app/page.tsx:6` |
| critical | ✓ | security | GET /api/game/[id]/state returns the entire scenario (truth, isKiller, all private scripts/clues) to the browser | `app/api/game/[id]/state/route.ts:22` |
| critical | ✓ | security | POST /api/game/create returns the entire scenario (truth, killer, all secrets) in its response | `app/api/game/create/route.ts:23` |
| critical | ✓ | security | Entire solution (killer, truth, every private script) is shipped to the client, defeating the deduction game | `app/api/game/[id]/state/route.ts:22` |
| critical | ✓ | deploy | In-memory Map session store cannot work on the Vercel serverless deploy target | `lib/store/game-sessions.ts:11` |
| high | ✓ | deploy | In-memory session store loses all game state on Vercel serverless (whole flow dead-ends) | `lib/store/game-sessions.ts:11` |
| high | ✓ | security | POST /api/game/[id]/investigate returns the full scenario, leaking all locations' undiscovered public AND private clues | `app/api/game/[id]/investigate/route.ts:55` |
| high | ✓ | security | No rate limiting or auth on any endpoint, including the LLM-backed chat/group-chat streams | `app/api/game/chat/route.ts:21` |
| high | ✓ | security | Landing page bundles the entire solution scenario JSON into the client bundle | `app/page.tsx:6` |
| high | ✓ | security | State route ships the full unredacted scenario (solution) to the client on every load | `app/api/game/[id]/state/route.ts:22` |
| high | ✓ | security | Entire scenario solution (truth, killer, private scripts) is statically imported into the client JS bundle | `app/page.tsx:6` |
| high | ~ | security | Session payload leaks every NPC's privateScript/objectives via characterMemories — a second solution-leak vector independent of the scenario object | `app/api/game/[id]/state/route.ts:22` |
| medium | ✓ | content | Investigation panel displays clue.significance (GM-only solution analysis) directly to the player | `components/game/InvestigationPanel.tsx:124` |
| medium | ~ | bug | Investigate route overwrites the entire session from a stale snapshot, dropping concurrent chat/group-chat/vote/phase updates | `app/api/game/[id]/investigate/route.ts:49` |
| low | ✓ | bug | Chat routes persist character memory from a stale pre-stream snapshot (lost update) | `app/api/game/chat/route.ts:104` |
| low | ✓ | perf | Conversation summarization re-summarizes retained turns and grows knownFacts unboundedly | `app/api/game/chat/route.ts:116` |
| low | ✓ | ux | Notebook and reveal data show raw location IDs instead of names because foundAt stores the id | `lib/game-engine/clue-manager.ts:81` |
| low | ✓ | maintainability | Round gate in canAdvance is dead code; round mapping is duplicated across two files | `lib/game-engine/phase-manager.ts:143` |
| low | ✓ | design | Phase engine ignores scenario-defined phases/rounds/durations (hardcoded PHASE_CONFIGS) | `lib/game-engine/phase-manager.ts:49` |
| low | ✓ | ux | PHASE_SEQUENCE includes an unreachable LOBBY phase, skewing the phase progress indicator | `lib/game-engine/phase-manager.ts:11` |
| low | ✓ | maintainability | GM auto-advance / GM streaming logic is dead code; phase advancement is purely manual | `lib/agents/gm-agent.ts:174` |
| low | ✓ | bug | Chat / chat-sync persist NPC memory built from a request-start snapshot instead of from `current` inside the updater (lost-update on characterMemories) | `app/api/game/chat/route.ts:104` |
| low | ✓ | perf | gameSessions Map has no TTL/eviction/size cap — unbounded memory growth on a long-lived server | `lib/store/game-sessions.ts:27` |
| low | ✓ | maintainability | better-sqlite3 persistence dependency present but unused; documented SQLite-for-persistence plan is unworkable on the Vercel target | `package.json:15` |
| low | ✓ | bug | playerCharacterId is never initialized in the session, so player-identity state is always absent | `lib/store/game-sessions.ts:34` |
| low | ✓ | security | Chat/group-chat messages have no length limit, enabling oversized prompts and token-cost abuse | `app/api/game/chat/route.ts:33` |
| low | ✓ | security | Killer id is hard-coded in the client bundle as a fallback (defense-in-depth leak) | `components/game/GameClient.tsx:33` |
| low | ✓ | maintainability | Scenario-loader path-traversal guard and schema validation are dead code; never run at runtime | `lib/scenarios/loader.ts:16` |
| low | ✓ | design | Entire LLM GM agent is dead code — streamGMResponse/buildGMSystemPrompt never wired to any route | `lib/agents/gm-agent.ts:74` |
| low | ~ | bug | Google model ID 'gemini-3-flash-preview' diverges from README and silently degrades on any error | `lib/agents/llm-provider.ts:9` |
| low | ✓ | design | Per-NPC discoveredClues is permanently empty; addDiscoveredClue never called, so NPCs only ever learn public clues | `lib/game-engine/memory-manager.ts:132` |
| low | ✓ | maintainability | Suspicion model is dead: updateSuspicion never called and suspicions never included in NPC prompt | `lib/game-engine/memory-manager.ts:92` |
| low | ✓ | design | Group-chat responders in one turn share a stale context snapshot and can't see each other's just-generated replies | `lib/agents/group-chat-manager.ts:77` |
| low | ✓ | security | GM system-prompt template embeds full case.truth and all character data — latent solution-leak if ever wired | `lib/agents/gm-agent.ts:62` |
| low | ✓ | bug | GroupChat partial-on-error recovery reads stale closure state and never saves partial NPC text | `components/game/GroupChat.tsx:251` |
| low | ✓ | ux | GroupChat shows no user-visible error feedback; failures are silently swallowed | `components/game/GroupChat.tsx:249` |
| low | ✓ | ux | Phase-transition modal re-opens on every page load/refresh | `components/game/GameClient.tsx:156` |
| low | ✓ | ux | Chat/group inputs and streamed output lack accessible labels and live regions | `components/game/ChatPanel.tsx:265` |
| low | ✓ | design | Two parallel scenario systems: the runtime path uses an unvalidated static import; the validated async loader is entirely dead | `lib/store/game-sessions.ts:8` |
| low | ✓ | maintainability | Dead GM-agent subsystem: streamGMResponse / buildGMSystemPrompt / GM_SYSTEM_PROMPT_TEMPLATE / fallbackGMResponse have no callers and no route | `lib/agents/gm-agent.ts:74` |
| low | ✓ | maintainability | Stream and sync API routes duplicate the entire NPC-turn business logic | `app/api/game/chat-sync/route.ts:81` |
| low | ✓ | maintainability | SSE/iOS client helpers duplicated verbatim across ChatPanel and GroupChat | `components/game/ChatPanel.tsx:20` |
| low | ✓ | maintainability | Hardcoded DEFAULT_KILLER_ID 'wang-daming' (and literal '王大明') copied into 3 files | `app/api/game/[id]/vote/route.ts:14` |
| low | ✓ | deploy | Unused native dependency better-sqlite3 (+ @types/better-sqlite3) | `package.json:15` |
| low | ✓ | maintainability | Dead memory functions updateSuspicion / addDiscoveredClue; suspicion & emotionalState never updated | `lib/game-engine/memory-manager.ts:92` |
| low | ✓ | maintainability | Dead export shouldAdvancePhase — automatic phase pacing never wired | `lib/agents/gm-agent.ts:174` |
| low | ✓ | maintainability | Duplicated phase→round mapping: getRoundForPhase vs expectedRoundForPhase | `app/api/game/[id]/advance/route.ts:14` |
| low | ✓ | maintainability | isDiscussionPhase reimplemented in 4 places with differing signatures | `lib/agents/group-chat-manager.ts:40` |
| low | ✓ | maintainability | Server SSE helpers sseHeaders/createSSEData duplicated across two routes | `app/api/game/chat/route.ts:9` |
| low | ✓ | maintainability | scripts/validate-scenario.ts is the only consumer of schema.ts but is not runnable via configured tooling | `scripts/validate-scenario.ts:4` |
| low | ✓ | maintainability | Unfinished feature: GameSession.playerCharacterId / CreateGameRequest.playerCharacterId typed but never set | `app/api/game/create/route.ts:14` |
| low | ~ | design | Killer is fixed and clues over-determine him, so the 'medium' difficulty is actually trivial and replayability is near zero | `data/scenarios/storm-mansion.json:414` |
| low | ✓ | design | NPCs never vote or accuse — only the player's single vote decides the outcome | `app/api/game/[id]/vote/route.ts:61` |
| low | ✓ | design | NPCs never receive the player's private clues and suspicion/clue tracking is dead code, so interrogation has no consequence | `lib/game-engine/clue-manager.ts:85` |
| low | ✓ | design | Pacing is purely manual with no engagement gate — players can skip every discussion and investigation and reach the vote with zero clues | `lib/game-engine/phase-manager.ts:137` |
| low | ✓ | design | playerCharacterId is a dead feature — the player is never assigned a character, contradicting 剧本杀 convention and leaving dead UI | `app/api/game/create/route.ts:21` |
| low | ✓ | design | No investigation budget and round-2 clues are a superset of round-1, so search has no tension and INVESTIGATION_1 is skippable | `lib/game-engine/clue-manager.ts:73` |
| low | ✓ | content | Poison source is internally inconsistent: most-damning clue cites pharmaceutical digoxin, but the canonical method is hand-extracted foxglove | `data/scenarios/storm-mansion.json:414` |
| low | ✓ | content | Clock-skew clue has no owner and is not reconciled with any character's stated times | `data/scenarios/storm-mansion.json:386` |
| low | ✓ | bug | validate-scenario.ts crashes and has no way to be run | `scripts/validate-scenario.ts:4` |
| low | ✓ | maintainability | Scenario loader + schema validator are dead code; scenarios are never validated at runtime | `lib/scenarios/loader.ts:16` |
| low | ✓ | deploy | Gemini model id drift (and unstable -preview model) between code and README | `lib/agents/llm-provider.ts:9` |
| low | ✓ | deploy | better-sqlite3 (native module) and its types are dependencies but never used | `package.json:15` |
| low | ✓ | deploy | No maxDuration set on LLM streaming routes; group chat makes many sequential model calls | `app/api/game/[id]/group-chat/route.ts:142` |
| low | ✓ | content | AGENTS.md tech-stack section is stale and contradicts the actual implementation | `AGENTS.md:13` |
| low | ~ | deploy | All LLM failures are swallowed into a fixed canned NPC line, so a misconfigured deploy silently looks 'working' but is unplayable | `lib/agents/npc-agent.ts:88` |
| low | ~ | ux | ChatPanel masks server/transport errors (session-not-found, phase-disabled) as an in-character NPC reply | `components/game/ChatPanel.tsx:207` |
| low | ~ | bug | A chat turn is persisted only on full-stream success, so a mid-stream disconnect loses the whole turn server-side and desyncs NPC memory | `app/api/game/chat/route.ts:141` |
| low | ~ | maintainability | validateScenario is too weak to catch the integrity constraints the engine actually depends on (single killer, unique clue ids, valid references) | `lib/scenarios/schema.ts:60` |
| nit | ✓ | bug | appendConversation hardcodes round:0, discarding the game round on every memory entry | `lib/game-engine/memory-manager.ts:35` |
| nit | ✓ | perf | maxOutputTokens 5000 for 1-3 sentence replies allows runaway-length tail responses | `lib/agents/npc-agent.ts:73` |
| nit | ✓ | bug | SSE error event leaves the stream reader uncancelled (resource leak on error path) | `components/game/ChatPanel.tsx:172` |
| nit | ✓ | perf | Live streaming bubble rebuilds a message object (new UUID + timestamp) on every render | `components/game/ChatPanel.tsx:245` |
| nit | ✓ | ux | Character selection resets to the first character on every load | `components/game/GameClient.tsx:159` |
| nit | ✓ | maintainability | InvestigationResult interface declared twice (clue-manager.ts and types/game.ts) | `lib/game-engine/clue-manager.ts:5` |
| nit | ✓ | maintainability | Dead exports summarizeScenario and clearScenarioCache | `lib/scenarios/schema.ts:243` |
| nit | ✓ | maintainability | LOBBY phase is configured everywhere but unreachable at runtime | `lib/store/game-sessions.ts:37` |
| nit | ✓ | maintainability | Runtime uses an unvalidated static JSON import; the file loader/validator is never executed at runtime, so content inconsistencies go uncaught | `lib/store/game-sessions.ts:3` |
| nit | ✓ | maintainability | No typecheck script despite README claiming tsc --noEmit is part of validation | `package.json:5` |
| nit | ✓ | security | next.config.ts is empty — no security headers configured | `next.config.ts:3` |

---

## Improvement ideas (by angle)

### depth-replayability

- **[M/high] Multi-scenario library + selection screen** — Replace the single hardcoded scenario with a real registry that enumerates data/scenarios/*.json, and turn the landing page into a scenario picker (cover, difficulty, duration, player-count) instead of one fixed card.
- **[M/high] Finish player-as-character role assignment (playerCharacterId)** — Plumb playerCharacterId end to end: a character-select step before the game, persist it through create, and make NPC prompts treat the player as that character (exclude self from chat targets, address the player in-role).
- **[L/high] NPC voting and emergent social deduction** — At FINAL_DISCUSSION/VOTING, have each NPC cast its own accusation (driven by an LLM judgment or the suspicion model), populate the votes map, and show a per-NPC tally + group consensus in the reveal.
- **[XL/high] Randomized killer / authored scenario variants** — Select the guilty party (and the matching truth/clue/alibi set) per session from authored 'guilt configurations' rather than a fixed flag, so the same cast can yield different solutions across replays.
- **[M/medium] Difficulty modes that actually change gameplay** — Make the difficulty field alter real play: clue yield per search, NPC candor/evasiveness, hint availability, whether private clues surface, and number of investigation rounds.
- **[M/medium] Data-driven phase flow from scenario.phases** — Drive the phase engine from each scenario's phases array and round count instead of one global hardcoded sequence, enabling variable pacing and simple branching.
- **[S/medium] Surface the authored timeline (player board + NPC reasoning)** — Render a timeline board for the player and feed the public timeline (plus each NPC's own relevant entries) into prompts so NPCs reason about times and the player can cross-check alibis.
- **[M/medium] Gated/branching clue trees via Clue.prerequisite** — Honor Clue.prerequisite so some clues unlock only after prerequisite clues are found (or after specific NPC admissions), turning investigation into a dependency puzzle with divergent discovery paths.
- **[S/low] Inject character.secrets into prompts as layered, pryable info** — Feed each character's secrets array into its own system prompt as separately-guardable facts (some discoverable under pressure), instead of relying on one monolithic privateScript blob.
- **[M/medium] Post-game deduction scoring + recap to drive replay** — Score each run (correct accusation, clues found vs total, deductions made, NPCs convinced) and show a recap with a 'what you missed' list plus the existing New Game CTA.

### ai-quality

- **[L/high] Activate the dead dynamic-GM agent to drive pacing, clue release, and NPC nudges** — Wire the already-written streamGMResponse/GMResponse loop (and shouldAdvancePhase) into a real GM tick that runs on each group-chat turn: parse its JSON action (advance_phase | release_clue | prompt_npc | none) and act on it, replacing the static PHASE_NARRATIONS strings.
- **[L/high] Make suspicion and emotion actually change and feed them into NPC prompts** — After each turn, run a cheap per-NPC appraisal (heuristic or a Haiku call) that adjusts SuspicionRecord levels and emotionalState based on the player's message and newly public clues, and inject both (e.g. '你目前对王大明的怀疑度: 7/10; 你的情绪: 慌张') into the system prompt so behavior visibly shifts.
- **[S/high] Let NPCs react to each other within the same group-chat round** — Rebuild the group transcript incrementally inside the responder loop so each speaking NPC sees the lines the previous NPCs just said this turn (agreement, rebuttal, piling-on), instead of all responders answering a frozen snapshot.
- **[M/high] Eliminate hallucinated alibis by feeding each NPC its own legitimately-known facts** — Inject into the NPC system prompt the character's own alibi (claimed + truth), secrets[], and the timeline events whose involvedCharacters include them (plus isPublicKnowledge events), and strengthen the 'don't invent specifics' guardrail — all without leaking other NPCs' scripts or case.truth.
- **[M/high] Add Anthropic prompt caching on the static persona prefix** — Split the NPC system prompt into a stable, cacheable prefix (name, personality, speakingStyle, publicInfo, privateScript, relationships, known characters) and a volatile suffix (phase, clues, emotion, recent memory), then mark the prefix with providerOptions.anthropic.cacheControl {type:'ephemeral'} so repeated turns with the same NPC hit cache.
- **[S/medium] Upgrade to current Claude models and tier them by task** — Move NPC/GM inference from claude-sonnet-4-5 to claude-sonnet-4-6 (better instruction-following and in-character adherence, keeps temperature, adaptive thinking, 1M context), and route cheap auxiliary calls — memory summarization, quiet-NPC filler, GM stall-routing — to claude-haiku-4-5. Optionally use claude-opus-4-8 only for the GM 'director' reasoning.
- **[M/medium] Replace raw-line memory with real rolling summaries, and summarize group chat too** — Store structured conversation memory (who claimed what, contradictions spotted, commitments made) and run summarizeConversations in the group-chat path as well, maintaining a per-NPC 'case notebook' that persists key facts rather than a raw transcript tail.
- **[M/medium] Pass group-chat history as real conversation turns instead of one stuffed user message** — Map the group transcript to alternating ModelMessages (player → user, this NPC's own prior lines → assistant, other NPCs → labeled user context) in streamNPCGroupResponse, rather than concatenating the whole transcript into a single user string.
- **[M/medium] Make responder selection relevance/stake-driven once emotion exists** — Extend decideRespondingNPCs to weight responders by who is implicated or threatened by the player's message or the latest clue (high suspicion toward them, named in a clue, alibi challenged), not just keyword mentions and least-recent-speaker.

### ux-onboarding

- **[M/high] Give the player an explicit role + persistent goal banner + first-run how-to-play** — Replace the always-generic identity box with a clear 'You are the detective' framing, a persistent objective banner ('Talk to 5 guests, gather clues, vote for the killer'), and a one-time How-to-Play overlay explaining the 10-phase flow and controls.
- **[M/high] Add an interactive timeline view that unlocks as clues are found** — Render the scenario timeline as a vertical 'night of the murder' view: public events visible from the start, private events shown as locked rows that reveal when the player discovers the matching clue.
- **[L/high] Upgrade the clue notebook into a deduction board** — Group discovered clues by location/round, restore the dropped 'significance' text, show a 'X of Y clues found' progress counter, and let the player tag each suspect with a suspicion level and free-text notes.
- **[M/medium] Add a progressive, GM-driven hint system** — Add a 'Ask the GM for a hint' control that gives escalating nudges (which suspect to press, which location to search, which clue contradicts whose alibi) without revealing the killer.
- **[M/high] Add per-phase objectives, progress feedback, and optional auto-advance pacing** — Show a small checklist/progress for each phase (e.g. 'Spoke with 2/5 guests', 'Searched 3/5 locations'), surface the per-phase suggested duration, and optionally auto-advance or prompt when a phase's goals are met.
- **[M/high] Mobile-first tabbed layout instead of a long vertical stack** — On small screens, collapse the 3-column desktop grid into a bottom tab/segmented switch (Characters | Chat | Notebook/Timeline) so the active panel fills the viewport instead of stacking into one long scroll.
- **[M/medium] Accessibility pass: announce streaming replies, fix contrast, add landmarks/reduced-motion** — Wrap streaming chat output and 'thinking' indicators in aria-live/role=status regions, raise low-opacity text to meet contrast, add semantic landmarks/headings, and respect prefers-reduced-motion for the reveal/transition animations.
- **[L/high] Persist sessions and add a 'Continue game' / resume flow** — Move the session store off the in-memory Map onto a durable store (e.g. Vercel KV/Redis), remember recent session IDs client-side, and add a 'Continue' entry on the homepage plus a friendly recovery screen when a session is gone.

### product-scope

- **[M/high] Replace the in-memory Map with a serverless-durable session store behind the existing store API** — Swap the module-level `const gameSessions = new Map()` in lib/store/game-sessions.ts:11 for a real persistence backend (Vercel KV / Upstash Redis, or Postgres) implemented behind the existing getSession/createSession/updateSession seam so no call sites change. Serialize GameSession as JSON per key.
- **[M/high] Split the scenario into public-play vs GM-private data models and serve only a sanitized projection** — Introduce a ScenarioPublic projection (strip case.truth, every privateScript, alibi.truth, secrets, isKiller, GM-only clue.significance, and non-public timeline) built server-side. Send only that from /create and /state; keep full data server-side for prompt building; deliver the solution via a REVEAL-gated endpoint.
- **[M/high] Add abuse/cost protection and deployment hardening to the LLM endpoints** — Add per-session/IP rate limiting and a max-turns budget on /chat, /chat-sync, /group-chat(-sync) and /investigate; add security headers + image config in next.config.ts; validate required env at boot; and pin route runtime (`export const runtime`). Lower maxOutputTokens from 5000 to ~400 for 1-3 sentence replies.
- **[M/high] Wire the validated multi-scenario loader and build a real scenario catalog/landing** — Route runtime scenario access through the existing async, cached, validated loadScenarioById/loadAllScenarios (lib/scenarios/loader.ts) instead of the static single-file import, and replace the hardcoded one-scenario landing with a catalog that lists every data/scenarios/*.json. Delete the now-redundant static import path.
- **[M/high] Establish a testing strategy with an information-isolation regression test and CI** — Add a `typecheck` script and a test runner (Vitest), unit-test the pure logic (canAdvance/getNextPhase in phase-manager, investigateLocation round-gating in clue-manager, validateScenario in schema), and add a guard test asserting buildNPCSystemPrompt never contains another character's privateScript/alibi.truth/secrets. Run all in GitHub Actions plus the scenario validator.
- **[M/medium] Add product analytics and LLM/cost telemetry** — Instrument a funnel (session created, phase reached, drop-off per phase, vote submitted, vote correctness, scenario chosen) via PostHog or Vercel Analytics, and add LLM observability (tokens, latency, error rate per provider/model) plus structured logging to replace bare console.error.
- **[L/medium] Add accounts/auth with game ownership and a resume/history experience** — Add NextAuth (Auth.js) with at least one provider, attach an ownerId to sessions, enforce ownership in the [id] routes, and surface a 'my games' list with resume and past-result history once persistence lands.
- **[L/medium] Introduce a zh/en i18n layer for both UI and NPC output** — Adopt next-intl, extract all hardcoded Chinese UI strings (incl. PHASE_LABELS/PHASE_NARRATIONS in phase-manager.ts:23-47, page.tsx, GameClient.tsx error toasts) into message catalogs, add a locale switcher, and parametrize the NPC/GM prompts' output language instead of the hardcoded '用中文回复'.
- **[XL/medium] Build scenario authoring tooling and a community marketplace** — Create an authoring UI (or structured editor) that produces schema-valid scenario JSON, validates with the existing schema.ts, previews the public projection vs GM-private data, and supports save/publish/browse — evolving into a shared library of player- and creator-made cases.
- **[XL/medium] Plan a real-time multiplayer mode on top of durable state + pub/sub** — Add multi-human sessions where humans claim character seats (using the dead playerCharacterId field) and AI fills the rest: requires a shared persistent store, a real-time fan-out channel (Redis pub/sub / Ably / Pusher) since the current SSE is per-request with no broadcast, synchronized phase advancement, and per-player isolated views.

