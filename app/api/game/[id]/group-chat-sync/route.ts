import { randomUUID } from 'node:crypto';

import { manageGroupResponse } from '@/lib/agents/group-chat-manager';
import { appendConversation } from '@/lib/game-engine/memory-manager';
import { getScenarioById, getSession, updateSession } from '@/lib/store/game-sessions';
import type { ChatMessage } from '@/types/game';

interface GroupChatRequestBody {
  message?: string;
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface GroupChatSyncMessage {
  characterId: string;
  text: string;
}

function isDiscussionPhase(phase: string): boolean {
  return phase === 'DISCUSSION_1' || phase === 'DISCUSSION_2' || phase === 'FINAL_DISCUSSION';
}

function createPlayerGroupMessage(content: string): ChatMessage {
  return {
    id: randomUUID(),
    role: 'player',
    content,
    timestamp: Date.now(),
  };
}

export async function POST(req: Request, context: RouteContext): Promise<Response> {
  try {
    const { id } = await context.params;

    let body: GroupChatRequestBody;

    try {
      body = (await req.json()) as GroupChatRequestBody;
    } catch {
      body = {};
    }

    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const scenario = getScenarioById(session.scenarioId);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    if (!isDiscussionPhase(session.currentPhase)) {
      return Response.json(
        { error: `Group chat is disabled during phase ${session.currentPhase}` },
        { status: 403 },
      );
    }

    const message = body.message?.trim() ?? '';
    let workingSession = session;

    if (message) {
      const playerMessage = createPlayerGroupMessage(message);
      const updated = updateSession(id, current => ({
        ...current,
        groupChatHistory: [...current.groupChatHistory, playerMessage],
      }));

      if (!updated) {
        return Response.json({ error: 'Failed to update session' }, { status: 500 });
      }

      workingSession = updated;
    }

    const finalTexts = new Map<string, string>();
    const responseOrder: string[] = [];

    for await (const item of manageGroupResponse(workingSession, message)) {
      const previous = finalTexts.get(item.characterId);

      if (previous === undefined) {
        responseOrder.push(item.characterId);
        finalTexts.set(item.characterId, item.text);
      } else {
        finalTexts.set(item.characterId, previous + item.text);
      }
    }

    const messages: GroupChatSyncMessage[] = responseOrder
      .map(characterId => ({
        characterId,
        text: finalTexts.get(characterId)?.trim() ?? '',
      }))
      .filter(item => item.text.length > 0);

    if (messages.length > 0) {
      updateSession(id, current => {
        const nextHistory = [...current.groupChatHistory];
        const nextMemories = { ...current.characterMemories };

        for (const item of messages) {
          nextHistory.push({
            id: randomUUID(),
            role: 'npc',
            characterId: item.characterId,
            content: item.text,
            timestamp: Date.now(),
          });

          const currentMemory = nextMemories[item.characterId];
          if (!currentMemory) {
            continue;
          }

          let updatedMemory = currentMemory;

          if (message) {
            updatedMemory = appendConversation(updatedMemory, {
              role: 'player',
              content: message,
              characterId: item.characterId,
            });
          }

          updatedMemory = appendConversation(updatedMemory, {
            role: 'npc',
            content: item.text,
            characterId: item.characterId,
          });

          nextMemories[item.characterId] = updatedMemory;
        }

        return {
          ...current,
          groupChatHistory: nextHistory,
          characterMemories: nextMemories,
        };
      });
    }

    return Response.json({ success: true, messages });
  } catch (error) {
    console.error('Group chat sync route failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
