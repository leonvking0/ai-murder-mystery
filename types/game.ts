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

  // F4-c: scenario-authored GM narration per phase (keyed by GamePhase). Falls back to the generic
  // PHASE_NARRATIONS defaults when a phase is absent. Public game text — safe to project.
  narrations?: Partial<Record<GamePhase, string>>;
  // F4-c: per-phase suggested duration in minutes (display only — no auto-advance). Public structure.
  phaseDurations?: Partial<Record<GamePhase, number>>;
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
  // In multiplayer, a 'player' message is authored by a human; this is their real (secret) player id.
  // SERVER-ONLY: `playerId` is the seat auth credential (KI-034) and MUST be stripped before a message is
  // projected to /state or broadcast over the room bus — a stored group/private message that kept it
  // leaked the credential to every other member (KI-066). Use `authorPublicId` for client rendering.
  playerId?: string;
  // Non-secret public render id of the human author, set by the projection/broadcast sanitizer
  // (`toPublicMessage`). Safe to expose. Clients detect their own messages via
  // `authorPublicId === you.publicId`, never via the real `playerId`.
  authorPublicId?: string;
  content: string;
  timestamp: number;
}

// ============ ROOM / MULTIPLAYER TYPES ============

export type RoomStatus = 'lobby' | 'in_progress' | 'finished';

export type CharacterControl =
  | { kind: 'human'; playerId: string }
  // When a disconnected human's seat is taken over by an NPC (D2), we remember whose seat it was so
  // the reveal can still attribute the character to the original human. `takenOverFromPlayerId` is a
  // real (secret) playerId — it is SERVER-ONLY and is only ever mapped to a name inside buildReveal.
  | { kind: 'npc'; takenOverFromPlayerId?: string };

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
  // D2 presence (SERVER-ONLY — never projected to any client): when the player's LAST SSE stream
  // closed (undefined = currently connected), and when they were last seen. Used to drive idle-based
  // seat takeover + host handoff. Projection strips these; clients only see `connected` + `publicId`.
  disconnectedAt?: number;
  lastSeenAt?: number;
}

export interface Room {
  id: string;
  code: string; // short shareable join code
  scenarioId: string;
  status: RoomStatus;
  currentPhase: GamePhase;
  round: number;
  // F4: the ordered phase walk this room follows (stamped at createRoom from the selected flow).
  // Optional for backward-compat with rooms persisted before F4; read sites fall back to FLOWS.standard.
  phaseSequence?: GamePhase[];
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
  // Per-(player, phase) investigation counter, keyed `${playerId}:${phase}` (C8 / KI-042). Bounded by
  // INVESTIGATION_BUDGET; one investigateRoom() call = one unit. Optional so pre-existing rows default
  // to "nothing spent".
  investigationCounts?: Record<string, number>;
  // How many tie-triggered revotes have already been granted this game (C9 / KI-043). Capped at 1 so a
  // persistent tie eventually resolves to REVEAL (killer escapes) instead of looping forever.
  voteRevoteCount?: number;

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

// Public catalog entry for the home-page scenario picker. Contains ONLY public metadata —
// NEVER solution/private fields (characters, case.truth/method/motive, isKiller, secrets, clues).
export interface ScenarioCard {
  id: string;
  title: string;
  description: string;
  playerCount: { min: number; max: number };
  difficulty: Scenario['difficulty'];
  estimatedDuration: number;
  atmosphere: string; // from setting.atmosphere — public flavor only
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
  // F4-c: per-phase suggested duration in minutes (display only). Public — not secret.
  phaseDurations?: Partial<Record<GamePhase, number>>;
}

export interface PublicPlayer {
  // Non-secret render id. This is NOT the auth `playerId` of anyone (KI-034): shipping real player
  // ids let any member impersonate another and read their solution via /state.
  publicId: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  assignedCharacterId?: string; // character *identity* is public once assigned; secrets are not
  // True when this seat is currently NPC-controlled (either never assigned to a human, or a
  // disconnected human's seat that was taken over). Public-safe: reveals only that the AI drives it.
  controlledByNpc: boolean;
  isSelf: boolean; // server-set: true only for the requesting (cookie-authenticated) player
}

// One scored win-condition for a character at REVEAL. Reveal-only + isolation-safe: computed purely
// from already-revealed tally/ballots (see buildReveal), never from private script data.
export interface ObjectiveScore {
  kind: 'escape' | 'not_accused' | 'vote_correct' | 'secret_hidden';
  label: string;      // human-readable Chinese, set server-side
  achieved: boolean;
  points: number;
}

// A per-character scorecard, one per scenario character. Reveal-only + isolation-safe.
export interface ScoreCard {
  characterId: string;
  playerName: string | null;   // reuse the cast attribution (null = AI seat)
  isKiller: boolean;
  objectives: ObjectiveScore[];
  total: number;               // sum of `points` for achieved objectives
}

export interface RevealInfo {
  truth: string;
  murderMethod: string;
  motive: string;
  killerCharacterId: string;
  characters: Character[]; // full cast incl. private data — only sent at REVEAL
  cast: { characterId: string; playerName: string | null }[]; // who played whom (null = NPC)
  tally: { characterId: string; votes: number }[];
  // Per-ballot breakdown of who voted for whom, keyed by CHARACTER — never playerId. Every voter (human
  // or NPC) is resolved to their character id; any vote key that maps to no character is dropped.
  ballots: { voterCharacterId: string; accusedCharacterId: string }[];
  accusedCharacterId: string | null; // most-voted character (null if no votes / tie)
  groupCorrect: boolean; // did the group's majority accuse the killer
  youWereKiller: boolean; // did the requesting player play the killer
  // Faction outcome for the requesting player: the killer wins by ESCAPING (group wrong); everyone
  // else wins by catching the killer (group correct). See buildReveal for the truth table.
  outcome: 'win' | 'loss';
  // Machine-checkable objectives scoreboard (F3). Reveal-only + isolation-safe: derived purely from the
  // already-revealed tally/ballots/accused, never from private per-character data. One card per character.
  scoreboard: ScoreCard[];
}

// What a single player is allowed to see.
export interface PlayerRoomView {
  room: {
    id: string;
    code: string;
    status: RoomStatus;
    currentPhase: GamePhase;
    round: number;
    // F4-b: the room's ordered phase walk (public game structure — which phases, in what order — NOT a
    // secret). Lets the client render the right number of steps for quick vs standard flows.
    phaseSequence: GamePhase[];
    // Non-secret render id of the host (KI-034): shipping the host's real `hostPlayerId` here leaked a
    // seat auth credential to every member. Clients identify the host via `you.isHost` / `player.isHost`.
    hostPublicId: string;
    players: PublicPlayer[];
    publicClues: ClueView[];
    yourClues: ClueView[];
    groupChatHistory: ChatMessage[];
    yourPrivateChats: Record<string, ChatMessage[]>; // keyed by NPC characterId
    voteCount: number;
    youVotedFor?: string;
    // C8 investigation budget (public-safe): the per-phase cap and how many searches THIS player has
    // already spent in the current phase.
    investigationBudget: number;
    yourInvestigationsThisPhase: number;
    // C9 voting integrity (public-safe counts only — never who-voted-for-whom pre-reveal): how many
    // connected humans there are, how many have voted, whether all have, and the tie-revote counter.
    connectedHumanCount: number;
    humansVotedCount: number;
    allHumansVoted: boolean;
    voteRevoteCount: number;
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
