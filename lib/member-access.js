import { createHash } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const ORIGINS = new Set(['https://frequencytoolkit.com', 'https://www.frequencytoolkit.com']);
export function cors(req, res) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'private, no-store');
  const origin = req.headers?.origin;
  // The standalone page calls its own origin; other hosts require explicit server configuration.
  const standalone = process.env.START_HERE_ORIGIN;
  const allowed = !origin || ORIGINS.has(origin) || (standalone && origin === standalone);
  if (!allowed) throw new ApiError(403, 'This origin is not allowed.', 'ORIGIN_NOT_ALLOWED');
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
  res.setHeader('Access-Control-Expose-Headers', 'Retry-After');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

function settings() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError(503, 'Member access is temporarily unavailable.', 'MEMBER_SERVICE_UNAVAILABLE');
  return { url: url.replace(/\/$/, ''), key };
}

export async function verifyMember(req) {
  const match = typeof req.headers?.authorization === 'string' && req.headers.authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) throw new ApiError(401, 'Please log in to create your guide.', 'UNAUTHENTICATED');
  const { url, key } = settings();
  let response;
  try {
    response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${match[1]}` }, signal: AbortSignal.timeout(10000) });
  } catch { throw new ApiError(503, 'Your login could not be checked right now. Please try again later.', 'AUTH_UNAVAILABLE'); }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new ApiError(401, 'Your login has expired or could not be verified. Please log in again.', 'UNAUTHENTICATED');
    throw new ApiError(503, 'Your login could not be checked right now. Please try again later.', 'AUTH_UNAVAILABLE');
  }
  let user;
  try { user = await response.json(); } catch { throw new ApiError(503, 'Your login could not be checked right now.', 'AUTH_UNAVAILABLE'); }
  if (!user?.id || typeof user.email !== 'string' || !user.email_confirmed_at) throw new ApiError(401, 'Please confirm your account email and log in again.', 'UNAUTHENTICATED');
  return { id: user.id, email: user.email.trim().toLowerCase() };
}

export function requestIdentity(req, input) {
  const key = req.headers?.['idempotency-key'];
  if (typeof key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    throw new ApiError(400, 'A request identifier is required. Reload the guide before trying again.', 'INVALID_REQUEST_KEY');
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({
    userText: input.userText, edition: input.edition,
    confirmedGroups: [...new Set(input.confirmedGroups)].sort(), experience: input.experience, avoid: input.avoid,
  })).digest('hex');
  return { key: key.toLowerCase(), fingerprint };
}

export async function creditRpc(name, args) {
  const { url, key } = settings();
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  // sb_secret_* is opaque, not a JWT; PostgREST only needs apikey for that format.
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  let response;
  try { response = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(args), signal: AbortSignal.timeout(10000) }); }
  catch { throw new ApiError(503, 'Credit processing is temporarily unavailable. Retry this same request later.', 'CREDIT_SERVICE_UNAVAILABLE'); }
  if (!response.ok) {
    console.error('Start Here credit service error', name, response.status);
    throw new ApiError(503, 'Credit processing is temporarily unavailable. Retry this same request later.', 'CREDIT_SERVICE_UNAVAILABLE'); }
  try { return await response.json(); }
  catch { throw new ApiError(503, 'Credit processing is temporarily unavailable. Retry this same request later.', 'CREDIT_SERVICE_UNAVAILABLE'); }
}
export function beginResult(value) {
  if (value?.state === 'succeeded') return value.result;
  if (value?.state === 'started') return null;
  if (value?.state === 'insufficient') throw new ApiError(402, 'No credits remaining', 'INSUFFICIENT_CREDITS');
  if (value?.state === 'conflict') throw new ApiError(409, 'This request identifier belongs to different answers. Start over for a new guide.', 'REQUEST_CONFLICT');
  if (value?.state === 'processing') throw new ApiError(409, 'Your guide is still being prepared. Retry the same request shortly.', 'REQUEST_PROCESSING');
  if (value?.state === 'refunded') throw new ApiError(502, 'This guide could not be completed. Your credit was returned. Start over to request a new guide.', 'GENERATION_REFUNDED');
  if (value?.state === 'failed') throw new ApiError(503, 'Your member credit record is not available. No credit was charged; check your account and start over.', 'MEMBER_RECORD_MISSING');
  throw new ApiError(503, 'Your member credit record could not be processed. Retry this same request later.', 'CREDIT_SERVICE_UNAVAILABLE');
}