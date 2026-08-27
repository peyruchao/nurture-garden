import type { AvatarProvider } from "../avatar/AvatarProvider";
import type { AvatarData } from "../models/types";
import type { AuthService, AuthSession } from "./AuthService";

interface ViverseAuthResult {
  access_token: string;
  account_id: string;
  expires_in: number;
}

type ViverseProfile = Record<string, unknown> & {
  activeAvatar?: Record<string, unknown> | null;
};

interface ViverseClient {
  checkAuth(): Promise<ViverseAuthResult | undefined>;
  getToken?(): Promise<string | undefined>;
  loginWithWorlds(options?: { state?: string }): void;
  logout?(): Promise<void>;
  getUserInfo?(): Promise<ViverseProfile>;
  getUser?(): Promise<ViverseProfile>;
  getProfileByToken?(token: string): Promise<ViverseProfile>;
}

interface ViverseAvatarClient {
  getProfile(): Promise<ViverseProfile>;
  getAvatarFileWithSDK?(url: string): Promise<ArrayBuffer>;
}

type ClientConstructor = new (options: {
  clientId: string;
  domain: string;
  cookieDomain?: string;
}) => ViverseClient;

type AvatarConstructor = new (options: {
  baseURL: string;
  accessToken?: string;
  token?: string;
  authorization?: string;
  appId?: string;
  clientId?: string;
}) => ViverseAvatarClient;

interface ViverseNamespace {
  client?: ClientConstructor;
  Client?: ClientConstructor;
  avatar?: AvatarConstructor;
  Avatar?: AvatarConstructor;
  bridge?: { isReady?: boolean };
}

const MODE_KEY = "art-of-my-life:auth-mode:v1";
const SDK_URL = "https://www.viverse.com/static-assets/viverse-sdk/index.umd.cjs";
const VERSION_NAME = "nurture-garden-viverse-auth-2026.08.19";
const HANDSHAKE_DELAY_MS = 1200;
const PROFILE_LOOKUP_TIMEOUT_MS = 8000;

const demoGuest: AuthSession = {
  mode: "guest",
  user: { id: "peggy", displayName: "Peggy" },
  avatar: {
    userId: "peggy",
    displayName: "Peggy",
    avatarUrl: "",
    palette: ["#efb7a9", "#894f75"],
    source: "guest",
  },
};

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

const withTimeout = <T>(promise: Promise<T>, milliseconds: number, message: string) =>
  new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), milliseconds);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });

const nonEmptyString = (...values: unknown[]) =>
  values.find((value): value is string =>
    typeof value === "string" && value.trim().length > 0,
  )?.trim();

const mergeProfile = (
  current: ViverseProfile | null,
  incoming: unknown,
): ViverseProfile | null => {
  if (!incoming || typeof incoming !== "object") return current;
  return { ...(current ?? {}), ...(incoming as ViverseProfile) };
};

export class ViverseAuthService implements AuthService, AvatarProvider {
  private session: AuthSession | null = null;
  private client: ViverseClient | null = null;
  private avatarClient: ViverseAvatarClient | null = null;
  private restorePromise: Promise<AuthSession | null> | null = null;
  private readonly mockAvatars: Record<string, AvatarData> = {
    peggy: demoGuest.avatar,
    michelle: { userId: "michelle", displayName: "Michelle", avatarUrl: "", palette: ["#d8b9ef", "#665ca8"], source: "guest" },
    david: { userId: "david", displayName: "David", avatarUrl: "", palette: ["#9ecac5", "#3f7384"], source: "guest" },
  };

  constructor() {
    console.info(`[NurtureGarden] VIVERSE auth ${VERSION_NAME}`);
  }

  resolveAppId(): string | null {
    const hostnameMatch = location.hostname.match(
      /^([a-z0-9]+)(?:-preview)?\.world\.viverse\.app$/i,
    );
    const hostnameAppId = hostnameMatch?.[1];
    const queryAppId = new URLSearchParams(location.search).get("appId");
    const envAppId =
      import.meta.env.VITE_VIVERSE_CLIENT_ID ||
      import.meta.env.VITE_VIVERSE_APP_ID;
    const candidate = hostnameAppId || envAppId || queryAppId;
    if (!candidate || !/^[a-z0-9_-]{6,64}$/i.test(candidate)) return null;
    if (hostnameAppId && envAppId && hostnameAppId !== envAppId) {
      console.warn("[NurtureGarden] VIVERSE App ID mismatch; using Worlds hostname App ID.");
    }
    return candidate;
  }

  isViverseConfigured(): boolean {
    return Boolean(this.resolveAppId());
  }

  getSession(): AuthSession | null {
    return this.session;
  }

  async restoreSession(): Promise<AuthSession | null> {
    if (this.session?.mode === "viverse") return this.session;
    if (this.restorePromise) return this.restorePromise;
    this.restorePromise = this.restoreViverseSession().finally(() => {
      this.restorePromise = null;
    });
    return this.restorePromise;
  }

  async refreshViverseSession(): Promise<AuthSession | null> {
    this.session = null;
    this.restorePromise = null;
    return this.restoreViverseSession();
  }

  async signInAsGuest(): Promise<AuthSession> {
    localStorage.setItem(MODE_KEY, "guest");
    this.session = demoGuest;
    return this.session;
  }

  async signInWithViverse(): Promise<AuthSession | null> {
    const appId = this.resolveAppId();
    if (!appId) {
      throw new Error("VIVERSE App ID is unavailable outside a configured VIVERSE World.");
    }
    localStorage.setItem(MODE_KEY, "viverse");
    const restored = await this.restoreSession();
    if (restored) return restored;
    if (!this.client) await this.initializeClient(appId);
    this.client?.loginWithWorlds({ state: location.href });
    return null;
  }

  async signOut(): Promise<void> {
    try {
      await this.client?.logout?.();
    } catch (error) {
      console.warn("[NurtureGarden] VIVERSE logout did not complete cleanly.", error);
    }
    localStorage.removeItem(MODE_KEY);
    this.session = null;
    this.client = null;
    this.avatarClient = null;
  }

  async getCurrentUserAvatar(): Promise<AvatarData> {
    if (!this.session) throw new Error("Sign in to load an avatar.");
    return this.session.avatar;
  }

  async getUserAvatar(userId: string): Promise<AvatarData> {
    if (this.session?.user.id === userId) return this.session.avatar;
    return this.mockAvatars[userId] ?? {
      userId,
      displayName: "Memory Keeper",
      avatarUrl: "",
      palette: ["#f0cf91", "#916b6a"],
      source: "guest",
    };
  }

  private async restoreViverseSession(): Promise<AuthSession | null> {
    const appId = this.resolveAppId();
    if (!appId) {
      console.info("[NurtureGarden] No VIVERSE App ID detected; continuing as guest.");
      return null;
    }
    const sdk = await this.loadSdk();
    await this.waitForBridge(sdk);
    await delay(HANDSHAKE_DELAY_MS);
    await this.initializeClient(appId, sdk);

    let auth: ViverseAuthResult | undefined;
    for (let attempt = 0; attempt < 3 && !auth; attempt += 1) {
      auth = await this.client?.checkAuth();
      if (!auth && attempt < 2) await delay(1000);
    }
    if (!auth?.access_token || !auth.account_id) {
      console.warn(`[NurtureGarden] VIVERSE SSO unavailable for App ID ${appId}.`);
      return null;
    }

    const token = auth.access_token || await this.client?.getToken?.() || "";
    let profile: ViverseProfile | null = null;
    try {
      profile = await withTimeout(
        this.fetchProfile(sdk, appId, token),
        PROFILE_LOOKUP_TIMEOUT_MS,
        "VIVERSE profile lookup timed out.",
      );
    } catch (error) {
      console.warn("[NurtureGarden] VIVERSE profile lookup was skipped.", error);
    }
    const displayName = nonEmptyString(
      profile?.displayName,
      profile?.display_name,
      profile?.name,
      profile?.nickName,
      profile?.nickname,
      profile?.userName,
      profile?.email,
    ) || "VIVERSE Player";
    const activeAvatar = profile?.activeAvatar && typeof profile.activeAvatar === "object"
      ? profile.activeAvatar
      : null;
    const headIconUrl = nonEmptyString(
      activeAvatar?.headIconUrl,
      activeAvatar?.head_icon_url,
      activeAvatar?.snapshot,
      profile?.headIconUrl,
      profile?.head_icon_url,
      profile?.avatarUrl,
      profile?.avatar_url,
      profile?.profilePicUrl,
    ) || "";
    const colorSeed = [...auth.account_id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const hues = [colorSeed % 360, (colorSeed + 72) % 360];
    const avatar: AvatarData = {
      userId: auth.account_id,
      displayName,
      avatarUrl: "",
      headIconUrl,
      palette: [`hsl(${hues[0]} 45% 72%)`, `hsl(${hues[1]} 38% 42%)`],
      source: "viverse",
    };
    this.session = {
      mode: "viverse",
      user: { id: auth.account_id, displayName },
      avatar,
      accessToken: token,
      appId,
      expiresAt: Date.now() + Math.max(0, auth.expires_in || 0) * 1000,
    };
    localStorage.setItem(MODE_KEY, "viverse");
    console.info(`[NurtureGarden] VIVERSE SSO ready for ${displayName}.`);
    return this.session;
  }

  private async initializeClient(appId: string, sdk?: ViverseNamespace) {
    if (this.client) return;
    const namespace = sdk ?? await this.loadSdk();
    const Client = namespace.client ?? namespace.Client;
    if (typeof Client !== "function") throw new Error("VIVERSE client constructor is unavailable.");
    this.client = new Client({ clientId: appId, domain: "account.htcvive.com" });
  }

  private async fetchProfile(
    sdk: ViverseNamespace,
    appId: string,
    token: string,
  ): Promise<ViverseProfile | null> {
    let profile: ViverseProfile | null = null;
    const Avatar = sdk.avatar ?? sdk.Avatar;
    if (typeof Avatar === "function") {
      try {
        this.avatarClient = new Avatar({
          baseURL: "https://sdk-api.viverse.com/",
          accessToken: token,
          token,
          authorization: token,
          appId,
          clientId: appId,
        });
        profile = mergeProfile(profile, await this.avatarClient.getProfile());
      } catch (error) {
        console.warn("[NurtureGarden] Avatar profile strategy was unavailable.", error);
      }
    }
    const hasIdentity = () => Boolean(nonEmptyString(
      profile?.displayName,
      profile?.display_name,
      profile?.name,
      profile?.nickname,
      profile?.userName,
      profile?.email,
    ));
    const hasAvatar = () => Boolean(
      profile?.activeAvatar ||
      nonEmptyString(profile?.avatarUrl, profile?.avatar_url, profile?.profilePicUrl),
    );
    const strategies: Array<(() => Promise<ViverseProfile>) | undefined> = [
      this.client?.getUserInfo?.bind(this.client),
      this.client?.getUser?.bind(this.client),
      this.client?.getProfileByToken
        ? () => this.client!.getProfileByToken!(token)
        : undefined,
    ];
    for (const strategy of strategies) {
      if (!strategy || (hasIdentity() && hasAvatar())) continue;
      try {
        profile = mergeProfile(profile, await strategy());
      } catch (error) {
        console.warn("[NurtureGarden] VIVERSE profile fallback was unavailable.", error);
      }
    }
    if (!hasIdentity() || !hasAvatar()) {
      try {
        const response = await fetch("https://account-profile.htcvive.com/SS/Profiles/v3/Me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) profile = mergeProfile(profile, await response.json());
      } catch (error) {
        console.warn("[NurtureGarden] Direct VIVERSE profile fallback was unavailable.", error);
      }
    }
    return profile;
  }

  private async waitForBridge(sdk: ViverseNamespace) {
    if (!sdk.bridge || sdk.bridge.isReady !== false) return;
    for (let attempt = 0; attempt < 20 && sdk.bridge.isReady === false; attempt += 1) {
      await delay(100);
    }
    if (sdk.bridge.isReady === false) await delay(500);
  }

  private currentSdk(): ViverseNamespace | undefined {
    const scope = globalThis as typeof globalThis & {
      viverse?: ViverseNamespace;
      VIVERSE_SDK?: ViverseNamespace;
      vSdk?: ViverseNamespace;
    };
    return scope.viverse ?? scope.VIVERSE_SDK ?? scope.vSdk;
  }

  private async loadSdk(): Promise<ViverseNamespace> {
    const current = this.currentSdk();
    if (current?.client || current?.Client) return current;
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
      if (existing) {
        if (this.currentSdk()) resolve();
        else {
          existing.addEventListener("load", () => resolve(), { once: true });
          existing.addEventListener("error", () => reject(new Error("VIVERSE SDK failed to load.")), { once: true });
        }
        return;
      }
      const script = document.createElement("script");
      script.src = SDK_URL;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("VIVERSE SDK failed to load."));
      document.head.append(script);
    });
    const loaded = this.currentSdk();
    if (!loaded?.client && !loaded?.Client) throw new Error("VIVERSE SDK is unavailable.");
    return loaded;
  }
}
