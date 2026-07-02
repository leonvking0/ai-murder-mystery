import { getScenarioById } from '@/lib/scenarios/registry';
import { getRoomByCode } from '@/lib/store/rooms';

interface RouteContext {
  params: Promise<{ code: string }>;
}

// Per-IP sliding-window limit (KI-055) — this endpoint is public + unauthenticated, and the 31^5 code
// space is small enough to enumerate. Throttle so a scraper can't brute-force codes to discover live
// rooms. Mirrors the pattern in app/api/room/[id]/join/route.ts. Module-level = per-process, fine for
// one container.
const RESOLVE_WINDOW_MS = 60_000;
const RESOLVE_MAX_PER_WINDOW = 30;
const resolveHits = new Map<string, number[]>();

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const cutoff = now - RESOLVE_WINDOW_MS;
  const hits = (resolveHits.get(ip) ?? []).filter(timestamp => timestamp > cutoff);
  if (hits.length >= RESOLVE_MAX_PER_WINDOW) {
    resolveHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  resolveHits.set(ip, hits);
  return false;
}

// Public lookup so the /room/[code] join page can resolve a code → room id + basic info,
// before the visitor has joined (no secrets here).
export async function GET(req: Request, context: RouteContext): Promise<Response> {
  try {
    if (isRateLimited(clientIp(req))) {
      return Response.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { code } = await context.params;
    const room = getRoomByCode(code);
    if (!room) {
      return Response.json({ error: 'Room not found' }, { status: 404 });
    }

    const scenario = getScenarioById(room.scenarioId);

    return Response.json({
      roomId: room.id,
      code: room.code,
      status: room.status,
      playerCount: room.players.length,
      scenarioTitle: scenario?.title ?? room.scenarioId,
    });
  } catch (error) {
    console.error('Resolve room failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
