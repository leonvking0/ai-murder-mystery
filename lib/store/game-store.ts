'use client';

import { create } from 'zustand';

import type { ChatMessage, GamePhase } from '@/types/game';

interface GameStore {
  currentSessionId?: string;
  selectedCharacterId?: string;
  messages: Record<string, ChatMessage[]>;
  gamePhase: GamePhase;
  selectCharacter: (characterId: string) => void;
  addMessage: (characterId: string, message: ChatMessage) => void;
  setPhase: (phase: GamePhase) => void;
  setSessionId: (sessionId: string) => void;
  hydrateMessages: (messages: Record<string, ChatMessage[]>) => void;
}

export const useGameStore = create<GameStore>(set => ({
  currentSessionId: undefined,
  selectedCharacterId: undefined,
  messages: {},
  gamePhase: 'LOBBY',
  selectCharacter: (characterId: string) => set({ selectedCharacterId: characterId }),
  addMessage: (characterId: string, message: ChatMessage) =>
    set(state => ({
      messages: {
        ...state.messages,
        [characterId]: [...(state.messages[characterId] ?? []), message],
      },
    })),
  setPhase: (phase: GamePhase) => set({ gamePhase: phase }),
  setSessionId: (sessionId: string) => set({ currentSessionId: sessionId }),
  hydrateMessages: (messages: Record<string, ChatMessage[]>) => set({ messages }),
}));
