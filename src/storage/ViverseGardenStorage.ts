import type { AuthSession } from "../auth/AuthService";

interface CloudSaveClient {
  getPlayerData(key: string, token: string): Promise<unknown | null>;
  setPlayerData(key: string, data: unknown, token: string): Promise<void>;
}

type CloudSaveConstructor = new (appId: string) => CloudSaveClient;

interface StorageNamespace {
  CloudSaveClient?: CloudSaveConstructor;
}

const SDK_URL = "https://www.viverse.com/static-assets/storage-sdk/1.0.0/storage-sdk.umd.js";
const SAVE_KEY = "nurture_garden_v1";

const legacySaveKeyForAccount = (accountId: string) => {
  const normalized = accountId.trim();
  return /^[a-z0-9_-]{1,128}$/i.test(normalized)
    ? `${SAVE_KEY}_${normalized}`
    : null;
};

const saveKeyForAccount = async (accountId: string) => {
  const normalized = accountId.trim();
  if (!normalized) throw new Error("VIVERSE account ID is unavailable.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  const suffix = [...new Uint8Array(digest).slice(0, 12)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `ngv1_${suffix}`;
};

const isOwnedByAccount = (data: unknown, accountId: string) =>
  Boolean(
    data &&
    typeof data === "object" &&
    (data as { ownerId?: unknown }).ownerId === accountId,
  );

export class ViverseGardenStorage {
  private clients = new Map<string, CloudSaveClient>();
  private sdkPromise: Promise<StorageNamespace> | null = null;

  async load(session: AuthSession): Promise<unknown | null> {
    const client = await this.clientFor(session);
    const accountKey = await saveKeyForAccount(session.user.id);
    const accountSave = await client.getPlayerData(accountKey, session.accessToken!);
    if (accountSave != null) {
      return isOwnedByAccount(accountSave, session.user.id) ? accountSave : null;
    }

    const legacyKeys = [legacySaveKeyForAccount(session.user.id), SAVE_KEY].filter(
      (key): key is string => Boolean(key),
    );
    for (const legacyKey of legacyKeys) {
      const legacySave = await client.getPlayerData(legacyKey, session.accessToken!);
      if (!isOwnedByAccount(legacySave, session.user.id)) continue;
      await client.setPlayerData(accountKey, legacySave, session.accessToken!);
      return legacySave;
    }
    return null;
  }

  async save(session: AuthSession, data: unknown): Promise<void> {
    if (!isOwnedByAccount(data, session.user.id)) {
      throw new Error("Cloud Save owner does not match the active VIVERSE account.");
    }
    const client = await this.clientFor(session);
    await client.setPlayerData(await saveKeyForAccount(session.user.id), data, session.accessToken!);
  }

  private async clientFor(session: AuthSession): Promise<CloudSaveClient> {
    if (!session.accessToken || !session.appId) {
      throw new Error("VIVERSE Cloud Save requires an authenticated account.");
    }
    const clientKey = `${session.appId}:${session.user.id}`;
    const existing = this.clients.get(clientKey);
    if (existing) return existing;
    const storage = await this.loadSdk();
    if (typeof storage.CloudSaveClient !== "function") {
      throw new Error("VIVERSE CloudSaveClient is unavailable.");
    }
    const client = new storage.CloudSaveClient(session.appId);
    this.clients.set(clientKey, client);
    return client;
  }

  private currentSdk(): StorageNamespace | undefined {
    return (globalThis as typeof globalThis & { storage?: StorageNamespace }).storage;
  }

  private async loadSdk(): Promise<StorageNamespace> {
    const current = this.currentSdk();
    if (current?.CloudSaveClient) return current;
    if (this.sdkPromise) return this.sdkPromise;
    this.sdkPromise = new Promise<StorageNamespace>((resolve, reject) => {
      const finish = () => {
        const loaded = this.currentSdk();
        if (loaded?.CloudSaveClient) resolve(loaded);
        else reject(new Error("VIVERSE Storage SDK is unavailable."));
      };
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
      if (existing) {
        existing.addEventListener("load", finish, { once: true });
        existing.addEventListener("error", () => reject(new Error("VIVERSE Storage SDK failed to load.")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = finish;
      script.onerror = () => reject(new Error("VIVERSE Storage SDK failed to load."));
      document.head.append(script);
    }).finally(() => {
      this.sdkPromise = null;
    });
    return this.sdkPromise;
  }
}
