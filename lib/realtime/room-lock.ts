// Per-room turn mutex. Serializes the NPC generate-and-broadcast section per roomId so two concurrent
// group-chat POSTs to the SAME room never interleave `npc_*` events (C1). Different rooms never block
// each other. Implemented as a per-room promise chain (one tail Promise per room) hung off globalThis
// so it survives Next dev HMR — mirrors the registry pattern in room-bus.ts.
//
// Only the NPC streaming/persist block is wrapped; the human's own message post+broadcast happens
// BEFORE the lock in the route, so player lines still appear immediately and in order.

const globalForLock = globalThis as unknown as { __roomTurnLocks?: Map<string, Promise<unknown>> };
const tails: Map<string, Promise<unknown>> = (globalForLock.__roomTurnLocks ??= new Map());

/**
 * Run `fn` with exclusive access to `roomId`: calls for the same room run one-at-a-time, in arrival
 * order. `fn`'s result is returned to its caller; a throw propagates to that caller only and never
 * blocks the next waiter (each gate always opens in `finally`).
 */
export async function runExclusive<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(roomId) ?? Promise.resolve();

  // `gate` opens (resolves) only when THIS task finishes; the next waiter awaits our tail, which
  // chains prev → gate. gate never rejects, so the chain never breaks even if `fn` throws.
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const tail = prev.then(() => gate);
  tails.set(roomId, tail);

  await prev.catch(() => undefined); // wait our turn; a prior turn's outcome must not block us
  try {
    return await fn();
  } finally {
    release();
    // If nobody queued behind us, drop the entry so idle rooms don't leak (runs synchronously with
    // release(), so no concurrent call can slip in between).
    if (tails.get(roomId) === tail) {
      tails.delete(roomId);
    }
  }
}
