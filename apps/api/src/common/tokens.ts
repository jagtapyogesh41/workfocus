import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque bearer tokens of the form `<kind>_<prefix>_<secret>`.
 * The prefix is stored in clear for lookup; only a SHA-256 hash of the full token is stored.
 * (High-entropy random secrets do not need a slow password hash.)
 */
export type TokenKind = 'sfc' /* connector */ | 'sfd' /* device */ | 'sfe' /* enrollment */;

export function generateToken(kind: TokenKind): { token: string; prefix: string; hash: string } {
  const prefix = randomBytes(5).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  const token = `${kind}_${prefix}_${secret}`;
  return { token, prefix, hash: sha256(token) };
}

export function parseToken(token: string, kind: TokenKind): { prefix: string } | null {
  const parts = token.split('_');
  if (parts.length < 3 || parts[0] !== kind || !parts[1] || !parts.slice(2).join('_')) return null;
  return { prefix: parts[1] };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
}
