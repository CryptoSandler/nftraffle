-- Admin access: revocable sessions and login throttling.
--
-- Adapted from the sibling projects, which answer three findings about an admin
-- token that behaved like a master secret: it sat in the cookie in clear, could
-- be guessed without limit or trace, and leaked its length through an
-- early-returning comparison. Two of those are schema, and they are here.
--
-- Read by `src/lib/admin.ts` and nothing else.
--
-- No admin_audit_log here. An append-only trail with nothing that reads it is a
-- table that grows forever and answers no question anybody asks; it arrives with
-- the surface that displays it, or not at all.

-- Sessions, so the cookie carries a revocable identifier instead of the secret
-- itself. Signing out, or a leaked cookie, is then a row change rather than a
-- redeploy with a new environment variable.
CREATE TABLE admin_sessions (
  id          TEXT PRIMARY KEY,
  token_label TEXT        NOT NULL,
  ip_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ
);

-- `resolveAdminSession` looks a session up by primary key and then filters on
-- these two, so this index is for the sweep that reaps dead rows rather than
-- for the hot path.
CREATE INDEX admin_sessions_live ON admin_sessions (expires_at, revoked_at);

-- Every attempt to authenticate, successful or not. Failures drive the
-- lockout; successes are kept because they end a failure streak, and because
-- "when did this token last work" is the first question asked when something
-- looks wrong.
--
-- ip_hash, never an address: the same salted-SHA-256 rule the rest of this
-- project follows (see src/lib/client-ip.ts). It is NOT NULL because a
-- caller whose address cannot be trusted is refused before an attempt is
-- recorded, rather than sharing one anonymous bucket with every other such
-- caller — a shared bucket here would let anybody lock the operator out.
CREATE TABLE admin_login_attempts (
  id           TEXT PRIMARY KEY,
  ip_hash      TEXT        NOT NULL,
  token_label  TEXT,
  succeeded    BOOLEAN     NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL
);

-- Matches checkAdminLoginGate's WHERE (ip_hash = $1 AND attempted_at > $2) and
-- its ORDER BY attempted_at DESC, in that column order: equality first, then
-- the range the scan walks backwards.
CREATE INDEX admin_login_attempts_ip
  ON admin_login_attempts (ip_hash, attempted_at DESC);
