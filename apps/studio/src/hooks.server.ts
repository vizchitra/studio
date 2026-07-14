import type { Handle } from "@sveltejs/kit";

/**
 * Cloudflare Access sits in front of studio.vizchitra.com and handles login
 * (Google as the identity provider — see architecture/Studio Architecture RFC v1.md,
 * Deployment section). Access injects the authenticated user's email into this
 * header on every request that reaches the Worker; if it's missing, Access
 * itself rejected the request before it got here.
 *
 * This is enough for read identity in local dev behind `wrangler pages dev`.
 * Before handling anything sensitive (writes, permission checks), verify the
 * `Cf-Access-Jwt-Assertion` JWT against Access's public keys instead of
 * trusting the header alone — the header is fine as a UX convenience, the JWT
 * is the actual trust boundary.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const email = event.request.headers.get("Cf-Access-Authenticated-User-Email");
  event.locals.user = email ? { email } : null;
  return resolve(event);
};
