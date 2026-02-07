# AI 剧本杀 (AI Murder Mystery) - Project Brief

## 项目概述

一个实时AI驱动的剧本杀游戏，玩家（1人或多人）与多个AI角色进行互动，体验完整的剧本杀流程。AI角色各自持有独立的剧本信息和记忆，能够根据规则进行推理、隐瞒、暗示和社交互动。

---

## 一、技术栈选型

### 推荐方案：Next.js Full-Stack + Claude API

| 层级 | 技术 | 理由 |
|------|------|------|
| **框架** | Next.js 14+ (App Router) | 全栈一体，LLM代码生成质量最高，SSR+API Routes省去单独后端 |
| **语言** | TypeScript | 类型安全，vibe coding时AI生成的代码更可靠 |
| **UI** | React + Tailwind CSS + shadcn/ui | 组件丰富，AI agent最熟悉的UI库组合 |
| **LLM** | Claude API (claude-sonnet-4-5) | 角色扮演能力强，支持长上下文，成本合理；关键场景可升级Opus |
| **数据库** | SQLite (via Drizzle ORM) 或 PostgreSQL (via Supabase) | MVP阶段用SQLite足够，后期可迁移Supabase |
| **实时通信** | Server-Sent Events (SSE) | 比WebSocket简单，Next.js原生支持，够用于文字流式输出 |
| **状态管理** | Zustand | 轻量，适合管理游戏状态 |
| **会话存储** | Redis (Upstash) 或 内存Map | 存储进行中的游戏session，包括各角色记忆 |
| **部署** | Vercel | 与Next.js无缝集成，零配置部署 |
| **认证** | NextAuth.js (可选，MVP可跳过) | 后期加用户系统时用 |

### 为什么不选其他方案

- **Python后端 (FastAPI)**: 虽然AI/ML生态好，但剧本杀核心是prompt engineering而非ML，全栈JS减少上下文切换
- **WebSocket**: 剧本杀不需要真正的双向实时通信，SSE + 轮询足够，降低复杂度
- **独立前后端**: Vibe coding时单一项目结构让AI agent更容易理解全貌
- **LangChain/LlamaIndex**: 对于这个场景过度抽象，直接调Claude API更灵活可控

### 项目结构建议

```
ai-murder-mystery/
├── app/                          # Next.js App Router
│   ├── page.tsx                  # 首页 - 剧本选择
│   ├── game/[sessionId]/
│   │   ├── page.tsx              # 游戏主界面
│   │   └── layout.tsx
│   ├── api/
│   │   ├── game/
│   │   │   ├── create/route.ts   # 创建游戏session
│   │   │   ├── chat/route.ts     # 与NPC对话 (SSE streaming)
│   │   │   ├── action/route.ts   # 游戏行动（搜证、投票等）
│   │   │   └── state/route.ts    # 获取游戏状态
│   │   └── gm/
│   │       └── route.ts          # GM agent 决策
├── lib/
│   ├── agents/
│   │   ├── npc-agent.ts          # NPC agent 核心逻辑
│   │   ├── gm-agent.ts           # GM/裁判 agent
│   │   └── prompts/              # System prompts 模板
│   │       ├── npc-base.ts
│   │       ├── gm-base.ts
│   │       └── scenario-loader.ts
│   ├── game-engine/
│   │   ├── session.ts            # 游戏session管理
│   │   ├── phase-manager.ts      # 阶段流转控制
│   │   ├── memory-manager.ts     # NPC记忆管理
│   │   ├── clue-manager.ts       # 线索发放管理
│   │   └── rules.ts              # 规则引擎
│   ├── scenarios/                # 剧本数据
│   │   ├── schema.ts             # 剧本数据结构定义
│   │   └── demo-scenario.json    # 示例剧本
│   └── db/
│       ├── schema.ts             # 数据库schema
│       └── index.ts
├── components/
│   ├── game/
│   │   ├── ChatPanel.tsx         # 对话面板
│   │   ├── CharacterCard.tsx     # 角色卡片
│   │   ├── ClueBoard.tsx         # 线索板
│   │   ├── VotePanel.tsx         # 投票面板
│   │   ├── PhaseIndicator.tsx    # 阶段指示器
│   │   └── GameLog.tsx           # 公共事件日志
│   └── ui/                       # shadcn/ui 组件
├── data/
│   └── scenarios/                # 剧本JSON文件
└── types/
    └── game.ts                   # 全局类型定义
```

---

## 二、剧本杀规则详解（供AI Agent参考）

### 2.1 什么是剧本杀

剧本杀（Murder Mystery / LARP-lite）是一种社交推理游戏，每位玩家扮演一个角色，通过阅读剧本、搜集线索、互相交流来还原事件真相（通常是一起谋杀案）。其中一位玩家是凶手，需要隐藏身份；其他玩家需要找出凶手。

### 2.2 标准游戏流程

一局剧本杀通常包含以下阶段（Phase），按顺序进行：

```
Phase 1: 角色分配与剧本阅读
    ↓
Phase 2: 自我介绍轮（每人公开介绍自己的角色背景）
    ↓
Phase 3: 第一轮自由讨论（Round 1）
    ↓
Phase 4: 第一轮搜证（玩家选择地点搜集线索）
    ↓
Phase 5: 第二轮自由讨论（Round 2）
    ↓
Phase 6: 第二轮搜证
    ↓
Phase 7: 第三轮自由讨论（Round 3）- 最终讨论
    ↓
Phase 8: 投票指认凶手
    ↓
Phase 9: 真相揭晓 & 复盘
```

### 2.3 核心机制详解

#### 角色剧本（Character Script）
每个角色拥有：
- **公开信息（Public Info）**: 所有人都知道的角色背景（姓名、职业、与其他角色的关系）
- **私密剧本（Private Script）**: 只有该角色知道的信息，包括：
  - 案发当天的行动时间线
  - 与其他角色的秘密关系
  - 自己的秘密和动机
  - 如果是凶手：作案过程和手法
- **角色任务（Character Objectives）**: 每个角色除了找出凶手外，还有个人任务，如：
  - 隐藏某个秘密不被发现
  - 找出某个特定信息
  - 保护某个角色
  - 凶手：不被投票选中

#### 搜证机制（Investigation）
- 游戏中设有多个**搜证地点**（如：客厅、书房、花园、地下室等）
- 每轮搜证，每位玩家选择一个地点进行搜索
- 每个地点有预设的**线索卡**，通常分为：
  - **公开线索**: 搜到后所有人可见
  - **私密线索**: 仅搜到的玩家可见，玩家可选择是否公开
- 某些关键线索可能需要特定条件才能获取（如：需要钥匙道具）

#### 讨论机制（Discussion）
- 自由讨论环节，所有玩家可以互相提问、质疑、辩论
- 玩家可以选择说真话、半真话、或撒谎
- 凶手需要编造合理的不在场证明或将嫌疑引向他人
- 好人阵营需要通过逻辑推理识别矛盾

#### 投票机制（Voting）
- 最终讨论结束后，所有玩家同时投票指认凶手
- 得票最多的角色被指认为凶手
- 如果指认正确 → 好人阵营胜利
- 如果指认错误 → 凶手胜利

### 2.4 AI适配规则（本项目特有）

由于本项目中NPC由AI扮演，需要以下特殊规则：

#### 信息隔离原则
- 每个AI角色**只能**基于以下信息行动：
  1. 自己的私密剧本
  2. 公开信息
  3. 游戏中通过对话和搜证获取的新信息（动态记忆）
- AI角色**绝对不能**泄露其他角色的私密信息
- 这需要通过独立的 system prompt 和 memory context 实现

#### AI行为准则
- **凶手AI**: 需要主动编造合理故事、转移嫌疑、适度紧张但不过度
- **好人AI**: 需要积极推理、提出质疑、分享线索、但也可能因为自己有秘密而有所隐瞒
- **所有AI**: 需要有个性化的说话风格、情绪反应、和社交行为

#### 难度控制
- AI的推理能力和隐藏能力应可调节
- 新手模式：AI更容易露出破绽，给更多提示
- 专家模式：AI更加老练，隐藏更深

### 2.5 简化版规则（MVP适用）

MVP阶段可以简化为：

```
Phase 1: 玩家选择角色 → 阅读自己的剧本
Phase 2: 所有角色自我介绍（AI自动进行）
Phase 3: 自由讨论（3轮，每轮可与任意角色对话）
Phase 4: 搜证（2轮，每轮选择1个地点）
Phase 5: 最终讨论
Phase 6: 投票
Phase 7: 揭秘
```

交替进行可简化为：讨论 → 搜证 → 讨论 → 搜证 → 最终讨论 → 投票 → 揭秘

---

## 三、Agent 架构设计

### 3.1 Agent 角色定义

#### GM Agent（游戏主持人）
- **职责**: 控制游戏流程、管理阶段转换、发放线索、仲裁争议、生成公共叙事
- **输入**: 游戏状态、玩家行动、当前阶段
- **输出**: 阶段推进指令、叙事文本、线索发放

#### NPC Agent（角色扮演）
- **职责**: 扮演特定角色、参与对话、隐藏/分享信息
- **输入**: 角色剧本 + 角色记忆 + 当前对话上下文
- **输出**: 对话回复、行动决策

### 3.2 NPC Agent Prompt 结构

```
System Prompt:
├── 基础人设（性格、说话风格、口头禅）
├── 公开背景（所有人知道的信息）
├── 私密剧本（只有自己知道的真相）
├── 角色任务（本局游戏的个人目标）
├── 行为规则（信息隔离、不能说什么、应该隐瞒什么）
└── 当前游戏状态注入（动态）

Dynamic Context (每次对话注入):
├── 当前阶段
├── 已获取的线索
├── 对话记忆摘要（与各角色的交互历史）
├── 公共事件日志（所有人知道的事件）
└── GM的特殊指令（如：这一轮你应该更加紧张）
```

### 3.3 记忆管理设计

```typescript
interface CharacterMemory {
  // 静态部分 - 初始化时设定，不变
  privateScript: string;         // 私密剧本
  publicProfile: string;         // 公开信息
  objectives: string[];          // 角色任务

  // 动态部分 - 随游戏推进更新
  conversations: ConversationSummary[];  // 与各角色的对话摘要
  discoveredClues: Clue[];              // 搜证获取的线索
  knownFacts: string[];                 // 通过交互确认的事实
  suspicions: {                          // 对其他角色的怀疑程度
    characterId: string;
    level: number;  // 0-10
    reasons: string[];
  }[];
  emotionalState: string;               // 当前情绪状态
}
```

### 3.4 对话流程

```
玩家发送消息
    ↓
API Route 接收
    ↓
加载目标NPC的完整上下文（剧本 + 记忆 + 游戏状态）
    ↓
组装 System Prompt + 对话历史
    ↓
调用 Claude API (streaming)
    ↓
流式返回回复给前端
    ↓
更新NPC记忆（异步）
    ↓
GM Agent 评估是否需要触发事件（异步）
```

---

## 四、剧本数据结构

```typescript
interface Scenario {
  id: string;
  title: string;
  description: string;           // 剧本简介（给玩家看的）
  playerCount: {min: number, max: number};  // 适合人数
  difficulty: 'easy' | 'medium' | 'hard';
  estimatedDuration: number;     // 预计时长（分钟）
  
  // 世界设定
  setting: {
    era: string;                 // 时代背景
    location: string;            // 地点
    atmosphere: string;          // 氛围描述
    backgroundStory: string;     // 大背景故事（公开）
  };
  
  // 案件信息
  case: {
    victim: string;              // 受害者
    causeOfDeath: string;        // 死因
    timeOfDeath: string;         // 死亡时间
    crimeScene: string;          // 案发现场
    truth: string;               // 完整真相（仅GM可见）
    murderMethod: string;        // 作案手法
    motive: string;              // 作案动机
  };
  
  // 角色定义
  characters: Character[];
  
  // 搜证地点
  locations: InvestigationLocation[];
  
  // 游戏阶段配置
  phases: PhaseConfig[];
  
  // 关键时间线（真实事件顺序）
  timeline: TimelineEvent[];
}

interface Character {
  id: string;
  name: string;
  age: number;
  occupation: string;
  personality: string;           // 性格描述
  speakingStyle: string;         // 说话风格
  
  publicInfo: string;            // 公开信息
  privateScript: string;         // 私密剧本（核心！）
  
  isKiller: boolean;             // 是否是凶手
  
  relationships: {
    characterId: string;
    publicRelation: string;      // 公开关系
    privateRelation: string;     // 真实关系
  }[];
  
  objectives: {
    description: string;
    type: 'primary' | 'secondary';
    isSecret: boolean;
  }[];
  
  alibi: {
    claimed: string;             // 声称的不在场证明
    truth: string;               // 真实行踪
  };
  
  secrets: string[];             // 与案件无关但想隐瞒的秘密
}

interface InvestigationLocation {
  id: string;
  name: string;
  description: string;
  
  clues: {
    id: string;
    content: string;             // 线索内容
    type: 'public' | 'private';  // 公开/私密
    significance: string;        // 线索意义（GM参考）
    availableInRound: number;    // 第几轮搜证可获取
    prerequisite?: string;       // 前置条件（可选）
  }[];
}

interface PhaseConfig {
  type: 'intro' | 'discussion' | 'investigation' | 'vote' | 'reveal';
  round?: number;
  duration?: number;             // 建议时长
  description: string;
  gmScript?: string;             // GM在该阶段的台词/指令
}

interface TimelineEvent {
  time: string;
  event: string;
  involvedCharacters: string[];
  isPublicKnowledge: boolean;
}
```

---

## 五、示例剧本梗概（供开发测试用）

### 《暴风雪山庄》- 经典密室推理

**背景**: 5位宾客受邀来到深山别墅参加聚会，暴风雪封山，第二天早晨主人被发现死在书房。

**角色 (5人，1位凶手)**:
1. **林雨晴** - 死者的妻子，优雅但冷漠 [有秘密情人]
2. **陈志远** - 死者的商业伙伴，精明商人 [有商业纠纷] 
3. **赵小雅** - 死者的女儿，大学生，叛逆 [知道父亲的秘密]
4. **王大明** - 别墅管家，忠诚但神秘 [凶手]
5. **李教授** - 死者的大学同学，学者 [有旧怨]

**搜证地点**: 书房、客厅、厨房、花园、地下室

> 注：完整剧本需要详细编写每个角色的私密剧本、时间线、线索等。
> 建议使用 Claude 来协助生成完整剧本内容。

---

## 六、MVP 开发路线

### Phase 1: 基础框架 (Week 1)
- [ ] Next.js 项目初始化，基础UI搭建
- [ ] 剧本数据结构定义和示例数据
- [ ] 基础对话界面（单个NPC聊天）

### Phase 2: Agent 系统 (Week 2)
- [ ] NPC Agent prompt 模板
- [ ] GM Agent 基础流程控制
- [ ] 记忆管理系统
- [ ] 信息隔离验证

### Phase 3: 游戏流程 (Week 3)
- [ ] 完整游戏阶段流转
- [ ] 搜证系统
- [ ] 投票系统
- [ ] 真相揭晓

### Phase 4: 体验优化 (Week 4)
- [ ] 完整示例剧本
- [ ] UI/UX打磨
- [ ] 难度调节
- [ ] 多语言（中/英）

---

## 七、关键设计决策备忘

### 对话模式选择
**推荐：群聊模式 + 私聊模式共存**
- 群聊：所有角色在同一频道讨论（讨论阶段）
- 私聊：玩家可单独找某个NPC对话（获取更多信息）
- 这更接近真实剧本杀体验

### Token 优化策略
- NPC记忆使用**摘要**而非完整对话历史
- 每轮结束后由GM Agent生成本轮摘要
- 限制每次API调用的上下文长度
- 使用 Sonnet 做日常对话，关键推理场景升级 Opus

### 群聊中AI之间的对话
- 讨论阶段需要AI角色之间互相对话
- 实现方式：轮流调用各NPC agent，每个agent看到之前所有人的发言
- 每个NPC每轮发言1-2次，避免无限对话循环
- 玩家可随时插入发言/提问

### 避免常见问题
- **信息泄露**: 严格测试 system prompt 的信息隔离
- **角色一致性**: 每次对话都要注入完整角色设定
- **节奏控制**: GM Agent 主动推进，避免冷场
- **重复内容**: 记忆摘要避免NPC重复说同样的话
