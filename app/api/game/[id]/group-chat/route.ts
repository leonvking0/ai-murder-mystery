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

function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };
}

function createSSEData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
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

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const send = (payload: unknown) => {
          controller.enqueue(encoder.encode(createSSEData(payload)));
        };

        let activeCharacterId: string | null = null;
        const finalTexts = new Map<string, string>();
        const responseOrder: string[] = [];

        try {
          for await (const item of manageGroupResponse(workingSession, message)) {
            if (item.characterId !== activeCharacterId) {
              if (activeCharacterId) {
                send({
                  type: 'npc_done',
                  characterId: activeCharacterId,
                  text: finalTexts.get(activeCharacterId) ?? '',
                });
              }

              activeCharacterId = item.characterId;
              responseOrder.push(item.characterId);

              send({
                type: 'npc_start',
                characterId: item.characterId,
                text: '',
              });
            }

            const previous = finalTexts.get(item.characterId) ?? '';
            finalTexts.set(item.characterId, previous + item.text);

            send({
              type: 'npc_chunk',
              characterId: item.characterId,
              text: item.text,
            });
          }

          if (activeCharacterId) {
            send({
              type: 'npc_done',
              characterId: activeCharacterId,
              text: finalTexts.get(activeCharacterId) ?? '',
            });
          }

          if (finalTexts.size > 0) {
            updateSession(id, current => {
              const nextHistory = [...current.groupChatHistory];
              const nextMemories = { ...current.characterMemories };

              for (const characterId of responseOrder) {
                const fullText = finalTexts.get(characterId)?.trim();
                if (!fullText) {
                  continue;
                }

                nextHistory.push({
                  id: randomUUID(),
                  role: 'npc',
                  characterId,
                  content: fullText,
                  timestamp: Date.now(),
                });

                const currentMemory = nextMemories[characterId];
                if (!currentMemory) {
                  continue;
                }

                let updatedMemory = currentMemory;

                if (message) {
                  updatedMemory = appendConversation(updatedMemory, {
                    role: 'player',
                    content: message,
                    characterId,
                  });
                }

                updatedMemory = appendConversation(updatedMemory, {
                  role: 'npc',
                  content: fullText,
                  characterId,
                });

                nextMemories[characterId] = updatedMemory;
              }

              return {
                ...current,
                groupChatHistory: nextHistory,
                characterMemories: nextMemories,
              };
            });
          }
        } catch (error) {
          console.error('Group chat stream failed:', error);
          send({ type: 'error', message: 'NPC group stream failed' });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: sseHeaders(),
    });
  } catch (error) {
    console.error('Group chat route failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
