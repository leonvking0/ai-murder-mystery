// Seat authentication for multiplayer rooms (KI-034 / KI-061 / KI-038).
//
// The auth credential is the secret per-player `playerId` (a UUID minted server-side on create/join).
// We NEVER trust a `playerId` supplied in a query string or JSON body — those are readable/forgeable
// and the old projection even leaked other players' ids. Instead the server hands the client a signed,
// httpOnly, per-room cookie and every route resolves the acting player from that cookie alone.
//
// Token = `${playerId}.${HMAC-SHA256(roomId:playerId)}` (base64url signature). Binding both roomId and
// playerId into the MAC means a token minted for one seat/room cannot be replayed against another.
// No new npm deps — pure `node:crypto`.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Documented dev fallback so local/`next dev` works without config. MUST be overridden in production
// via ROOM_AUTH_SECRET — with the fallback, anyone who knows it can forge seat tokens.
const DEV_FALLBACK_SECRET = 'mm-dev-insecure-room-auth-secret-do-not-use-in-prod';

let warnedMissingSecret = false;

function getSecret(): string {
  const secret = process.env.ROOM_AUTH_SECRET;
  if (secret && secret.length > 0) {
    return secret;
  }
  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    console.warn(
      '[room-auth] ROOM_AUTH_SECRET is not set — using an insecure development fallback. ' +
        'Set ROOM_AUTH_SECRET to a long random string in production, or seat tokens are forgeable.',
    );
  }
  return DEV_FALLBACK_SECRET;
}

/** Per-room cookie name. Scoping by room keeps one browser able to hold several seats concurrently. */
export function cookieName(roomId: string): string {
  return `mm_auth_${roomId}`;
}

function sign(roomId: string, playerId: string): string {
  return createHmac('sha256', getSecret()).update(`${roomId}:${playerId}`).digest('base64url');
}

/** Mint a seat token binding `playerId` to `roomId`. */
export function signToken(roomId: string, playerId: string): string {
  return `${playerId}.${sign(roomId, playerId)}`;
}

/**
 * Verify a seat token. Returns the playerId iff the signature matches for this exact room, else null.
 * Rejects tokens minted for a different playerId or a different roomId (tampered/foreign tokens).
 */
export function verifyToken(roomId: string, token: string | null | undefined): string | null {
  if (!token) {
    return null;
  }
  const sep = token.lastIndexOf('.');
  if (sep <= 0 || sep === token.length - 1) {
    return null;
  }
  const playerId = token.slice(0, sep);
  const signature = token.slice(sep + 1);
  const expected = sign(roomId, playerId);

  const provided = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (provided.length !== wanted.length) {
    return null;
  }
  if (!timingSafeEqual(provided, wanted)) {
    return null;
  }
  return playerId;
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Resolve the acting playerId for `roomId` from the request's signed cookie. Returns null when the
 * cookie is missing, malformed, or the signature does not verify. Routes must 403 on null and must
 * additionally confirm the id is a current member of the room.
 */
export function getAuthedPlayerId(req: Request, roomId: string): string | null {
  return verifyToken(roomId, readCookie(req, cookieName(roomId)));
}

const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Build the `Set-Cookie` value that seats `playerId` in `roomId`. httpOnly (JS can't read the token,
 * limiting XSS token theft), SameSite=Lax (EventSource + navigations still send it), path=/.
 */
export function authCookie(roomId: string, playerId: string): string {
  const attrs = [
    `${cookieName(roomId)}=${signToken(roomId, playerId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV === 'production') {
    attrs.push('Secure');
  }
  return attrs.join('; ');
}

/** Attach the seat cookie to a Response (mutates its headers) and return it, for concise route code. */
export function withAuthCookie(res: Response, roomId: string, playerId: string): Response {
  res.headers.append('Set-Cookie', authCookie(roomId, playerId));
  return res;
}

/** Short, non-secret id for client-side rendering. Distinct from the secret auth `playerId`. */
export function generatePublicId(): string {
  return randomBytes(6).toString('hex');
}
