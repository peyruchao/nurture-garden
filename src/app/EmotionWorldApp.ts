import { CanvasEditor } from "../canvas/CanvasEditor";
import { cloneArtwork, type Artwork } from "../canvas/artworkTypes";
import { generateInitialArtwork } from "../canvas/initialArtwork";
import { MockEmotionClassifier } from "../emotion/emotionClassifier";
import { emotionConfigs, isEmotion } from "../emotion/emotionConfig";
import type { Emotion } from "../emotion/emotionTypes";
import { artworkToWorld } from "../world/ArtworkToWorld";
import { WorldScene } from "../world/WorldScene";
import type { WorldDefinition } from "../world/worldTypes";
import { StateMachine } from "./AppState";

const delay = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export class App {
  private readonly ui: HTMLElement;
  private readonly worldHost: HTMLElement;
  private readonly classifier = new MockEmotionClassifier();
  private readonly state: StateMachine;
  private emotion: Emotion | null = null;
  private artwork: Artwork | null = null;
  private editor: CanvasEditor | null = null;
  private world: WorldDefinition | null = null;
  private worldScene: WorldScene | null = null;
  private returningToArtwork = false;

  constructor(private readonly root: HTMLElement) {
    this.root.innerHTML = `<main class="app-shell"><div id="world-host" class="world-host"></div><div id="ui" class="ui-layer"></div><div class="grain" aria-hidden="true"></div></main>`;
    const ui = root.querySelector<HTMLElement>("#ui");
    const worldHost = root.querySelector<HTMLElement>("#world-host");
    if (!ui || !worldHost) throw new Error("Application layers unavailable");
    this.ui = ui;
    this.worldHost = worldHost;

    const demo = new URLSearchParams(location.search).get("demo");
    if (isEmotion(demo)) {
      this.state = new StateMachine("CANVAS");
      this.emotion = demo;
      this.artwork = generateInitialArtwork(demo, true);
      this.renderCanvas();
    } else {
      this.state = new StateMachine("EMOTION_INPUT");
      this.renderEmotionInput();
    }
  }

  private renderEmotionInput(): void {
    this.worldHost.classList.remove("visible");
    this.ui.className = "ui-layer input-screen";
    this.ui.innerHTML = `
      <header class="site-mark"><span class="mark-symbol">○</span><span>Emotion World</span></header>
      <section class="input-copy screen-enter">
        <span class="step-label">01 — Begin with what is here</span>
        <h1>How are you<br><em>feeling?</em></h1>
        <p>No diagnosis. No right words.<br>Just one sentence to begin.</p>
      </section>
      <form class="emotion-form screen-enter delay-1" id="emotion-form">
        <label for="emotion-text">Tell us in one sentence.</label>
        <div class="textarea-wrap"><textarea id="emotion-text" maxlength="300" rows="4" placeholder="I feel overwhelmed by everything happening at once."></textarea><span id="character-count">0 / 300</span></div>
        <button class="primary-cta" type="submit" disabled>Create My Space <span>→</span></button>
      </form>
      <p class="privacy-note">Your words stay in this browser session.</p>
      <div class="ambient-orb orb-one"></div><div class="ambient-orb orb-two"></div>`;
    const form = this.ui.querySelector<HTMLFormElement>("#emotion-form");
    const textarea = this.ui.querySelector<HTMLTextAreaElement>("#emotion-text");
    const button = form?.querySelector<HTMLButtonElement>("button");
    const count = this.ui.querySelector<HTMLElement>("#character-count");
    textarea?.addEventListener("input", () => {
      if (button) button.disabled = textarea.value.trim().length === 0;
      if (count) count.textContent = `${textarea.value.length} / 300`;
    });
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (textarea?.value.trim()) void this.analyze(textarea.value.trim());
    });
  }

  private async analyze(text: string): Promise<void> {
    this.state.transition("ANALYZING");
    this.ui.className = "ui-layer centered-screen";
    this.ui.innerHTML = `<section class="analysis-card screen-enter"><div class="pulse-mark"><i></i><i></i><i></i></div><span class="step-label">Listening to the shape of it</span><h1>Making room<br>for your feeling…</h1></section>`;
    try {
      const [result] = await Promise.all([this.classifier.classify(text), delay(700)]);
      this.emotion = result.emotion;
    } catch {
      this.emotion = "unclear";
    }
    const config = emotionConfigs[this.emotion];
    this.ui.innerHTML = `<section class="emotion-reveal"><span class="reveal-symbol">${config.symbol}</span><p>Your feeling feels…</p><h1>${config.displayName}</h1><small>Let’s give it a shape.</small></section>`;
    await delay(1150);
    this.artwork = generateInitialArtwork(this.emotion);
    this.state.transition("CANVAS");
    this.renderCanvas();
  }

  private renderCanvas(): void {
    if (!this.emotion || !this.artwork) return;
    this.worldHost.classList.remove("visible");
    this.editor?.dispose();
    this.ui.className = `ui-layer studio-screen emotion-${this.emotion}`;
    this.editor = new CanvasEditor(this.ui, this.emotion, this.artwork);
    this.ui.querySelector("#finish-artwork")?.addEventListener("click", () => void this.finishArtwork());
  }

  private async finishArtwork(): Promise<void> {
    if (!this.editor || !this.emotion) return;
    this.editor.setEnabled(false);
    this.artwork = this.editor.getArtwork();
    this.editor.dispose();
    this.editor = null;
    this.state.transition("GENERATING_WORLD");
    await this.generateWorld();
  }

  private async generateWorld(): Promise<void> {
    if (!this.artwork || !this.emotion) return;
    this.ui.className = `ui-layer centered-screen generation-screen emotion-${this.emotion}`;
    this.ui.innerHTML = `
      <section class="generation-card screen-enter"><div class="transform-visual"><i></i><i></i><i></i><span>${emotionConfigs[this.emotion].symbol}</span></div>
      <span class="step-label">03 — From element to ecosystem</span><h1>Your feeling<br>has taken shape.</h1><p>Water becomes a current. Seeds become life.<br>Every force you placed becomes part of the world…</p></section>`;
    try {
      this.world = artworkToWorld(this.artwork, this.emotion, 2026);
      this.worldScene?.dispose();
      this.worldScene = new WorldScene(this.worldHost);
      await Promise.all([this.worldScene.loadWorld(this.world), delay(1800)]);
      this.state.transition("WORLD_PREVIEW");
      this.renderWorldPreview();
    } catch {
      this.worldScene?.dispose();
      this.worldScene = null;
      this.ui.innerHTML = `<section class="error-card screen-enter"><span>○</span><h1>We couldn't shape<br>the world this time.</h1><button class="primary-cta" id="retry-world">Try Again <b>→</b></button></section>`;
      this.ui.querySelector("#retry-world")?.addEventListener("click", () => void this.generateWorld());
    }
  }

  private renderWorldPreview(): void {
    if (!this.emotion) return;
    this.worldHost.classList.add("visible");
    const config = emotionConfigs[this.emotion];
    this.ui.className = "ui-layer preview-screen";
    this.ui.innerHTML = `
      <header class="site-mark light"><span class="mark-symbol">${config.symbol}</span><span>Emotion World</span></header>
      <section class="preview-copy screen-enter"><span class="step-label">04 — ${config.displayName} world</span><h1>Your world<br>is alive.</h1><p>Every current, flame, stone, and growing form began with you.</p>
      <button class="primary-cta light-cta" id="enter-world">Step Into Your Feeling <span>→</span></button><small>Best experienced with sound and space around you.</small></section>
      <div class="preview-vignette"></div>`;
    this.ui.querySelector("#enter-world")?.addEventListener("click", () => this.enterWorld());
  }

  private enterWorld(): void {
    if (!this.worldScene || this.state.value !== "WORLD_PREVIEW") return;
    this.state.transition("ENTERING_WORLD");
    this.ui.innerHTML = "";
    this.worldScene.enter(
      () => {
        if (this.state.value !== "ENTERING_WORLD") return;
        this.state.transition("WORLD");
        this.renderWorldHud();
      },
      () => {
        if (this.returningToArtwork) return;
        if (this.state.value === "WORLD") this.renderPauseMenu();
        else if (this.state.value === "ENTERING_WORLD") {
          this.state.transition("WORLD_PREVIEW");
          this.renderWorldPreview();
        }
      },
    );
  }

  private renderWorldHud(): void {
    this.ui.className = "ui-layer world-ui";
    this.ui.innerHTML = `<div class="crosshair" aria-hidden="true"></div><div class="world-hud"><span><b>W A S D</b> Move</span><span><b>Mouse</b> Look</span><span><b>ESC</b> Exit</span></div>`;
  }

  private renderPauseMenu(): void {
    this.ui.className = "ui-layer pause-screen";
    this.ui.innerHTML = `<section class="pause-card screen-enter"><span class="step-label">You are still here</span><h1>Take another<br>look?</h1><button class="primary-cta light-cta" id="continue-world">Continue Exploring <span>→</span></button><button class="secondary-cta" id="return-artwork">Return to Artwork</button></section>`;
    this.ui.querySelector("#continue-world")?.addEventListener("click", () => {
      this.ui.innerHTML = "";
      this.worldScene?.continue();
    });
    this.ui.querySelector("#return-artwork")?.addEventListener("click", () => this.returnToArtwork());
  }

  private returnToArtwork(): void {
    if (this.state.value !== "WORLD" || !this.artwork) return;
    this.returningToArtwork = true;
    this.worldScene?.unlock();
    this.worldScene?.dispose();
    this.worldScene = null;
    this.world = null;
    this.state.transition("CANVAS");
    this.artwork = cloneArtwork(this.artwork);
    this.returningToArtwork = false;
    this.renderCanvas();
  }
}
