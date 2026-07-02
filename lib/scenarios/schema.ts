// Scenario Schema Validation
// Validates scenario JSON files against expected structure

import type { Scenario, Character, InvestigationLocation, Clue } from '../../types/game';

export class ScenarioValidationError extends Error {
  path: string;

  constructor(message: string, path: string) {
    super(`${path}: ${message}`);
    this.path = path;
    this.name = 'ScenarioValidationError';
  }
}

/**
 * Validates a scenario object and returns it typed, or throws on error
 */
export function validateScenario(data: unknown): Scenario {
  if (!data || typeof data !== 'object') {
    throw new ScenarioValidationError('Scenario must be an object', 'root');
  }

  const scenario = data as Record<string, unknown>;

  // Required string fields
  const requiredStrings = ['id', 'title', 'description'] as const;
  for (const field of requiredStrings) {
    if (typeof scenario[field] !== 'string' || !scenario[field]) {
      throw new ScenarioValidationError(`Missing or invalid ${field}`, field);
    }
  }

  // Player count
  if (!scenario.playerCount || typeof scenario.playerCount !== 'object') {
    throw new ScenarioValidationError('Missing playerCount', 'playerCount');
  }
  const pc = scenario.playerCount as Record<string, unknown>;
  if (typeof pc.min !== 'number' || typeof pc.max !== 'number') {
    throw new ScenarioValidationError('playerCount must have min and max numbers', 'playerCount');
  }

  // Difficulty
  if (!['easy', 'medium', 'hard'].includes(scenario.difficulty as string)) {
    throw new ScenarioValidationError('difficulty must be easy, medium, or hard', 'difficulty');
  }

  // Estimated duration
  if (typeof scenario.estimatedDuration !== 'number') {
    throw new ScenarioValidationError('estimatedDuration must be a number', 'estimatedDuration');
  }

  // Setting
  validateSetting(scenario.setting);

  // Case
  validateCase(scenario.case);

  // Characters
  if (!Array.isArray(scenario.characters) || scenario.characters.length === 0) {
    throw new ScenarioValidationError('characters must be a non-empty array', 'characters');
  }
  for (let i = 0; i < scenario.characters.length; i++) {
    validateCharacter(scenario.characters[i], `characters[${i}]`);
  }
  // Exactly one killer. The engine is single-killer today, so 0 (unsolvable) or >1 (e.g. a duplicate
  // isKiller flag) are both data errors that must fail startup rather than corrupt the reveal.
  const killerCount = scenario.characters.filter(c => (c as Character).isKiller).length;
  if (killerCount !== 1) {
    throw new ScenarioValidationError(
      killerCount === 0
        ? 'Exactly one character must be the killer, but none is flagged isKiller'
        : `Exactly one character must be the killer, but ${killerCount} are flagged isKiller`,
      'characters',
    );
  }

  // Relationship referential integrity: every relationships[].characterId must reference a character
  // that exists in this scenario. Runs after the character loop so all ids are known.
  const characterIds = new Set(scenario.characters.map(c => (c as Character).id));
  for (let i = 0; i < scenario.characters.length; i++) {
    const relationships = (scenario.characters[i] as Record<string, unknown>).relationships as unknown[];
    for (let j = 0; j < relationships.length; j++) {
      const rel = relationships[j];
      if (!rel || typeof rel !== 'object') {
        throw new ScenarioValidationError('relationship must be an object', `characters[${i}].relationships[${j}]`);
      }
      const targetId = (rel as Record<string, unknown>).characterId;
      if (typeof targetId !== 'string' || !targetId) {
        throw new ScenarioValidationError('relationship must have a characterId string', `characters[${i}].relationships[${j}].characterId`);
      }
      if (!characterIds.has(targetId)) {
        throw new ScenarioValidationError(`relationship references unknown character id "${targetId}"`, `characters[${i}].relationships[${j}].characterId`);
      }
    }
  }

  // Locations
  if (!Array.isArray(scenario.locations) || scenario.locations.length === 0) {
    throw new ScenarioValidationError('locations must be a non-empty array', 'locations');
  }
  for (let i = 0; i < scenario.locations.length; i++) {
    validateLocation(scenario.locations[i], `locations[${i}]`);
  }

  // D6: cross-location clue prerequisite graph (global id uniqueness + valid, acyclic prereq edges).
  validateCluePrerequisiteGraph(scenario.locations as InvestigationLocation[]);

  // Phases
  if (!Array.isArray(scenario.phases)) {
    throw new ScenarioValidationError('phases must be an array', 'phases');
  }

  // Timeline
  if (!Array.isArray(scenario.timeline)) {
    throw new ScenarioValidationError('timeline must be an array', 'timeline');
  }

  return scenario as unknown as Scenario;
}

function validateSetting(setting: unknown): void {
  if (!setting || typeof setting !== 'object') {
    throw new ScenarioValidationError('Missing setting object', 'setting');
  }
  const s = setting as Record<string, unknown>;
  const required = ['era', 'location', 'atmosphere', 'backgroundStory'];
  for (const field of required) {
    if (typeof s[field] !== 'string') {
      throw new ScenarioValidationError(`Missing or invalid ${field}`, `setting.${field}`);
    }
  }

  if (s.images !== undefined) {
    if (!s.images || typeof s.images !== 'object' || Array.isArray(s.images)) {
      throw new ScenarioValidationError('images must be an object', 'setting.images');
    }

    const images = s.images as Record<string, unknown>;
    const optionalFields = ['exterior', 'crimeScene', 'livingRoom', 'diningHall'];

    for (const field of optionalFields) {
      if (images[field] !== undefined && typeof images[field] !== 'string') {
        throw new ScenarioValidationError(`${field} must be a string`, `setting.images.${field}`);
      }
    }
  }
}

function validateCase(caseInfo: unknown): void {
  if (!caseInfo || typeof caseInfo !== 'object') {
    throw new ScenarioValidationError('Missing case object', 'case');
  }
  const c = caseInfo as Record<string, unknown>;
  const required = ['victim', 'causeOfDeath', 'timeOfDeath', 'crimeScene', 'truth', 'murderMethod', 'motive'];
  for (const field of required) {
    if (typeof c[field] !== 'string') {
      throw new ScenarioValidationError(`Missing or invalid ${field}`, `case.${field}`);
    }
  }
}

function validateCharacter(char: unknown, path: string): void {
  if (!char || typeof char !== 'object') {
    throw new ScenarioValidationError('Character must be an object', path);
  }
  const c = char as Record<string, unknown>;

  // Required strings
  const requiredStrings = ['id', 'name', 'occupation', 'personality', 'speakingStyle', 'publicInfo', 'privateScript'];
  for (const field of requiredStrings) {
    if (typeof c[field] !== 'string' || !c[field]) {
      throw new ScenarioValidationError(`Missing or invalid ${field}`, `${path}.${field}`);
    }
  }

  if (c.avatar !== undefined && typeof c.avatar !== 'string') {
    throw new ScenarioValidationError('avatar must be a string', `${path}.avatar`);
  }

  // Age
  if (typeof c.age !== 'number') {
    throw new ScenarioValidationError('age must be a number', `${path}.age`);
  }

  // isKiller
  if (typeof c.isKiller !== 'boolean') {
    throw new ScenarioValidationError('isKiller must be a boolean', `${path}.isKiller`);
  }

  // Validate minimum content length for scripts
  if ((c.publicInfo as string).length < 50) {
    throw new ScenarioValidationError('publicInfo should be at least 50 characters', `${path}.publicInfo`);
  }
  if ((c.privateScript as string).length < 100) {
    throw new ScenarioValidationError('privateScript should be at least 100 characters', `${path}.privateScript`);
  }

  // Relationships
  if (!Array.isArray(c.relationships)) {
    throw new ScenarioValidationError('relationships must be an array', `${path}.relationships`);
  }

  // Objectives
  if (!Array.isArray(c.objectives) || c.objectives.length === 0) {
    throw new ScenarioValidationError('objectives must be a non-empty array', `${path}.objectives`);
  }

  // Alibi
  if (!c.alibi || typeof c.alibi !== 'object') {
    throw new ScenarioValidationError('Missing alibi object', `${path}.alibi`);
  }
  const alibi = c.alibi as Record<string, unknown>;
  if (typeof alibi.claimed !== 'string' || typeof alibi.truth !== 'string') {
    throw new ScenarioValidationError('alibi must have claimed and truth strings', `${path}.alibi`);
  }

  // Secrets
  if (!Array.isArray(c.secrets)) {
    throw new ScenarioValidationError('secrets must be an array', `${path}.secrets`);
  }
}

function validateLocation(loc: unknown, path: string): void {
  if (!loc || typeof loc !== 'object') {
    throw new ScenarioValidationError('Location must be an object', path);
  }
  const l = loc as Record<string, unknown>;

  if (typeof l.id !== 'string' || !l.id) {
    throw new ScenarioValidationError('Missing id', `${path}.id`);
  }
  if (typeof l.name !== 'string' || !l.name) {
    throw new ScenarioValidationError('Missing name', `${path}.name`);
  }
  if (typeof l.description !== 'string') {
    throw new ScenarioValidationError('Missing description', `${path}.description`);
  }

  if (!Array.isArray(l.clues)) {
    throw new ScenarioValidationError('clues must be an array', `${path}.clues`);
  }

  for (let i = 0; i < l.clues.length; i++) {
    validateClue(l.clues[i], `${path}.clues[${i}]`);
  }
}

function validateClue(clue: unknown, path: string): void {
  if (!clue || typeof clue !== 'object') {
    throw new ScenarioValidationError('Clue must be an object', path);
  }
  const c = clue as Record<string, unknown>;

  if (typeof c.id !== 'string' || !c.id) {
    throw new ScenarioValidationError('Missing id', `${path}.id`);
  }
  if (typeof c.content !== 'string' || !c.content) {
    throw new ScenarioValidationError('Missing content', `${path}.content`);
  }
  if (!['public', 'private'].includes(c.type as string)) {
    throw new ScenarioValidationError('type must be public or private', `${path}.type`);
  }
  if (typeof c.significance !== 'string') {
    throw new ScenarioValidationError('Missing significance', `${path}.significance`);
  }
  if (
    typeof c.availableInRound !== 'number' ||
    !Number.isInteger(c.availableInRound) ||
    (c.availableInRound as number) < 1
  ) {
    throw new ScenarioValidationError('availableInRound must be a positive integer (>= 1)', `${path}.availableInRound`);
  }
  if (c.prerequisite !== undefined && typeof c.prerequisite !== 'string') {
    throw new ScenarioValidationError('prerequisite must be a string', `${path}.prerequisite`);
  }
}

/**
 * D6: validate the cross-location clue prerequisite graph. Enforces GLOBAL clue-id uniqueness, that every
 * prerequisite references an existing clue id, and that the prerequisite edges form no cycle (WHITE/GRAY/
 * BLACK DFS). Runs after per-location validation so every clue is already shape-checked.
 */
function validateCluePrerequisiteGraph(locations: InvestigationLocation[]): void {
  // Flatten all clues, enforcing global id uniqueness.
  const clueById = new Map<string, Clue>();
  for (let i = 0; i < locations.length; i++) {
    const clues = locations[i].clues;
    for (let j = 0; j < clues.length; j++) {
      const clue = clues[j];
      if (clueById.has(clue.id)) {
        throw new ScenarioValidationError(
          `duplicate clue id "${clue.id}"`,
          `locations[${i}].clues[${j}].id`,
        );
      }
      clueById.set(clue.id, clue);
    }
  }

  // Every non-undefined prerequisite must reference an existing clue id.
  for (const clue of clueById.values()) {
    if (clue.prerequisite !== undefined && !clueById.has(clue.prerequisite)) {
      throw new ScenarioValidationError(
        `prerequisite "${clue.prerequisite}" references an unknown clue id`,
        `clues.${clue.id}.prerequisite`,
      );
    }
  }

  // Cycle detection over prerequisite edges via a WHITE/GRAY/BLACK color map.
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const id of clueById.keys()) {
    color.set(id, WHITE);
  }

  const visit = (id: string): void => {
    color.set(id, GRAY);
    const prereq = clueById.get(id)?.prerequisite;
    if (prereq !== undefined) {
      const prereqColor = color.get(prereq);
      if (prereqColor === GRAY) {
        throw new ScenarioValidationError(
          `prerequisite graph has a cycle involving clue "${id}"`,
          `clues.${id}.prerequisite`,
        );
      }
      if (prereqColor === WHITE) {
        visit(prereq);
      }
    }
    color.set(id, BLACK);
  };

  for (const id of clueById.keys()) {
    if (color.get(id) === WHITE) {
      visit(id);
    }
  }
}

/**
 * Quick summary of scenario for logging
 */
export function summarizeScenario(scenario: Scenario): string {
  const killerCount = scenario.characters.filter(c => c.isKiller).length;
  const totalClues = scenario.locations.reduce((sum, loc) => sum + loc.clues.length, 0);
  
  return `"${scenario.title}" - ${scenario.characters.length} characters (${killerCount} killer), ${scenario.locations.length} locations, ${totalClues} clues`;
}
