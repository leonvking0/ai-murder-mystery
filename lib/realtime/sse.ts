// Shared Server-Sent Events helpers (server side). Consolidates the headers + framing that were
// duplicated across the old chat/group-chat routes (KI-020).

export function sseHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };
}

export function encodeSSE(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export function encodeSSEComment(text: string): Uint8Array {
  return new TextEncoder().encode(`: ${text}\n\n`);
}
