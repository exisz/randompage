import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

const endpoint = process.env.LOGTO_ENDPOINT || 'https://id.rollersoft.com.au';
const apiResource = process.env.LOGTO_API_RESOURCE || process.env.VITE_LOGTO_API_RESOURCE || '';
const issuer = `${endpoint.replace(/\/$/, '')}/oidc`;
const jwksUrl = new URL(`${issuer}/jwks`);

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(jwksUrl);
  return jwks;
}

export type VerifiedClaims = JWTPayload & { sub: string };

export async function verifyBearer(authHeader: string | undefined): Promise<VerifiedClaims> {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    throw new Error('Missing Bearer token');
  }
  const token = authHeader.slice(7).trim();
  if (!apiResource) throw new Error('LOGTO_API_RESOURCE not configured');

  const { payload } = await jwtVerify(token, getJwks(), {
    issuer,
    audience: apiResource,
  });
  if (!payload.sub) throw new Error('Token missing sub');
  return payload as VerifiedClaims;
}
