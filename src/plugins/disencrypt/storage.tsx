import * as DataStore from "@api/DataStore";

export interface UserPreferences {
  [userId: string]: "yes" | "no" | "never";
}

export interface UserKeys {
  [userId: string]: {
    publicKey: string;
    encryptionEnabled: boolean;
  };
}

export interface MyKeys {
  privateKey: string;
  publicKey: string;
}

const STORAGE_KEY = "disencrypt_user_preferences";
const KEYS_STORAGE_KEY = "disencrypt_user_keys";
const MY_KEYS_STORAGE_KEY = "disencrypt_my_keys";

let store: {
  get: (key: string) => Promise<any>;
  set: (key: string, value: any) => Promise<void>;
};

export async function initStorage() {
  if (DataStore && typeof (DataStore as any).pluginStorage === "function") {
    store = (DataStore as any).pluginStorage("Disencrypt");
    console.log("[Disencrypt] Using pluginStorage scope");
  } else {
    // Fallback to global DataStore
    store = DataStore;
    console.log("[Disencrypt] Using global DataStore");
  }
}

export async function getUserPreferences(): Promise<UserPreferences> {
  try {
    const stored = await store.get(STORAGE_KEY);
    if (!stored) return {};
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    return parsed || {};
  } catch (e) {
    console.error("[Disencrypt] Failed to get preferences:", e);
    return {};
  }
}

export async function saveUserPreference(
  userId: string,
  preference: "yes" | "no" | "never"
) {
  try {
    const prefs = await getUserPreferences();
    prefs[userId] = preference;
    await store.set(STORAGE_KEY, prefs);
    console.log(`[Disencrypt] Saved preference for ${userId}: ${preference}`);
  } catch (e) {
    console.error("[Disencrypt] Failed to save preference:", e);
  }
}

export async function getUserPreference(
  userId: string
): Promise<"yes" | "no" | "never" | undefined> {
  const prefs = await getUserPreferences();
  return prefs[userId];
}

export async function getMyKeys(): Promise<MyKeys | null> {
  try {
    const stored = await store.get(MY_KEYS_STORAGE_KEY);
    if (!stored) return null;
    return typeof stored === "string" ? JSON.parse(stored) : stored;
  } catch (e) {
    console.error("[Disencrypt] Failed to get my keys:", e);
    return null;
  }
}

export async function saveMyKeys(keys: MyKeys) {
  try {
    await store.set(MY_KEYS_STORAGE_KEY, keys);
    console.log("[Disencrypt] Saved my keys");
  } catch (e) {
    console.error("[Disencrypt] Failed to save my keys:", e);
  }
}

export async function getUserKeys(): Promise<UserKeys> {
  try {
    const stored = await store.get(KEYS_STORAGE_KEY);
    if (!stored) return {};
    return typeof stored === "string" ? JSON.parse(stored) : stored;
  } catch (e) {
    console.error("[Disencrypt] Failed to get user keys:", e);
    return {};
  }
}

export async function saveUserKey(userId: string, publicKey: string) {
  try {
    const keys = await getUserKeys();
    keys[userId] = { publicKey, encryptionEnabled: true };
    await store.set(KEYS_STORAGE_KEY, keys);
    console.log(`[Disencrypt] Saved public key for ${userId}`);
  } catch (e) {
    console.error("[Disencrypt] Failed to save user key:", e);
  }
}

export async function disableUserEncryption(userId: string) {
  try {
    const keys = await getUserKeys();
    if (keys[userId]) {
      keys[userId].encryptionEnabled = false;
      await store.set(KEYS_STORAGE_KEY, keys);
      console.log(`[Disencrypt] Disabled encryption for ${userId}`);
    }
  } catch (e) {
    console.error("[Disencrypt] Failed to disable encryption:", e);
  }
}