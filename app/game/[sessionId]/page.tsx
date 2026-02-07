import { GameClient } from '@/components/game/GameClient';

interface GamePageProps {
  params: Promise<{ sessionId: string }>;
}

export const dynamic = 'force-dynamic';

export default async function GamePage({ params }: GamePageProps) {
  const { sessionId } = await params;

  return <GameClient sessionId={sessionId} />;
}
