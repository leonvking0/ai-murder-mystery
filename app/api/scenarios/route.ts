import { listScenarioCards } from '@/lib/scenarios/registry';

// Public catalog endpoint for the home-page scenario picker. Returns ONLY public ScenarioCard
// metadata (no player/room data, no solution/private fields). No auth needed.
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return Response.json({ scenarios: listScenarioCards() });
}
