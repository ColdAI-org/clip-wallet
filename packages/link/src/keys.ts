/**
 * What @clip-wallet/link needs from the vault, restated structurally so this package never imports the vault
 * (harness: only the vault touches seeds and private keys). ClipVault satisfies `LinkVault`.
 */

/** ClipVault.syncKeys(): derived from the seed with label "clip/sync/v1". */
export interface SyncKeyHandle {
  publicKey: Uint8Array;
  space: string;
  dataKey: Uint8Array;
  idKey: Uint8Array;
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/** ClipVault.pairingKey(): an ephemeral X25519 key held by the vault. */
export interface PairingKeyHandle {
  id: string;
  publicKey: Uint8Array;
  agree(peerPublicKey: Uint8Array, transcriptHash: Uint8Array): Promise<Uint8Array>;
  destroy(): void;
}

export interface SealedBoxLike {
  nonce: string;
  ct: string;
}

export interface LinkVault {
  status(): Promise<"empty" | "locked" | "unlocked">;
  syncKeys(): Promise<SyncKeyHandle>;
  pairingKey(): PairingKeyHandle;
  exportToDevice(password: string, pairingId: string, peerPublicKey: Uint8Array, transcriptHash: Uint8Array): Promise<SealedBoxLike>;
  importFromDevice(pairingId: string, peerPublicKey: Uint8Array, transcriptHash: Uint8Array, box: SealedBoxLike, password: string): Promise<void>;
  /** Passkey-backup ciphertext instead of the phrase (optional path). */
  restorePasskeyBackup?(blob: Uint8Array, prfOutput: Uint8Array, password: string): Promise<void>;
}

/** Ed25519 verification for the sync server (Workers: crypto.subtle; tests/Node: @noble/curves ed25519.verify). */
export type VerifyFn = (publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array) => Promise<boolean> | boolean;
