'use client';

import { create } from 'zustand';

import type { ChatMessage, GamePhase } from '@/types/game';

export type ChatMode = 'private' | 'group';

interface GameStore {
  currentSessionId?: string;
  selectedCharacterId?: string;
  messages: Record<string, ChatMessage[]>;
  groupMessages: ChatMessage[];
  gamePhase: GamePhase;
  chatMode: ChatMode;
  hasVoted: boolean;
  votedAccusedId?: string;
  voteIsCorrect?: boolean;
  selectCharacter: (characterId: string) => void;
  addMessage: (characterId: string, message: ChatMessage) => void;
  addGroupMessage: (message: ChatMessage) => void;
  setPhase: (phase: GamePhase) => void;
  setChatMode: (mode: ChatMode) => void;
  setSessionId: (sessionId: string) => void;
  hydrateMessages: (messages: Record<string, ChatMessage[]>) => void;
  hydrateGroupMessages: (messages: ChatMessage[]) => void;
  setVoteResult: (accusedId: string, isCorrect: boolean) => void;
  resetVoteResult: () => void;
}

export const useGameStore = create<GameStore>(set => ({
  currentSessionId: undefined,
  selectedCharacterId: undefined,
  messages: {},
  groupMessages: [],
  gamePhase: 'LOBBY',
  chatMode: 'private',
  hasVoted: false,
  votedAccusedId: undefined,
  voteIsCorrect: undefined,
  selectCharacter: (characterId: string) => set({ selectedCharacterId: characterId }),
  addMessage: (characterId: string, message: ChatMessage) =>
    set(state => ({
      messages: {
        ...state.messages,
        [characterId]: [...(state.messages[characterId] ?? []), message],
      },
    })),
  addGroupMessage: (message: ChatMessage) =>
    set(state => ({
      groupMessages: [...state.groupMessages, message],
    })),
  setPhase: (phase: GamePhase) => set({ gamePhase: phase }),
  setChatMode: (mode: ChatMode) => set({ chatMode: mode }),
  setSessionId: (sessionId: string) => set({ currentSessionId: sessionId }),
  hydrateMessages: (messages: Record<string, ChatMessage[]>) => set({ messages }),
  hydrateGroupMessages: (messages: ChatMessage[]) => set({ groupMessages: messages }),
  setVoteResult: (accusedId: string, isCorrect: boolean) =>
    set({
      hasVoted: true,
      votedAccusedId: accusedId,
      voteIsCorrect: isCorrect,
    }),
  resetVoteResult: () =>
    set({
      hasVoted: false,
      votedAccusedId: undefined,
      voteIsCorrect: undefined,
    }),
}));
