# Studio bootstrap — run in Claude Code / a real terminal

This needs an authenticated `wrangler` session against your Cloudflare
account, so it has to run locally, not inside Cowork's sandbox.

## Status (vizchitra account)

Steps 1–8 are done for the `vizchitra` Cloudflare account and the
`vizchitra/studio` GitHub repo:

- D1 `studio` (`5755274a-7116-4182-ac3a-0935756b1580`), R2 bucket
  `studio-media`, Queue `studio-media-processing` provisioned;
  `account_id`/`database_id` filled into both `wrangler.toml` files.
- Cloudflare Access: Google OAuth (via Google Cloud project
  `vizchitra-studio`) added as the Zero Trust identity provider; a
  self-hosted Access application gates `studio.vizchitra.com` behind an
  explicit email allowlist. Team name: `vizchitra`.
- `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets set.
- `apps/studio` and `services/media` deployed and live.
- Step 9 (branch protection) is drafted but **not enforced** — see the
  note under that step; the org is on GitHub Free.

Two gotchas hit during this bootstrap that aren't obvious from the steps
below:

- `wrangler@4.110.0` requires **Node >=22**. All three workflow files in
  `.github/workflows/` are pinned to Node 22 for this reason — don't drop
  them back to 20, it silently breaks `deploy.yml` (migrations/deploy
  steps invoke `wrangler` directly) without failing the job in an obvious
  way until you read the log closely.
- `apps/studio/vite.config.js` must import `sveltekit` from
  `@sveltejs/kit/vite` (not `svelte` from `@sveltejs/vite-plugin-svelte`)
  — the latter compiles but silently drops SvelteKit's routing, so every
  route 404s in local dev with no error printed.

## 1. Install

```
npm install
```

## 2. Authenticate

```
wrangler login
```

## 3. Provision Cloudflare resources

```
wrangler d1 create studio
wrangler r2 bucket create studio-media
wrangler queues create studio-media-processing
```

`wrangler d1 create` prints a `database_id`. Paste it into the
`database_id` field in both:

- `apps/studio/wrangler.toml`
- `services/media/wrangler.toml`

Also fill in `account_id` in both files (`wrangler whoami` shows it).

## 4. Run migrations

```
npm run migrate:local    # SQLite emulation, for local dev
npm run migrate:remote   # applies to the real D1 database
```

Migrations run in order: `0001_core_entities.sql`, `0002_media.sql`,
`0003_cross_cutting.sql`. This uses `wrangler d1 migrations apply`, which
tracks what's already been applied in a `d1_migrations` table — safe to
rerun any time, it only applies new files. That's also what the `deploy`
GitHub Actions workflow calls on every merge to main (step 9 below).

## 5. Cloudflare Access (Google as the login provider)

Manual step in the Zero Trust dashboard — not scriptable from wrangler.toml:

1. Zero Trust dashboard → Settings → Authentication → add **Google** as a
   login method (Workspace SSO if you have it, otherwise standard Google
   OAuth).
2. Zero Trust dashboard → Access → Applications → Add an application →
   Self-hosted.
   - Domain: `studio.vizchitra.com`
   - Policy: Allow, Include → your team's email domain (or an explicit
     email list if you don't have Workspace).
   - Login method: Google only (remove other default options).
3. DNS: add `studio.vizchitra.com` as a proxied CNAME/A record in the
   `vizchitra.com` zone so the Worker route in `apps/studio/wrangler.toml`
   resolves.

## 6. Local dev

```
npm run dev                              # apps/studio, SvelteKit dev server
cd services/media && wrangler dev        # media Worker + queue consumer
```

## 7. Deploy (manual, first time)

```
cd apps/studio && npm run deploy
cd services/media && wrangler deploy
```

Do this once by hand to confirm everything's wired up correctly. After
that, merges to `main` deploy automatically (step 9).

## 8. GitHub Actions secrets

The CI/CD workflows in `.github/workflows/` need two repo secrets to
talk to Cloudflare.

Create a scoped API token: Cloudflare dashboard → My Profile → API
Tokens → Create Token → Custom token, with:

- Account → Workers Scripts → Edit
- Account → D1 → Edit
- Account → Workers R2 Storage → Edit
- Account → Workers Queues → Edit
- Zone → Workers Routes → Edit (scoped to the `vizchitra.com` zone)

Then add it as a repo secret, either via the GitHub UI (repo → Settings
→ Secrets and variables → Actions → New repository secret) or the `gh`
CLI:

```
gh secret set CLOUDFLARE_API_TOKEN --repo vizchitra/studio
gh secret set CLOUDFLARE_ACCOUNT_ID --repo vizchitra/studio   # from `wrangler whoami`
```

## 9. Branch protection on main

Push this repo and open one PR first — GitHub only lets you require a
status check that has run at least once, and the CI job is named `build`
(shows up as the check `CI / build`).

**Private-repo branch protection (classic or rulesets) requires GitHub
Pro/Team for the org** — the free plan returns a 403 ("Upgrade to GitHub
Pro or make this repository public") for both the classic API below and
the newer Rulesets UI. For `vizchitra` (currently Free), a ruleset named
`main-protection` has been configured in the dashboard matching the
policy below, but it shows "won't be enforced ... until you upgrade" and
does nothing yet. Options: upgrade the org, make the repo public, or
proceed without enforcement (fine solo — just merge via PRs by
convention) until either changes.

```
git push -u origin main
# open any PR, let the "CI" workflow run once, then:

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  repos/vizchitra/studio/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["build"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": null,
  "restrictions": null
}
EOF
```

This blocks direct pushes to `main` (including from you as admin —
`enforce_admins: true`) and requires the CI check to pass before a PR can
merge. No mandatory review count for now since it's just you; add
`"required_pull_request_reviews": {"required_approving_review_count": 1}`
once there's a second contributor. Same thing via the UI: repo →
Settings → Branches → Add branch protection rule → `main` → check
"Require status checks to pass" (select `build`) and "Include
administrators".

Once this is in place: PRs get a CI check and (if `CLOUDFLARE_API_TOKEN`
is set) an automatic preview URL comment from `preview.yml`; merging to
`main` triggers `deploy.yml`, which applies any new migrations and
deploys both Workers.

## Order of operations

Get `apps/studio` deployed and Access-gated first (steps 1–7 above) so
the shell exists at studio.vizchitra.com before anything else. Then set
up steps 8–9 so future changes go through PRs instead of manual deploys.
Then bring up `services/media` and point the upload UI at its `/assets`
endpoint.
