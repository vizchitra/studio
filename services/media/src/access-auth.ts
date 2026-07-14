import { createRemoteJWKSet, jwtVerify } from "jose";

export interface AccessEnv {
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
}

// Module-scope cache: reused across requests within the same warm isolate.
// `createRemoteJWKSet` already caches individual keys internally, this just
// avoids re-parsing the JWKS URL on every call.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

export class AccessAuthError extends Error {}

/**
 * Verifies the Cf-Access-Jwt-Assertion header against Access's public keys.
 * The Cf-Access-Authenticated-User-Email header is a UX convenience Access
 * adds for convenience — it is NOT itself verified by this function's caller
 * and must not be trusted on its own (this Worker's own workers.dev URL is
 * reachable directly, bypassing Access's edge enforcement entirely, so the
 * JWT signature is the only real trust boundary). Returns the verified
 * email claim on success; throws AccessAuthError otherwise.
 */
export async function verifyAccessJwt(request: Request, env: AccessEnv): Promise<string> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    throw new AccessAuthError("Missing Cf-Access-Jwt-Assertion header");
  }

  const jwks = getJwks(env.CF_ACCESS_TEAM_DOMAIN);

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      issuer: `https://${env.CF_ACCESS_TEAM_DOMAIN}`,
      audience: env.CF_ACCESS_AUD,
    }));
  } catch (err) {
    throw new AccessAuthError(`JWT verification failed: ${String(err)}`);
  }

  const email = payload.email;
  if (typeof email !== "string" || !email) {
    throw new AccessAuthError("JWT missing email claim");
  }

  return email;
}
