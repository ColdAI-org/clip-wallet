/**
 * Where things live on the phone:
 *   - the vault record (Argon2id-sealed ciphertext + public metadata): expo-secure-store, i.e. the iOS
 *     Keychain (kSecAttrAccessibleWhenUnlockedThisDeviceOnly: never in backups, never migrates) and the
 *     Android Keystore-encrypted SharedPreferences. Defence in depth: it is already encrypted by the vault.
 *   - app data (prefs, permissions, activity, public accounts): AsyncStorage, through the engine's JsonKV.
 */
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { VaultStorage } from "@clip-wallet/vault";
import { JsonKV, type KV } from "@clip-wallet/engine";
import { APP } from "../env";

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  // "<rdns>.vault" (Clip Wallet: org.coldai.clipwallet.vault): each wallet keeps its own Keychain service.
  keychainService: `${APP.config.rdns}.vault`,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** SecureStore keys allow only [A-Za-z0-9._-]; the vault uses "clip-wallet/vault/v1". */
export function secureKey(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, ".");
}

export function secureVaultStorage(store: Pick<typeof SecureStore, "getItemAsync" | "setItemAsync" | "deleteItemAsync"> = SecureStore): VaultStorage {
  return {
    get: async (k) => (await store.getItemAsync(secureKey(k), SECURE_OPTS)) ?? undefined,
    set: (k, v) => store.setItemAsync(secureKey(k), v, SECURE_OPTS),
    remove: (k) => store.deleteItemAsync(secureKey(k), SECURE_OPTS),
  };
}

export function appKV(): KV {
  return new JsonKV(AsyncStorage, "clip-wallet:");
}
