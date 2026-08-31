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

🧑 Hand over three connection strings. **Keep `sslmode=verify-full`** — `require`
encrypts but authenticates nothing, so it stops eavesdropping and not
impersonation.

🤖 **Migrate**, once the strings exist:

```bash
DATABASE_URL=<production> npm run db:migrate
DATABASE_URL=<preview>    npm run db:migrate
TEST_DATABASE_URL=<tests> npm run db:migrate:test
```

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

🧑 **Create the project** in scope `sandler`, named `nftraffle`, linked to
`CryptoSandler/nftraffle`, production branch `main`. Framework auto-detects as
Next.js; no build overrides.

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
