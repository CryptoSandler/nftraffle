# Deploy

Vercel, scope `sandler`. Neon for Postgres. Nothing here is done yet — this is
the checklist for when the owner's pieces exist.

**Two markers throughout:**

- 🧑 **Cowork** — only doable in a web panel. The owner does it.
- 🤖 **CLI/API** — I do it once the account and project exist.

---

## 1. Neon 🧑 then 🤖

🧑 **Create the project.** Region closest to the Vercel region. Three branches,
matching pixelwar:

| Branch | Used by | Notes |
|---|---|---|
| `production` | Vercel Production | The real one. |
| `preview` | Vercel Preview | Its own data. A preview deploy must never write to production. |
| `tests` | the suite | Truncated between tests. |

🧑 Hand over three connection strings, written into `.env.local` by `neonctl`
rather than pasted — a value that is never displayed is a value that cannot end
up in a log or a screenshot.

**`production` and `preview` use `sslmode=verify-full`.** libpq's `require`
encrypts and authenticates nothing, so it stops eavesdropping and not
impersonation.

**`tests` uses `sslmode=require`, and there is a live caveat.** `pg` 8.23 emits:

> SECURITY WARNING: the SSL modes `prefer`, `require` and `verify-ca` are
> treated as aliases for `verify-full`. In the next major version these modes
> will adopt standard libpq semantics, which have weaker security guarantees.

So `require` is currently *stricter* than it reads, and a future `pg` major will
silently make it weaker. The stake is low — that branch holds disposable
fixtures and is truncated between tests — but it is the kind of change that
arrives in a patch bump and tells nobody. **On upgrading past `pg` 8.x, either
move `tests` to `verify-full` or accept the downgrade deliberately.**

🤖 **Migrate**, once the strings exist:

```bash
npm run db:migrate:test      # tests   — and only this one writes the stamp
npm run db:migrate:preview   # preview
npm run db:migrate           # production, which is `--prod` spelled out
```

**Each target must be named; there is no default.** `db:migrate` used to migrate
`DATABASE_URL` whenever `--test` was absent, so a bare invocation — or a typo'd
flag — pointed at production. That was survivable while `DATABASE_URL` meant a
container on a laptop and is not now that it means Neon's `production` branch.
Every run prints which variable and which `ep-*` host it is about to change,
before it changes it.

**Only the third stamps `disposable_database`.** That stamp is written by
`db:migrate:test` and deliberately not by a migration, so production can never
carry it — it marks an environment, not a schema. Moving it into `migrations/`
is the one edit to refuse.

🤖 **Verify what landed:**

```sql
SELECT version FROM schema_migrations ORDER BY version;
-- expect 000_bootstrap … 004_multichain on all three
SELECT to_regclass('public.disposable_database');
-- expect NULL on production and preview, non-NULL on tests
```

That last query is the one worth running. A non-NULL on production means the
suite could truncate it.

---

## 2. Vercel 🧑 then 🤖

**🧑 THIS STEP IS PANEL-ONLY FOR A REASON THAT IS NOT ABOUT VERCEL'S UI.** The
Vercel CLI on this machine authenticates as `federicopanno`, whose only team is
`tenedor`. The `sandler` scope is invisible to it — `vercel project ls --scope
team_ceVZFNa9CxI1UDKOXoBMx2Z1` (the team pixelwar lives in) answers *"The
specified scope does not exist"*, and `GET /v2/teams` returns `tenedor` alone.
That is a different account, not a missing permission, so nothing on the CLI
side can create this project.

**Creating it under `tenedor` instead would be the wrong answer**, not a
shortcut: it would put a public-facing money surface in the wrong org and make
the eventual move a migration.

🧑 **Create the project** in scope `sandler`, named `nftraffle`, linked to
`CryptoSandler/nftraffle`, production branch `main`. Framework auto-detects as
Next.js; no build overrides.

🧑 Then either log the CLI into that account (`vercel login`) or issue a token
scoped to it, and everything below becomes 🤖.

### What exists now (created 2026-08-31)

| | |
|---|---|
| Project | `nftraffle` in `sandler` — `prj_pNiJc5mAScwFqm4QssdR4OJ3zfBa` |
| Production | **https://nftraffle.vercel.app** |
| Git link | **NOT linked** — see below |

**🧑 The GitHub link is the one thing still outstanding, and it is a GitHub-side
grant rather than a Vercel one.** The Vercel GitHub App is installed on this team
(pixelwar is linked through it) but has no access to the `nftraffle` repository,
so both `POST /v11/projects` with a `gitRepository` and `POST /v9/projects/…/link`
answer *"you need to install the GitHub integration first… make sure you have
access to the repository"*.

Until it is granted, deploys are CLI-only (`vercel deploy [--prod]`), which works
— production and preview were both deployed that way. What is missing is
auto-deploy on push and PR preview URLs.

> **Cowork prompt.** Open **https://github.com/settings/installations** (or the
> CryptoSandler org's Settings → GitHub Apps), find **Vercel**, choose
> *Configure*, and under *Repository access* add **CryptoSandler/nftraffle**.
> Then tell me and I will link it with one API call.

### Preview deployments are SSO-protected, and that blocks automated checks

`ssoProtection` is `all_except_custom_domains`, so the production alias answers
publicly while a preview URL returns **302 with a 15-byte body**. That is exactly
the failure §6 warns about: an empty result reads like a clean check.

Vercel's *Protection Bypass for Automation* is the right tool — it keeps SSO on
for people while letting a script through with an `x-vercel-protection-bypass`
header. **It is not available on this plan**: `POST /v1/projects/…/protection-bypass`
answers `404`, and the field is rejected on the project PATCH.

**Do not turn `ssoProtection` off to work around this.** Previews would become
publicly reachable, and this is a pre-launch project.

**This is the owner's decision, not an inherited default** — put to them and
answered on 2026-08-31, recorded as `docs/decisions.md` Q16 with what it gives
up and what would make it worth reversing. Reverse it there, not here.

**So the devnet rehearsal runs locally, by design, until the plan has Protection
Bypass for Automation.** That is option 3 below, and it is not a compromise worth
apologising for: the local server runs the same production build, against the
same Neon `preview` branch, the same Helius devnet RPC and the same devnet
wallets that Vercel Preview holds. What it does not exercise is Vercel's edge —
the CDN, the platform headers and `x-vercel-forwarded-for` — and nothing the
rehearsal checks depends on those.

```bash
# .env.rehearsal mirrors the Vercel Preview environment exactly.
# VERCEL_ENV=preview is what makes paymentSafety admit devnet.
set -a; . /tmp/rehearsal.env.sh; set +a
npm run build && npm run start
```

Two traps, both hit while doing this:

- **`.env.local` wins over a shell export for `next start`.** Park it for the
  run and restore it after, or the server comes up on production's database with
  no money variables and every surface reads "not open" — which looks exactly
  like a configuration bug in the rehearsal env.
- **Kill the old server by PID, not by pattern.** A leftover process holding
  `:3000` makes the new one fail with `EADDRINUSE` while `curl` happily answers
  from the old one. `lsof -ti :3000` and kill those.

The options, in order:

1. Enable Protection Bypass for Automation in the dashboard, if the plan allows.
2. Run preview checks from a browser session that is signed in.
3. **Current approach** — the local mirror described above.

🧑 **Root Directory:** repository root. **No `vercel.json` is needed** — this
project has no crons, unlike pixelwar.

🤖 Everything after that: `vercel env add`, `vercel deploy`, `vercel inspect`.

---

## 3. Environment variables

**Secrets are per environment, never shared**, the same shape pixelwar uses. A
preview deploy leaking its salt must not compromise production, and a preview
database with production's admin token is a production admin surface on a URL
nobody is watching.

Legend: **P** = Production, **V** = Preview.

### Always different between P and V

| Variable | P | V | How |
|---|---|---|---|
| `DATABASE_URL` | Neon `production` | Neon `preview` | 🤖 |
| `RATE_LIMIT_SALT` | own | own | 🤖 `openssl rand -hex 32`, twice |
| `ADMIN_TOKEN` | own | own | 🤖 `openssl rand -hex 32`, twice |

**`ADMIN_TOKEN` unset means no admin surface at all** — not an open one. Clearing
it is also the emergency stop: it kills every live session, because every path
that turns a cookie into an identity checks `adminConfigured()` first.

### Same in both

| Variable | Value | How |
|---|---|---|
| `TRUSTED_PLATFORM_HEADER` | `x-vercel-forwarded-for` | 🤖 |
| `TRUSTED_PROXY_HOPS` | `1` | 🤖 (Vercel's default; the header is read from the right) |
| `SOLANA_RPC_URL` | Helius **mainnet**, DAS enabled | 🤖 once the key exists |

**`ALLOW_UNTRUSTED_CLIENT_IP` is never set on Vercel.** Local development only.
Without a trusted address the rate limiter fails closed, which is correct; with
that flag every caller shares one bucket, which is not a limit.

### The money variables — production only, at first

Leave these **unset in Preview**. An unset variable closes its surface with its
own screen and charges nothing, which is exactly what a preview should do.

| Variable | Value | How |
|---|---|---|
| `PAYMENT_WALLET_SOLANA` | receives fees and ticket money | 🤖 |
| `ESCROW_WALLET_SOLANA` | holds prizes; **new and exclusive** | 🤖 |
| `RAFFLE_LISTING_FEE_SOLANA` | e.g. `0.05` | 🤖 |
| `HOUSE_FEE_BPS_SOLANA` | e.g. `500` | 🤖 |
| `LAUNCH_FEE_SOLANA` | e.g. `0.5` | 🤖 |
| `MINT_FEE_BPS_SOLANA` | e.g. `300` | 🤖 |

**No fee has a default anywhere.** A missing one closes its surface rather than
charging a guess — a number in copy that nothing enforces is the defect
DESIGN.md §8.2 exists to prevent. Zero is a *configured* value: it makes the fee
free, it does not close the surface.

### Preview's devnet wallets — disposable, and replaced at mainnet

Preview exists to rehearse. It gets a **devnet RPC and throwaway devnet
wallets**, so the buy panel can be exercised end to end without real money —
`paymentSafety` admits devnet only when `VERCEL_ENV !== production`, and the
page says so in a banner.

| Variable (Preview only) | Value |
|---|---|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` (public devnet serves DAS) |
| `PAYMENT_WALLET_SOLANA` | `6eyg2zyaHX4FXGJLD1nsnmmjexH9vif2veyXt1MbNpYa` |
| `ESCROW_WALLET_SOLANA` | `FbXES1esmvNemD7ia9VBxiwqqHc7aPjmAaiFZ9FTgRjT` |

Generated with `solana-keygen` into
`~/.config/solana/nftraffle-devnet/`. **They are devnet keypairs on a
developer's machine and hold nothing.** Public addresses only appear here; the
keys never leave that directory and never enter any deployment.

**THESE ARE NEVER SET IN PRODUCTION, and they are replaced — not promoted — when
mainnet arrives.** A devnet address is a perfectly valid mainnet address that
nobody has the key to on mainnet, so a copied value would collect real SOL into
a wallet that cannot spend it. Production's two wallets are new, exclusive, and
generated separately; see `docs/first-raffle.md` A1–A2.

Production stays with **no RPC and no wallets** until those exist. That is not a
gap: every money surface closes itself with its own screen and charges nothing,
which is exactly what a deployment that cannot yet take money should do.

### Robinhood Chain — leave every one unset

`ROBINHOOD_RPC_URL`, `PAYMENT_WALLET_ROBINHOOD`, `ESCROW_WALLET_ROBINHOOD` and
its four fees. **Setting them does not open that chain** — `OPEN_CHAINS` in
`src/lib/surfaces.ts` does, and a test asserts the chain stays closed with all of
them set. Configuration and permission are deliberately different things.

### Deferred until the domain exists

| Variable | Why it waits |
|---|---|
| `SITE_URL` | The cross-site guard falls back to the request's `Host`, which is correct on Vercel. Set it when there is a real hostname. |
| `SUPPORT_CONTACT` | `support@` on our own domain (decisions.md Q6). Empty until the domain exists — a placeholder address printed to somebody whose money is missing is worse than none. |

---

## 4. The triple noindex — do not remove any of it yet

Verified present on `main` today. Three layers because they fail in different
places and no single one covers a crawler's whole path:

| Layer | File | Covers |
|---|---|---|
| `robots.txt` `Disallow: /` | `src/app/robots.ts` | asks a well-behaved crawler not to fetch |
| `<meta name="robots">` | `src/app/layout.tsx` | a crawler that fetched anyway — HTML only |
| `X-Robots-Tag` header | `next.config.ts` | **every response, including `/api/*` JSON**, which the other two cannot reach |

🤖 **Verify after the first deploy:**

```bash
curl -s https://<deployment>/robots.txt
curl -sI https://<deployment>/ | grep -i x-robots-tag
curl -sI -X POST https://<deployment>/api/rpc | grep -i x-robots-tag   # the JSON route
curl -s https://<deployment>/ | grep -o '<meta name="robots"[^>]*>'
```

All four must answer. The third is the one worth running: it is the only layer
that reaches a route with no `<head>`.

**At launch, remove all three together**, or the site stays invisible while
looking open. `docs/operations.md` has the same list.

## 5. Security headers 🤖

```bash
curl -sI https://<deployment>/ | grep -iE \
  'content-security-policy|strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy'
```

`connect-src 'self'` is load-bearing: the browser reaches Solana only through
`/api/rpc`, which is what keeps the provider key server-side. Widening it would
undo that.

## 6. First deploy 🤖

```bash
vercel link --scope sandler
vercel deploy                 # preview first
vercel deploy --prod          # only after preview is checked
```

**Check on the preview before promoting:** the home page renders, `/launch` and
`/raffle/new` show their closed screens (Preview has no money variables), `/admin`
shows a sign-in form, and the four noindex checks pass.

🧑 **Preview deployments are behind Vercel SSO by default.** Leave that on — this
site is pre-launch. It does mean an unauthenticated `curl` of a preview URL gets
a login redirect, so run the checks with a bypass token or against production.
An empty result from a redirect reads exactly like a clean check that found
nothing.

---

## 7. What is deliberately not automated

- **Anything that moves money.** No deploy step touches a wallet, and no
  environment variable is a private key. Payouts are manual by design.
- **Opening the Robinhood surface.** A code change plus three prerequisites in
  `docs/operations.md`, not a config toggle.
- **Removing the noindex.** Three files, one commit, deliberately.
