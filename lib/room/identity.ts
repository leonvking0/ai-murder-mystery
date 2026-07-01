// Player identity persistence — UX bookkeeping ONLY. Auth is a signed httpOnly cookie the server sets
// on create/join (see lib/room/auth.ts); the server trusts that cookie, never this value. The client
// keeps the minted playerId in localStorage per room purely to remember "have I already joined this
// room" so a refresh skips the join screen. It is never sent as an auth token.

export function playerKey(roomId: string): string {
  return `mm_player_${roomId}`;
}

export function getPlayerId(roomId: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.localStorage.getItem(playerKey(roomId));
}

export function setPlayerId(roomId: string, playerId: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(playerKey(roomId), playerId);
}
