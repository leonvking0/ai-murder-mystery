import { RoomClient } from '@/components/room/RoomClient';

interface RoomPageProps {
  params: Promise<{ code: string }>;
}

export const dynamic = 'force-dynamic';

export default async function RoomPage({ params }: RoomPageProps) {
  const { code } = await params;
  return <RoomClient code={code} />;
}
