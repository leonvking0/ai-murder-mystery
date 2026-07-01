// Player identity persistence. The server mints a playerId on create/join; the client keeps it in
// localStorage per room so a refresh rejoins the same seat.

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
