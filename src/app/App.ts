import type { ArtworkGenerator } from "../ai/ArtworkGenerator";
import type { AuthService } from "../auth/AuthService";
import type { AvatarProvider } from "../avatar/AvatarProvider";
import { BoardExporter } from "../export/BoardExporter";
import type { InvitationService } from "../invitation/InvitationService";
import type { AvatarData, Memory, MemoryBoard, User } from "../models/types";
import type { BoardRepository } from "../repositories/BoardRepository";
import type { MemoryRepository } from "../repositories/MemoryRepository";
import { SceneManager } from "../scene/SceneManager";
import { formatDate, formatYear } from "../utils/dates";
import { createId } from "../utils/ids";
import { readFileAsDataUrl } from "../utils/art";
import { Router } from "./Router";

interface Dependencies {
  boards: BoardRepository;
  memories: MemoryRepository;
  invitations: InvitationService;
  avatars: AvatarProvider;
  artwork: ArtworkGenerator;
  auth: AuthService;
}

export class App {
  private readonly ui: HTMLElement;
  private readonly modal: HTMLElement;
  private readonly toastElement: HTMLElement;
  private readonly scene: SceneManager;
  private readonly router: Router;
  private currentBoard: MemoryBoard | null = null;
  private currentUser: User | null = null;
  private authChecked = false;

  constructor(private readonly root: HTMLElement, private readonly deps: Dependencies) {
    this.root.innerHTML = `
      <main class="app-shell">
        <div id="scene-host" class="scene-host"></div>
        <div id="ui-layer" class="ui-layer"></div>
        <div id="modal-layer" class="modal-layer" aria-live="polite"></div>
        <div id="toast" class="toast"></div>
        <div class="grain" aria-hidden="true"></div>
      </main>`;
    this.ui = this.mustFind("#ui-layer");
    this.modal = this.mustFind("#modal-layer");
    this.toastElement = this.mustFind("#toast");
    this.scene = new SceneManager(this.mustFind("#scene-host"));
    this.scene.onMemorySelect = (memory) => void this.showMemoryDetail(memory);
    this.scene.renderer.domElement.addEventListener("memoryhover", ((event: CustomEvent<Memory | null>) => {
      const label = document.querySelector<HTMLElement>("#hover-label");
      const memory = event.detail;
      if (!label) return;
      label.innerHTML = memory ? `<span>${formatYear(memory.date)}</span>${this.escape(memory.title)}` : "";
      label.classList.toggle("visible", Boolean(memory));
    }) as EventListener);
    this.router = new Router(() => void this.render());
    void this.render();
  }

  private mustFind<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }

  private async render(): Promise<void> {
    this.closeModal();
    const path = location.pathname;
    try {
      if (!this.authChecked) {
        const session = await this.deps.auth.restoreSession();
        this.currentUser = session?.user ?? null;
        this.authChecked = true;
      }
      if (!this.currentUser) {
        this.renderSignIn();
        return;
      }
      if (path === "/") await this.renderHome();
      else if (path === "/my-memory") await this.renderPersonalBoard();
      else if (path === "/shared") await this.renderSharedSelector();
      else if (path.startsWith("/board/")) await this.renderSharedBoard(path.split("/")[2]);
      else if (path.startsWith("/join/")) await this.renderJoin(path.split("/")[2]);
      else this.renderNotFound("This path has drifted out of the memory space.");
    } catch (error) {
      this.renderNotFound(error instanceof Error ? error.message : "Something went wrong.");
    }
  }

  private renderSignIn(): void {
    this.currentBoard = null;
    this.scene.showAmbient();
    const configured = this.deps.auth.isViverseConfigured();
    this.ui.innerHTML = `
      <header class="brand"><span class="brand-mark">A·M</span><span>The Art of My Life</span></header>
      <section class="signin-copy page-enter">
        <p class="eyebrow">Enter your memory space</p>
        <h1>Every story<br>needs a keeper.</h1>
        <p>Continue as a guest, or bring your VIVERSE identity and avatar into the story.</p>
      </section>
      <section class="signin-actions page-enter delay-1">
        <button class="signin-choice viverse-choice" id="viverse-signin" ${configured ? "" : 'title="Set VITE_VIVERSE_APP_ID in .env"'}>
          <span class="signin-icon">V</span><span><strong>Sign in with VIVERSE</strong><small>${configured ? "Use your identity and active 3D avatar" : "App ID required · see .env.example"}</small></span><i>→</i>
        </button>
        <button class="signin-choice" id="guest-signin"><span class="signin-icon">✦</span><span><strong>Continue as Guest</strong><small>Explore with a private demo identity</small></span><i>→</i></button>
        <p>VIVERSE sign-in uses the official Account and Avatar SDKs.</p>
      </section>`;
    document.querySelector("#guest-signin")?.addEventListener("click", async () => {
      const session = await this.deps.auth.signInAsGuest();
      this.currentUser = session.user;
      await this.render();
    });
    document.querySelector("#viverse-signin")?.addEventListener("click", async () => {
      try {
        const session = await this.deps.auth.signInWithViverse();
        if (session) {
          this.currentUser = session.user;
          await this.render();
        } else {
          this.toast("Opening secure VIVERSE sign-in…");
        }
      } catch (error) {
        this.toast(error instanceof Error ? error.message : "VIVERSE sign-in is unavailable.", true);
      }
    });
  }

  private async renderHome(): Promise<void> {
    this.currentBoard = null;
    const avatar = await this.deps.avatars.getCurrentUserAvatar();
    this.scene.showHome(avatar);
    this.ui.innerHTML = `
      <header class="brand"><span class="brand-mark">A·M</span><span>The Art of My Life</span></header>${this.identityControl()}
      <section class="home-copy page-enter">
        <p class="eyebrow">An archive of feeling</p>
        <h1>What do you want<br>to remember?</h1>
        <p class="home-intro">Turn the moments that matter into art.</p>
      </section>
      <section class="home-actions page-enter delay-1" aria-label="Choose a memory space">
        <button class="portal-button" data-route="/my-memory"><span class="portal-index">01</span><span>My Memory</span><i>Private, only yours</i></button>
        <button class="portal-button" data-route="/shared"><span class="portal-index">02</span><span>Shared Memory</span><i>Stories you hold together</i></button>
      </section>
      <div class="avatar-caption page-enter delay-2"><span class="status-dot"></span>${avatar.displayName}<small>Your memory keeper</small></div>
      <p class="home-footer">Some memories are yours. Some belong to all of you.</p>`;
    this.bindRoutes();
    this.bindIdentityControl();
  }

  private async renderPersonalBoard(): Promise<void> {
    let board: MemoryBoard;
    try {
      board = await this.deps.boards.getPersonalBoard(this.user.id);
    } catch {
      board = await this.deps.boards.createPersonalBoard(this.user.id, `${this.user.displayName}'s Life`);
    }
    await this.renderBoard(board);
  }

  private async renderSharedBoard(boardId: string): Promise<void> {
    const board = await this.deps.boards.getBoard(boardId, this.user.id);
    await this.renderBoard(board);
  }

  private async renderBoard(board: MemoryBoard): Promise<void> {
    this.currentBoard = board;
    const [memories, avatars] = await Promise.all([
      this.deps.memories.getMemories(board.id),
      Promise.all(board.memberIds.map((id) => this.deps.avatars.getUserAvatar(id))),
    ]);
    this.scene.showBoard(memories, avatars);
    const isShared = board.type === "shared";
    this.ui.innerHTML = `
      <header class="board-nav page-enter">
        <button class="text-button back-button" data-route="${isShared ? "/shared" : "/"}" aria-label="Go back"><span>←</span> ${isShared ? "Shared memories" : "Home"}</button>
        <span class="brand-mark">A·M</span>
        <div class="nav-actions">${this.identityControl()}
          ${isShared ? '<button class="text-button" id="invite-button">Invite</button>' : ""}
          <button class="text-button" id="export-button">Export</button>
        </div>
      </header>
      <section class="board-heading page-enter delay-1">
        <p class="eyebrow">${isShared ? "A story held together" : "A life in moments"}</p>
        <h1>${this.escape(board.name)}</h1>
        <p>${memories.length} ${memories.length === 1 ? "memory" : "memories"} · ${isShared ? avatars.map((avatar) => avatar.displayName).join(" · ") : "Private to you"}</p>
      </section>
      <div id="hover-label" class="hover-label"></div>
      <div class="board-legend"><span>Past</span><i></i><span>Now</span></div>
      ${memories.length === 0 ? '<div class="empty-state"><p>Your story starts here.</p></div>' : ""}
      <button class="create-orb page-enter delay-2" id="create-memory"><span>+</span><em>Create<br>Memory</em></button>
      <p class="scene-hint">Move through the ribbon · Select an artwork to remember</p>`;
    this.bindRoutes();
    this.bindIdentityControl();
    document.querySelector("#create-memory")?.addEventListener("click", () => this.openMemoryCreator(board));
    document.querySelector("#invite-button")?.addEventListener("click", () => void this.showInvite(board));
    document.querySelector("#export-button")?.addEventListener("click", () => void this.exportBoard(board));
  }

  private async renderSharedSelector(): Promise<void> {
    this.currentBoard = null;
    const boards = await this.deps.boards.getSharedBoards(this.user.id);
    this.scene.showAmbient();
    this.ui.innerHTML = `
      <header class="brand"><span class="brand-mark">A·M</span><span>The Art of My Life</span></header>${this.identityControl()}
      <button class="text-button selector-back" data-route="/">← Home</button>
      <section class="selector-copy page-enter">
        <p class="eyebrow">Shared memories</p>
        <h1>Stories we<br>carry together.</h1>
        <p>Each space belongs only to the people who lived it.</p>
      </section>
      <section class="board-list page-enter delay-1">
        ${boards.map((board, index) => `
          <button class="board-row" data-route="/board/${board.id}">
            <span class="board-number">${String(index + 1).padStart(2, "0")}</span>
            <span><strong>${this.escape(board.name)}</strong><small>${board.memberIds.length} keepers · Open memory space</small></span>
            <i>↗</i>
          </button>`).join("")}
        <button class="board-row create-board-row" id="create-board"><span class="board-number">+</span><span><strong>Create Shared Board</strong><small>Begin a story with someone</small></span><i>→</i></button>
      </section>`;
    this.bindRoutes();
    this.bindIdentityControl();
    document.querySelector("#create-board")?.addEventListener("click", () => this.openCreateBoard());
  }

  private async renderJoin(token: string): Promise<void> {
    this.scene.showAmbient();
    const invitation = await this.deps.invitations.getInvitation(token);
    const board = await this.deps.boards.getBoardUnsafe(invitation.boardId);
    const creator = await this.deps.avatars.getUserAvatar(invitation.createdBy);
    this.ui.innerHTML = `
      <header class="brand"><span class="brand-mark">A·M</span><span>The Art of My Life</span></header>
      <section class="join-card page-enter">
        <span class="invite-seal">✦</span>
        <p class="eyebrow">You've been invited to join</p>
        <h1>${this.escape(board.name)}</h1>
        <p>Created by ${creator.displayName}</p>
        <div class="join-as"><span class="mini-avatar">${this.escape(this.user.displayName[0] ?? "M")}</span><span>Joining as <strong>${this.escape(this.user.displayName)}</strong><small>${this.deps.auth.getSession()?.mode === "viverse" ? "VIVERSE identity" : "Guest identity"}</small></span></div>
        <button class="primary-button" id="join-board">Join Memory Board <span>→</span></button>
        <button class="text-button" data-route="/">Not now</button>
      </section>`;
    this.bindRoutes();
    document.querySelector("#join-board")?.addEventListener("click", async () => {
      try {
        const joined = await this.deps.invitations.joinWithInvitation(token, this.user.id);
        this.toast(`Welcome to the memory space, ${this.user.displayName}.`);
        this.router.navigate(`/board/${joined.id}`);
      } catch (error) {
        this.toast(error instanceof Error ? error.message : "Could not join this board.", true);
      }
    });
  }

  private renderNotFound(message: string): void {
    this.scene.showAmbient();
    this.ui.innerHTML = `<section class="join-card error-card"><span class="invite-seal">×</span><p class="eyebrow">Memory unavailable</p><h1>${this.escape(message)}</h1><button class="primary-button" data-route="/">Return home</button></section>`;
    this.bindRoutes();
  }

  private openMemoryCreator(board: MemoryBoard): void {
    let file: File | null = null;
    let originalPhotoUrl = "";
    let artworkUrl = "";
    const state = { title: "", date: "", story: "", emotion: "Nostalgia" };
    const renderStep = (step: number, error = "") => {
      this.modal.classList.add("open");
      if (step === 1) {
        this.modal.innerHTML = this.modalShell(`
          <div class="step-count">01 <i></i> 03</div>
          <p class="eyebrow">Create a memory</p><h2>Choose the moment.</h2>
          <label class="upload-drop ${file ? "has-image" : ""}" for="photo-input" ${originalPhotoUrl ? `style="background-image:linear-gradient(rgba(12,9,18,.22),rgba(12,9,18,.58)),url(${originalPhotoUrl})"` : ""}><input id="photo-input" type="file" accept="image/jpeg,image/png,image/webp" hidden><span>+</span><strong>${file ? this.escape(file.name) : "Choose a photograph"}</strong><small>${file ? "Photo ready · click to replace" : "JPG, PNG or WebP · up to 10 MB"}</small></label>
          <div class="modal-actions"><button class="text-button modal-close">Cancel</button><button class="primary-button" id="photo-next" ${file ? "" : "disabled"}>Continue <span>→</span></button></div>`);
        const input = document.querySelector<HTMLInputElement>("#photo-input")!;
        const next = document.querySelector<HTMLButtonElement>("#photo-next")!;
        input.addEventListener("change", async () => {
          const selected = input.files?.[0];
          if (!selected) return;
          if (selected.size > 10 * 1024 * 1024) return this.toast("That photo is larger than 10 MB.", true);
          if (!selected.type.match(/^image\/(jpeg|png|webp)$/)) return this.toast("Please choose a JPG, PNG, or WebP image.", true);
          file = selected;
          originalPhotoUrl = await readFileAsDataUrl(selected);
          const drop = document.querySelector<HTMLElement>(".upload-drop")!;
          drop.style.backgroundImage = `linear-gradient(rgba(12,9,18,.22),rgba(12,9,18,.58)),url(${originalPhotoUrl})`;
          drop.classList.add("has-image");
          drop.querySelector("strong")!.textContent = selected.name;
          drop.querySelector("small")!.textContent = "Photo ready · click to replace";
          next.disabled = false;
        });
        next.addEventListener("click", () => renderStep(2));
      } else if (step === 2) {
        this.modal.innerHTML = this.modalShell(`
          <div class="step-count">02 <i></i> 03</div>
          <p class="eyebrow">Give it meaning</p><h2>What lives in this moment?</h2>
          <form id="memory-form" class="memory-form">
            <label><span>Title *</span><input name="title" maxlength="60" value="${this.escape(state.title)}" placeholder="My First Concert" required></label>
            <label><span>Date *</span><input name="date" type="date" value="${state.date}" max="${new Date().toISOString().slice(0, 10)}" required></label>
            <label class="full"><span>Story *</span><textarea name="story" maxlength="700" placeholder="Tell the part you never want to lose..." required>${this.escape(state.story)}</textarea></label>
            <label class="full"><span>Emotion</span><div class="emotion-picker">${["Joy", "Love", "Excitement", "Nostalgia", "Hope", "Peace", "Sadness", "Fear"].map((emotion) => `<button type="button" class="emotion ${state.emotion === emotion ? "selected" : ""}" data-emotion="${emotion}">${emotion}</button>`).join("")}</div></label>
          </form>
          <div class="modal-actions"><button class="text-button" id="info-back">← Back</button><button class="primary-button" id="generate-art">Reimagine as art <span>✦</span></button></div>`);
        document.querySelectorAll<HTMLElement>(".emotion").forEach((button) => button.addEventListener("click", () => {
          document.querySelectorAll(".emotion").forEach((item) => item.classList.remove("selected"));
          button.classList.add("selected");
          state.emotion = button.dataset.emotion ?? "Nostalgia";
        }));
        document.querySelector("#info-back")?.addEventListener("click", () => renderStep(1));
        document.querySelector("#generate-art")?.addEventListener("click", async () => {
          const form = document.querySelector<HTMLFormElement>("#memory-form")!;
          if (!form.reportValidity() || !file) return;
          const data = new FormData(form);
          state.title = String(data.get("title")); state.date = String(data.get("date")); state.story = String(data.get("story"));
          renderStep(3);
          try {
            artworkUrl = (await this.deps.artwork.generateArtwork({ image: file, ...state })).imageUrl;
            renderStep(4);
          } catch (generationError) {
            renderStep(2, generationError instanceof Error ? generationError.message : "Artwork generation failed.");
          }
        });
      } else if (step === 3) {
        this.modal.innerHTML = this.modalShell(`<div class="generating"><div class="art-loader"><i></i><i></i><i></i></div><p class="eyebrow">Illustration studio</p><h2>Painting your photograph...</h2><p>Finding its shapes, contours, color, and emotion.</p></div>`);
      } else {
        this.modal.innerHTML = this.modalShell(`
          <div class="step-count">03 <i></i> 03</div><p class="eyebrow">Your memory, reimagined</p><h2>${this.escape(state.title)}</h2>
          <div class="art-preview"><img src="${artworkUrl}" alt="Generated painterly illustration"><span>${state.emotion}</span></div>
          <p class="preview-note">A painterly illustration that keeps the people and place recognizable.</p>
          <div class="modal-actions"><button class="text-button" id="retry-art">Reimagine again</button><button class="primary-button" id="save-memory">Keep this memory <span>→</span></button></div>`);
        document.querySelector("#retry-art")?.addEventListener("click", async () => {
          if (!file) return;
          renderStep(3);
          try { artworkUrl = (await this.deps.artwork.generateArtwork({ image: file, ...state })).imageUrl; renderStep(4); }
          catch { renderStep(2, "Artwork generation failed. Your story is still here—please retry."); }
        });
        document.querySelector("#save-memory")?.addEventListener("click", async () => {
          const now = new Date().toISOString();
          const memory: Memory = {
            id: createId("memory"), boardId: board.id, creatorId: this.user.id, contributorIds: [this.user.id],
            ...state, originalPhotoUrl, artworkUrl, createdAt: now, updatedAt: now,
          };
          try {
            await this.deps.memories.createMemory(memory);
            this.closeModal();
            this.toast("Your memory has joined the ribbon.");
            await this.renderBoard(board);
          } catch (saveError) {
            this.toast(saveError instanceof Error ? saveError.message : "This memory could not be saved.", true);
          }
        });
      }
      if (error) this.toast(error, true);
      document.querySelectorAll(".modal-close").forEach((button) => button.addEventListener("click", () => this.closeModal()));
    };
    renderStep(1);
  }

  private async showMemoryDetail(memory: Memory): Promise<void> {
    const contributors: AvatarData[] = await Promise.all(memory.contributorIds.map((id) => this.deps.avatars.getUserAvatar(id)));
    this.modal.classList.add("open");
    this.modal.innerHTML = this.modalShell(`
      <div class="memory-detail">
        <div class="detail-art"><img src="${memory.artworkUrl}" alt="${this.escape(memory.title)} abstract artwork"><button id="original-toggle">View original photo</button></div>
        <div class="detail-copy"><p class="eyebrow">${memory.emotion ?? "Memory"}</p><h2>${this.escape(memory.title)}</h2><time>${formatDate(memory.date)}</time><blockquote>“${this.escape(memory.story)}”</blockquote>
        ${this.currentBoard?.type === "shared" ? `<div class="contributors"><span>Remembered by</span>${contributors.map((avatar) => `<i style="--avatar:${avatar.palette[1]}" title="${avatar.displayName}">${avatar.displayName[0]}</i>`).join("")}</div>` : ""}
        <button class="primary-button modal-close">Return to the ribbon</button></div>
      </div>`, "detail-modal");
    document.querySelectorAll(".modal-close").forEach((button) => button.addEventListener("click", () => this.closeModal()));
    let original = false;
    document.querySelector("#original-toggle")?.addEventListener("click", () => {
      original = !original;
      const image = document.querySelector<HTMLImageElement>(".detail-art img")!;
      image.src = original ? memory.originalPhotoUrl : memory.artworkUrl;
      document.querySelector("#original-toggle")!.textContent = original ? "Return to artwork" : "View original photo";
    });
  }

  private openCreateBoard(): void {
    this.modal.classList.add("open");
    this.modal.innerHTML = this.modalShell(`
      <p class="eyebrow">A new shared story</p><h2>Name the space you share.</h2>
      <form id="board-form" class="memory-form single"><label><span>Board name *</span><input name="name" maxlength="55" placeholder="Our HTC Days" autocomplete="off" required autofocus></label></form>
      <p class="form-whisper">You can invite people after creating the board.</p>
      <div class="modal-actions"><button class="text-button modal-close">Cancel</button><button class="primary-button" id="make-board">Create Board <span>→</span></button></div>`);
    document.querySelector(".modal-close")?.addEventListener("click", () => this.closeModal());
    const create = async () => {
      const form = document.querySelector<HTMLFormElement>("#board-form")!;
      if (!form.reportValidity()) return;
      const name = String(new FormData(form).get("name"));
      const board = await this.deps.boards.createSharedBoard(this.user.id, name);
      const invitation = await this.deps.invitations.createInvitation(board.id, this.user.id);
      this.showNewBoard(board, invitation.token);
    };
    document.querySelector("#make-board")?.addEventListener("click", () => void create());
  }

  private showNewBoard(board: MemoryBoard, token: string): void {
    const url = `${location.origin}/join/${token}`;
    this.modal.innerHTML = this.modalShell(`
      <span class="invite-seal">✦</span><p class="eyebrow">Your shared space is ready</p><h2>Invite people who shared<br>these moments with you.</h2>
      <div class="invite-link"><span>${this.escape(url)}</span><button id="copy-new-link">Copy</button></div>
      <div class="modal-actions"><button class="text-button" id="copy-new-link-secondary">Copy Invite Link</button><button class="primary-button" id="enter-new-board">Enter Board <span>→</span></button></div>`);
    const copy = () => void this.copyText(url);
    document.querySelector("#copy-new-link")?.addEventListener("click", copy);
    document.querySelector("#copy-new-link-secondary")?.addEventListener("click", copy);
    document.querySelector("#enter-new-board")?.addEventListener("click", () => { this.closeModal(); this.router.navigate(`/board/${board.id}`); });
  }

  private async showInvite(board: MemoryBoard): Promise<void> {
    const invitation = await this.deps.invitations.createInvitation(board.id, this.user.id);
    const url = `${location.origin}/join/${invitation.token}`;
    this.modal.classList.add("open");
    this.modal.innerHTML = this.modalShell(`
      <span class="invite-seal">✦</span><p class="eyebrow">Invite another memory keeper</p><h2>Invite people to<br>${this.escape(board.name)}</h2>
      <p class="invite-explainer">Anyone with this private link can join the board and add memories.</p>
      <div class="invite-link"><span>${this.escape(url)}</span><button id="copy-link">Copy</button></div>
      <div class="modal-actions"><button class="text-button modal-close">Close</button><button class="primary-button" id="copy-link-main">Copy Invite Link</button></div>`);
    document.querySelector(".modal-close")?.addEventListener("click", () => this.closeModal());
    const copy = () => void this.copyText(url);
    document.querySelector("#copy-link")?.addEventListener("click", copy);
    document.querySelector("#copy-link-main")?.addEventListener("click", copy);
  }

  private async exportBoard(board: MemoryBoard): Promise<void> {
    try {
      this.ui.classList.add("exporting");
      const exporter = new BoardExporter(this.scene.renderer);
      const blob = await exporter.exportPNG(this.scene.scene, this.scene.camera);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${board.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
      link.click();
      URL.revokeObjectURL(url);
      this.toast("Your memory composition has been exported.");
    } catch {
      this.toast("The export could not be created. Please try again.", true);
    } finally {
      this.ui.classList.remove("exporting");
    }
  }

  private modalShell(content: string, extraClass = ""): string {
    return `<div class="modal-backdrop modal-close"></div><section class="modal-card ${extraClass}"><button class="modal-x modal-close" aria-label="Close">×</button>${content}</section>`;
  }

  private closeModal(): void {
    this.modal.classList.remove("open");
    this.modal.innerHTML = "";
  }

  private bindRoutes(): void {
    document.querySelectorAll<HTMLElement>("[data-route]").forEach((element) => {
      element.addEventListener("click", () => this.router.navigate(element.dataset.route ?? "/"));
    });
  }

  private async copyText(text: string): Promise<void> {
    try { await navigator.clipboard.writeText(text); this.toast("Invite link copied."); }
    catch { this.toast("Copy failed. Select the link and copy it manually.", true); }
  }

  private get user(): User {
    if (!this.currentUser) throw new Error("Please sign in to enter your memory space.");
    return this.currentUser;
  }

  private identityControl(): string {
    const session = this.deps.auth.getSession();
    if (!session) return "";
    const portrait = session.avatar.headIconUrl
      ? `<img src="${this.escape(session.avatar.headIconUrl)}" alt="">`
      : `<span>${this.escape(session.user.displayName[0] ?? "M")}</span>`;
    return `<button class="identity-control" id="identity-control" title="Sign out">${portrait}<i><strong>${this.escape(session.user.displayName)}</strong><small>${session.mode === "viverse" ? "VIVERSE" : "GUEST"}</small></i></button>`;
  }

  private bindIdentityControl(): void {
    document.querySelector("#identity-control")?.addEventListener("click", async () => {
      await this.deps.auth.signOut();
      this.currentUser = null;
      this.currentBoard = null;
      this.router.navigate("/");
    });
  }

  private toast(message: string, error = false): void {
    this.toastElement.textContent = message;
    this.toastElement.classList.toggle("error", error);
    this.toastElement.classList.add("visible");
    window.setTimeout(() => this.toastElement.classList.remove("visible"), 3300);
  }

  private escape(value: string): string {
    const div = document.createElement("div");
    div.textContent = value;
    return div.innerHTML;
  }
}
