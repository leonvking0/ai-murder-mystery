import type { FlowId } from '@/lib/game-engine/flow';
import { withAuthCookie } from '@/lib/room/auth';
import { getScenarioById } from '@/lib/scenarios/registry';
import { validateScenario, ScenarioValidationError } from '@/lib/scenarios/schema';
import { analyzeAllFlows } from '@/lib/scenarios/solvability';
import { createRoom } from '@/lib/store/rooms';
import type { Scenario } from '@/types/game';

interface CreateRoomBody {
  scenarioId?: string;
  hostName?: string;
  flowId?: FlowId;
  // F4-d: opt in to deadline-based auto-advance (default false).
  autoAdvance?: boolean;
  // F2-tail (UGC): an inline custom scenario JSON to import for this room (host-authored). When present
  // it is validated + solvability-gated and stored on the room; it takes precedence over scenarioId.
  customScenario?: unknown;
}

// 256KB cap on the raw request body. A pasted scenario is a few KB; anything larger is abuse/mistake.
const MAX_BODY_BYTES = 262144;

export async function POST(req: Request): Promise<Response> {
  try {
    // Read the raw text first so we can enforce a size guard before parsing (a huge custom scenario
    // must be rejected outright, not parsed into memory).
    const rawText = await req.text();
    if (Buffer.byteLength(rawText, 'utf8') > MAX_BODY_BYTES) {
      return Response.json({ error: '剧本文件过大' }, { status: 413 });
    }

    let body: CreateRoomBody;
    try {
      body = rawText ? (JSON.parse(rawText) as CreateRoomBody) : {};
    } catch {
      body = {};
    }

    const hostName = (body.hostName ?? '').slice(0, 40);
    // Validate the flow preset: only the two known ids are accepted; anything else (incl. undefined)
    // falls back to the standard flow.
    const flowId: FlowId = body.flowId === 'quick' ? 'quick' : 'standard';
    const autoAdvance = body.autoAdvance === true;

    // F2-tail (UGC): if the host supplied a custom scenario, validate + solvability-gate it and store the
    // full object on the room. It resolves per-player through the SAME projection as built-in scenarios.
    if (body.customScenario !== null && body.customScenario !== undefined) {
      let scenario: Scenario;
      try {
        scenario = validateScenario(body.customScenario);
      } catch (validationError) {
        const message =
          validationError instanceof ScenarioValidationError
            ? validationError.message
            : '未知错误';
        return Response.json({ error: '剧本格式无效: ' + message, code: 'invalid_scenario' }, { status: 400 });
      }

      const reports = analyzeAllFlows(scenario);
      if (reports.some(report => !report.solvable)) {
        // Only surface 'error'-severity issues (warnings are advisory). This response goes to the host
        // who authored the scenario, so exposing structural issue text is fine — it is not another
        // player's secret.
        const issues = reports.flatMap(report =>
          report.issues
            .filter(issue => issue.severity === 'error')
            .map(issue => ({ flowId: report.flowId, code: issue.code, message: issue.message })),
        );
        return Response.json(
          {
            error: '剧本无法解出（存在死线索或凶手不可推断等问题）',
            code: 'unsolvable',
            issues,
          },
          { status: 422 },
        );
      }

      const room = createRoom({ scenarioId: scenario.id, hostName, flowId, autoAdvance, customScenario: scenario });
      const host = room.players[0];
      return withAuthCookie(
        Response.json({ roomId: room.id, code: room.code, playerId: host.id }),
        room.id,
        host.id,
      );
    }

    // Built-in path (unchanged): validate scenarioId against the registry.
    const scenarioId = body.scenarioId?.trim() || 'storm-mansion';
    const scenario = getScenarioById(scenarioId);
    if (!scenario) {
      return Response.json({ error: 'Scenario not found' }, { status: 404 });
    }

    const room = createRoom({ scenarioId, hostName, flowId, autoAdvance });
    const host = room.players[0];

    // Seat the host: bind their playerId into a signed httpOnly per-room cookie. The response body no
    // longer needs to be trusted for auth — the cookie is the only credential the server verifies.
    return withAuthCookie(
      Response.json({ roomId: room.id, code: room.code, playerId: host.id }),
      room.id,
      host.id,
    );
  } catch (error) {
    console.error('Create room failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
