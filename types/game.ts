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
  content: string;
  timestamp: number;
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
  sessionId: string;
  votedForId: string;
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
