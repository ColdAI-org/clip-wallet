-- Accounts are keyed by HMAC-SHA256(EMAIL_PEPPER, normalised email): the database never holds an email address.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

-- One-time sign-in links. token_hash = SHA-256(token); challenge = base64url(SHA-256(verifier)) (PKCE S256).
CREATE TABLE magic_links (
  token_hash TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX magic_links_expiry ON magic_links (expires_at);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_account ON sessions (account);
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- Metadata only; the ciphertext lives in R2 under b/<id>.
CREATE TABLE backups (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  rp_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX backups_account ON backups (account);

-- Fixed-window counters. key is "<scope>:<SHA-256 of ip/account>".
CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  win INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, win)
);
