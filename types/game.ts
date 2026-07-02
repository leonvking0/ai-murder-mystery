// Game Types - AI Murder Mystery
// Based on PROJECT-BRIEF.md specifications

// ============ SCENARIO TYPES ============

export interface Scenario {
  id: string;
  title: string;
  description: string;
  playerCount: { min: number; max: number };
  difficulty: 'easy' | 'medium' | 'hard';
  estimatedDuration: number; // minutes

  setting: ScenarioSetting;
  case: CaseInfo;
  characters: Character[];
  locations: InvestigationLocation[];
  phases: PhaseConfig[];
  timeline: TimelineEvent[];
}

export interface ScenarioSetting {
  era: string;
  location: string;
  atmosphere: string;
  backgroundStory: string;
  images?: {
    exterior?: string;
    crimeScene?: string;
    livingRoom?: string;
    diningHall?: string;
  };
}

export interface CaseInfo {
  victim: string;
  causeOfDeath: string;
  timeOfDeath: string;
  crimeScene: string;
  truth: string; // GM only
  murderMethod: string;
  motive: string;
}

// ============ CHARACTER TYPES ============

export interface Character {
  id: string;
  name: string;
  age: number;
  occupation: string;
  personality: string;
  speakingStyle: string;
  avatar?: string;

  publicInfo: string;
  privateScript: string;
  isKiller: boolean;

  relationships: CharacterRelationship[];
  objectives: CharacterObjective[];
  alibi: CharacterAlibi;
  secrets: string[];
}

export interface CharacterRelationship {
  characterId: string;
  publicRelation: string;
  privateRelation: string;
}

export interface CharacterObjective {
  description: string;
  type: 'primary' | 'secondary';
  isSecret: boolean;
}

export interface CharacterAlibi {
  claimed: string;
  truth: string;
}

// ============ MEMORY TYPES ============

export interface CharacterMemory {
  // Static - set at initialization
  characterId: string;
  privateScript: string;
  publicProfile: string;
  objectives: string[];

  // Dynamic - updated during game
  conversations: ConversationSummary[];
  discoveredClues: Clue[];
  knownFacts: string[];
  suspicions: SuspicionRecord[];
  emotionalState: string;
}

export interface ConversationSummary {
  withCharacterId: string;
  round: number;
  summary: string;
  timestamp: number;
}

export interface SuspicionRecord {
  characterId: string;
  level: number; // 0-10
  reasons: string[];
}

// ============ CLUE TYPES ============

export interface Clue {
  id: string;
  content: string;
  type: 'public' | 'private';
  significance: string;
  availableInRound: number;
  prerequisite?: string;
  foundBy?: string;
  foundAt?: string;
}

export interface InvestigationLocation {
  id: string;
  name: string;
  description: string;
  image?: string;
  clues: Clue[];
}

// ============ PHASE TYPES ============

export type GamePhase =
  | 'LOBBY'
  | 'READING'
  | 'INTRO'
  | 'DISCUSSION_1'
  | 'INVESTIGATION_1'
  | 'DISCUSSION_2'
  | 'INVESTIGATION_2'
  | 'FINAL_DISCUSSION'
  | 'VOTING'
  | 'REVEAL';

export interface PhaseConfig {
  type: 'intro' | 'discussion' | 'investigation' | 'vote' | 'reveal';
  round?: number;
  duration?: number;
  description: string;
  gmScript?: string;
}

export interface TimelineEvent {
  time: string;
  event: string;
  involvedCharacters: string[];
  isPublicKnowledge: boolean;
}

// ============ GAME STATE TYPES ============

export interface GameSession {
  id: string;
  scenarioId: string;
  currentPhase: GamePhase;
  round: number;
  startedAt: number;
  
  // Player
  playerCharacterId?: string;
  
  // NPC memories (keyed by character ID)
  characterMemories: Record<string, CharacterMemory>;
  
  // Clues discovered this game
  discoveredClues: Clue[];
  
  // Votes cast (characterId -> votedForId)
  votes: Record<string, string>;
  
  // Chat histories per character
  chatHistories: Record<string, ChatMessage[]>;
  
  // Group chat history (discussion phases)
  groupChatHistory: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  role: 'player' | 'npc' | 'gm' | 'system';
  characterId?: string;
  // In multiplayer, a 'player' message is authored by a human; this is their player id.
  playerId?: string;
  content: string;
  timestamp: number;
}

// ============ ROOM / MULTIPLAYER TYPES ============

export type RoomStatus = 'lobby' | 'in_progress' | 'finished';

export type CharacterControl =
  | { kind: 'human'; playerId: string }
  | { kind: 'npc' };

export interface Player {
  // Secret auth credential (server-only): whoever presents a token bound to this id acts as this
  // player. NEVER project another player's `id` to a client — use `publicId` for rendering.
  id: string;
  // Non-secret, stable id used purely for client-side rendering/keys. Safe to expose to everyone.
  publicId: string;
  name: string;
  isHost: boolean;
  assignedCharacterId?: string;
  connected: boolean;
  joinedAt: number;
}

export interface Room {
  id: string;
  code: string; // short shareable join code
  scenarioId: string;
  status: RoomStatus;
  currentPhase: GamePhase;
  round: number;
  hostPlayerId: string;

  players: Player[];
  // Who controls each character once the game starts (random assignment).
  characterControl: Record<string, CharacterControl>;
  // Memory for NPC-controlled characters only (humans drive their own).
  characterMemories: Record<string, CharacterMemory>;

  // Per-player private notebook of discovered private clues (keyed by playerId).
  discoveredClues: Record<string, Clue[]>;
  // Public clues visible to everyone.
  publicClues: Clue[];

  groupChatHistory: ChatMessage[];
  // Private 1:1 threads, keyed by `${playerId}:${characterId}`.
  privateChats: Record<string, ChatMessage[]>;

  // playerId -> accused characterId
  votes: Record<string, string>;

  createdAt: number;
  updatedAt: number;
}

// ---- Public projections (safe to send to clients pre-reveal) ----

export interface CharacterPublic {
  id: string;
  name: string;
  age: number;
  occupation: string;
  personality: string;
  speakingStyle: string;
  avatar?: string;
  publicInfo: string;
  publicRelations: { characterId: string; publicRelation: string }[];
}

export interface LocationPublic {
  id: string;
  name: string;
  description: string;
  image?: string;
}

// Clue as shown to a player: GM-only `significance` and round metadata are stripped (KI-006).
export interface ClueView {
  id: string;
  content: string;
  type: 'public' | 'private';
  foundAt?: string; // human-readable location name
}

export interface ScenarioPublic {
  id: string;
  title: string;
  description: string;
  playerCount: { min: number; max: number };
  difficulty: Scenario['difficulty'];
  estimatedDuration: number;
  setting: ScenarioSetting;
  case: {
    victim: string;
    causeOfDeath: string;
    timeOfDeath: string;
    crimeScene: string;
  };
  characters: CharacterPublic[];
  locations: LocationPublic[];
  timeline: TimelineEvent[]; // public-knowledge events only
}

export interface PublicPlayer {
  // Non-secret render id. This is NOT the auth `playerId` of anyone (KI-034): shipping real player
  // ids let any member impersonate another and read their solution via /state.
  publicId: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  assignedCharacterId?: string; // character *identity* is public once assigned; secrets are not
  isSelf: boolean; // server-set: true only for the requesting (cookie-authenticated) player
}

export interface RevealInfo {
  truth: string;
  murderMethod: string;
  motive: string;
  killerCharacterId: string;
  characters: Character[]; // full cast incl. private data — only sent at REVEAL
  cast: { characterId: string; playerName: string | null }[]; // who played whom (null = NPC)
  tally: { characterId: string; votes: number }[];
  accusedCharacterId: string | null; // most-voted character (null if no votes / tie)
  groupCorrect: boolean; // did the group's majority accuse the killer
  youWereKiller: boolean; // did the requesting player play the killer
  // Faction outcome for the requesting player: the killer wins by ESCAPING (group wrong); everyone
  // else wins by catching the killer (group correct). See buildReveal for the truth table.
  outcome: 'win' | 'loss';
}

// What a single player is allowed to see.
export interface PlayerRoomView {
  room: {
    id: string;
    code: string;
    status: RoomStatus;
    currentPhase: GamePhase;
    round: number;
    hostPlayerId: string;
    players: PublicPlayer[];
    publicClues: ClueView[];
    yourClues: ClueView[];
    groupChatHistory: ChatMessage[];
    yourPrivateChats: Record<string, ChatMessage[]>; // keyed by NPC characterId
    voteCount: number;
    youVotedFor?: string;
  };
  you: Player;
  scenario: ScenarioPublic;
  yourCharacter: Character | null; // full own character (own private script) once assigned
  reveal?: RevealInfo; // only when currentPhase === 'REVEAL'
}

// ============ API TYPES ============

export interface CreateGameRequest {
  scenarioId: string;
  playerCharacterId?: string;
}

export interface CreateGameResponse {
  sessionId: string;
  scenario: Scenario;
}

export interface ChatRequest {
  sessionId: string;
  targetCharacterId: string;
  message: string;
}

export interface InvestigateRequest {
  sessionId: string;
  locationId: string;
}

export interface VoteRequest {
  accusedCharacterId: string;
}

export interface VoteResponse {
  success: true;
  accusedId: string;
  isCorrect: boolean;
}

export interface InvestigationResult {
  locationId: string;
  locationName: string;
  round: number;
  newlyFound: Clue[];
  alreadyFound: Clue[];
  publicClues: Clue[];
  privateClues: Clue[];
}

export interface GameStateResponse {
  session: GameSession;
  scenario: Scenario;
}

export interface InvestigateResponse {
  session: GameSession;
  scenario: Scenario;
  result: InvestigationResult;
}

// ============ GM TYPES ============

export interface GMResponse {
  narration: string;
  action: 'none' | 'advance_phase' | 'release_clue' | 'prompt_npc';
  target?: string;
}
