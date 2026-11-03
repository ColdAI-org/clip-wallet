-- Settings sync (@clip-wallet/link). No accounts or emails: a "space" is hex SHA-256 of the device's Ed25519 sync
-- public key (derived from the recovery phrase in the vault). Records are opaque ids + ciphertext only.
CREATE TABLE sync_spaces (
  space TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sync_records (
  space TEXT NOT NULL,
  rid TEXT NOT NULL,
  seq INTEGER NOT NULL,
  ct TEXT NOT NULL,
  PRIMARY KEY (space, rid)
);
CREATE INDEX sync_records_seq ON sync_records (space, seq);

-- Replay protection: SHA-256 of each request nonce, kept for 11 minutes (requests older than 5 are refused anyway).
CREATE TABLE sync_nonces (
  space TEXT NOT NULL,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (space, nonce)
);
CREATE INDEX sync_nonces_expiry ON sync_nonces (expires_at);
