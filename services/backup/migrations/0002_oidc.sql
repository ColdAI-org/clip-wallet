-- Social sign-in (Google / Apple, OpenID Connect). One row per sign-in attempt, for at most 10 minutes.
-- state_hash = SHA-256(state); challenge = base64url(SHA-256(device verifier)) and is also the ID token nonce.
-- pkce_verifier is the Worker's own PKCE verifier for the provider leg (Google); it is useless without the code.
-- account is HMAC(EMAIL_PEPPER, "<provider>:<sub>") once the provider vouched for the user; never the email.
CREATE TABLE oidc_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  challenge TEXT NOT NULL,
  pkce_verifier TEXT,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  account TEXT,
  handoff_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX oidc_states_expiry ON oidc_states (expires_at);
