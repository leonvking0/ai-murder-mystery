# AGENTS.md - AI Murder Mystery Game

> This file is for AI coding agents. Read this before writing any code.

## What We're Building

A web-based murder mystery game (剧本杀) where 1 human player interacts with multiple AI-controlled NPCs. Each NPC has private knowledge and objectives. A GM agent controls game flow.

## Tech Stack (DO NOT deviate)

- **Next.js 14+** with App Router, TypeScript
- **Tailwind CSS + shadcn/ui** for UI
- **Claude API** (Anthropic SDK `@anthropic-ai/sdk`) for all LLM calls
- **Zustand** for client state
- **SQLite via better-sqlite3** (or Drizzle ORM) for persistence
- **SSE (Server-Sent Events)** for streaming responses

## Critical Architecture Rules

### 1. Information Isolation (MOST IMPORTANT)
Each NPC agent call must ONLY include:
- That NPC's own private script
- Public information available to all
- That NPC's personal memory (conversations they participated in, clues they found)
- NEVER include another NPC's private script or private clues

### 2. Agent Design
There are exactly 2 types of agents:

**NPC Agent**: One per character. Receives role-specific system prompt + dynamic memory context. Returns in-character dialogue.

**GM Agent**: Singleton. Controls phase transitions, narrates events, distributes clues, manages NPC-to-NPC conversations. Has access to the full scenario truth.

### 3. Game State Machine
```
LOBBY → READING → INTRO → 
  [DISCUSSION → INVESTIGATION]×2 → 
  FINAL_DISCUSSION → VOTING → REVEAL
```
State transitions are controlled by GM Agent + game engine rules, NOT by NPC agents.

### 4. Conversation Modes
- **Group Chat**: All characters visible, turn-based NPC responses
- **Private Chat**: Player talks to one NPC, others can't see
- Player can switch between modes freely during discussion phases

## File Naming Conventions
- Components: PascalCase (`ChatPanel.tsx`)
- Utilities/libs: camelCase (`gameEngine.ts`)
- API routes: kebab-case folders (`api/game/create/route.ts`)
- Types: PascalCase interfaces in `types/` directory

## API Endpoints

```
POST /api/game/create         - Start new game session
GET  /api/game/[id]/state     - Get current game state  
POST /api/game/[id]/chat      - Send message to NPC (SSE stream)
POST /api/game/[id]/investigate - Choose location to search
POST /api/game/[id]/vote      - Cast vote for killer
POST /api/game/[id]/advance   - GM advances to next phase
```

## NPC System Prompt Template

```
你是{name}，{age}岁，{occupation}。

## 你的性格
{personality}

## 你的说话风格  
{speakingStyle}

## 公开信息（所有人都知道）
{publicInfo}

## 你的秘密（只有你知道，绝对不能直接告诉别人）
{privateScript}

## 你的任务
{objectives}

## 重要规则
- 你只知道上述信息和游戏中获取的新信息
- 保持角色一致性，不要跳出角色
- 你可以撒谎、隐瞒、暗示，但要符合角色性格
- 回复简洁自然，像真人聊天，每次1-3句话
- 用中文回复，符合角色的说话风格
- 如果被问到你不知道的事，就说不知道或岔开话题

## 当前游戏状态
阶段：{currentPhase}
你目前知道的线索：{knownClues}
你的情绪：{emotionalState}
```

## GM System Prompt Template

```
你是这局剧本杀的主持人(GM)。

## 完整真相
{fullTruth}

## 所有角色信息
{allCharacters}

## 当前游戏状态
{gameState}

## 你的职责
1. 推进游戏流程，介绍每个阶段
2. 在适当时机释放公共信息
3. 保持游戏节奏，避免冷场
4. 在讨论阶段引导话题
5. 管理搜证结果分发
6. 最终揭晓真相

## 输出格式
回复JSON: {"narration": "...", "action": "none|advance_phase|release_clue|prompt_npc", "target": "..."}
```

## Scenario JSON Schema (see project-brief.md for full types)

Key fields per scenario:
- `characters[]` - each with publicInfo, privateScript, isKiller, objectives
- `locations[]` - each with clues (public/private, round-gated)
- `case` - victim, truth, timeline
- `phases[]` - game flow configuration

## Development Priority
1. Get single NPC chat working with streaming
2. Add game state machine (phase management)
3. Implement group chat with multiple NPCs
4. Add investigation/clue system
5. Add voting and reveal
6. Polish UI and add complete scenario
