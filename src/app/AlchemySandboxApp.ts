// The sandbox remains deliberately script-driven so the approved mockup can be
// promoted to the production shell without its simulation behavior drifting.
import sandboxFragment from "../alchemy-sandbox-fragment.html?raw";
import { ViverseAuthService } from "../auth/ViverseAuthService";
import {
  createArrangementViewer,
  createFlowerViewer,
  createGiftCardViewer,
  createReceivedGiftViewer,
  preloadFlowerModels,
} from "../render/FlowerModelViewer";
import { PolygonArrangementPublisher } from "../polygonStreaming/PolygonArrangementPublisher";
import { ViverseGardenStorage } from "../storage/ViverseGardenStorage";

const assetUrl = (fileName: string) =>
  `${import.meta.env.BASE_URL}assets/flowers/${fileName}`;
const collectibleAssetUrl = (fileName: string) =>
  `${import.meta.env.BASE_URL}assets/collectibles/${fileName}`;

// Local guest mode: development-only shortcut so the garden can be tested on
// localhost without a VIVERSE session. Enabled with `?guest=1` in the URL or
// VITE_LOCAL_GUEST=true in .env.local, and never in production builds.
const GUEST_SAVE_KEY = "nurture-garden:local-guest-save:v1";
const localGuestEnabled = () =>
  import.meta.env.DEV &&
  (new URLSearchParams(location.search).has("guest") || import.meta.env.VITE_LOCAL_GUEST === "true");
const readGuestSave = (): unknown => {
  try {
    const raw = localStorage.getItem(GUEST_SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("[NurtureGarden] Local guest save could not be read.", error);
    return null;
  }
};

export class App {
  constructor(host: HTMLElement) {
    const auth = new ViverseAuthService();
    const storage = new ViverseGardenStorage();
    const polygonPublisher = new PolygonArrangementPublisher();
    const giftApiBase = (import.meta.env.VITE_GIFT_API_BASE || "").replace(/\/$/, "");
    const accountPayload = async (session: Awaited<ReturnType<typeof auth.restoreSession>>) => {
      if (!session) return null;
      if (session.mode === "guest") {
        if (!localGuestEnabled()) return null;
        console.info("[NurtureGarden] Local guest mode active; progress is stored in this browser only.");
        return {
          account: { id: session.user.id, displayName: "Local Guest", avatarUrl: "" },
          save: readGuestSave(),
          cloudAvailable: true,
        };
      }
      if (session.mode !== "viverse") return null;
      let save: unknown = null;
      let cloudAvailable = true;
      try {
        save = await storage.load(session);
      } catch (error) {
        cloudAvailable = false;
        console.warn("[NurtureGarden] VIVERSE Cloud Save could not be loaded.", error);
      }
      return {
        account: {
          id: session.user.id,
          displayName: session.user.displayName,
          avatarUrl: session.avatar.headIconUrl || "",
        },
        save,
        cloudAvailable,
      };
    };
    const guestSession = async () => accountPayload(await auth.signInAsGuest());
    const viverseAccount = {
      isConfigured: () => localGuestEnabled() || auth.isViverseConfigured(),
      restore: async () => (localGuestEnabled() ? guestSession() : accountPayload(await auth.restoreSession())),
      refresh: async () => (localGuestEnabled() ? guestSession() : accountPayload(await auth.refreshViverseSession())),
      login: async () => (localGuestEnabled() ? guestSession() : accountPayload(await auth.signInWithViverse())),
      logout: async () => auth.signOut(),
      save: async (snapshot: unknown, expectedAccountId?: string) => {
        const session = auth.getSession();
        if (session?.mode === "guest" && localGuestEnabled()) {
          localStorage.setItem(GUEST_SAVE_KEY, JSON.stringify(snapshot));
          return;
        }
        if (!session || session.mode !== "viverse") {
          throw new Error("No VIVERSE account is signed in.");
        }
        if (expectedAccountId && session.user.id !== expectedAccountId) {
          throw new Error("The active VIVERSE account changed before Cloud Save completed.");
        }
        await storage.save(session, snapshot);
      },
    };
    const flowerModels = {
      white: assetUrl("white_flower.glb"),
      yellow: assetUrl("yellow_jasmine_flower.glb"),
      pink: assetUrl("pink_tulip_flower.glb"),
      purple: assetUrl("purple_flower.glb"),
      gem: `${import.meta.env.BASE_URL}assets/gems/glowing_gem_yellow.glb`,
      moss: collectibleAssetUrl("mossy_stone.glb"),
      glassRose: collectibleAssetUrl("glass_rose.glb"),
      glowMoss: collectibleAssetUrl("glimmer_moss_orb.glb"),
      // Rigged variants with a one-shot "bloom" clip, used when a flower is
      // first nurtured and inside floral arrangements.
      yellowBloom: assetUrl("yellow_jasmine_flower_bloom.glb"),
      glassRoseBloom: collectibleAssetUrl("glass_rose_bloom.glb"),
    };
    void preloadFlowerModels([
      flowerModels.pink,
      flowerModels.yellow,
      flowerModels.white,
      flowerModels.purple,
      flowerModels.gem,
      flowerModels.moss,
      flowerModels.glassRose,
      flowerModels.glowMoss,
      flowerModels.yellowBloom,
      flowerModels.glassRoseBloom,
    ]);

    const template = document.createElement("template");
    template.innerHTML = sandboxFragment;
    const scripts = [...template.content.querySelectorAll("script")];
    scripts.forEach((script) => script.remove());
    host.replaceChildren(template.content.cloneNode(true));

    for (const script of scripts) {
      if (script.textContent?.trim()) {
        new Function(
          "flowerModels",
          "createFlowerViewer",
          "createArrangementViewer",
          "createGiftCardViewer",
          "createReceivedGiftViewer",
          "polygonPublisher",
          "viverseAccount",
          "giftApiBase",
          script.textContent,
        )(flowerModels, createFlowerViewer, createArrangementViewer, createGiftCardViewer, createReceivedGiftViewer, polygonPublisher, viverseAccount, giftApiBase);
      }
    }
  }
}
