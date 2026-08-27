import { emotionConfigs } from "../emotion/emotionConfig";
import type { Emotion } from "../emotion/emotionTypes";
import { cloneArtwork, type Artwork, type ElementMaterial } from "./artworkTypes";
import { CanvasRenderer, idMaterials, materialColors, materialIds } from "./CanvasRenderer";

type SandboxTool = ElementMaterial | "eraser";

const CELL_SIZE = 5;
const descriptions: Record<SandboxTool, string> = {
  sand: "Falls, gathers, and redirects water.", water: "Flows into space and helps seeds grow.",
  seed: "Settles on earth and grows near water.", plant: "A living material created by seeds.",
  wind: "Pushes loose matter across your world.", fire: "Rises, spreads through plants, and meets water as mist.",
  stone: "Builds permanent ground, walls, and shelter.", mist: "A transient element born when fire meets water.",
  eraser: "Removes matter and opens new space.",
};

const toolMeta: Array<{ id: SandboxTool; icon: string; label: string }> = [
  { id: "sand", icon: "⠿", label: "Sand" }, { id: "water", icon: "≈", label: "Water" },
  { id: "seed", icon: "✤", label: "Seed" }, { id: "wind", icon: "≋", label: "Wind" },
  { id: "fire", icon: "△", label: "Fire" }, { id: "stone", icon: "◆", label: "Stone" },
  { id: "eraser", icon: "○", label: "Erase" },
];

export class CanvasEditor {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: CanvasRenderer;
  private artwork: Artwork;
  private readonly baseline: Artwork;
  private readonly columns: number;
  private readonly rows: number;
  private cells: Uint8Array;
  private energy: Uint8Array;
  private moved: Uint8Array;
  private tool: SandboxTool = "sand";
  private brushRadius = 3;
  private undoStack: Artwork[] = [];
  private redoStack: Artwork[] = [];
  private enabled = true;
  private paused = false;
  private painting = false;
  private lastPoint: { x: number; y: number } | null = null;
  private windDirection = 1;
  private tick = 0;
  private animationFrame = 0;
  private lastStep = 0;

  constructor(private readonly host: HTMLElement, private readonly emotion: Emotion, initial: Artwork) {
    this.artwork = cloneArtwork(initial);
    this.baseline = cloneArtwork(initial);
    this.columns = Math.floor(this.artwork.width / CELL_SIZE);
    this.rows = Math.floor(this.artwork.height / CELL_SIZE);
    this.cells = new Uint8Array(this.columns * this.rows);
    this.energy = new Uint8Array(this.cells.length);
    this.moved = new Uint8Array(this.cells.length);
    host.innerHTML = this.template();
    const canvas = host.querySelector<HTMLCanvasElement>("#artwork-canvas");
    if (!canvas) throw new Error("Canvas unavailable");
    this.canvas = canvas;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas unavailable");
    this.renderer = new CanvasRenderer(context);
    this.loadElements(this.artwork);
    this.bind();
    this.render();
    this.updateControls();
    this.animationFrame = requestAnimationFrame(this.animate);
  }

  getArtwork(): Artwork {
    this.syncElements();
    return cloneArtwork(this.artwork);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.paused = !enabled;
    this.host.classList.toggle("is-frozen", !enabled);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.canvas.onpointerdown = null;
    this.canvas.onpointermove = null;
    this.canvas.onpointerup = null;
    this.canvas.onpointercancel = null;
  }

  private template(): string {
    const config = emotionConfigs[this.emotion];
    return `
      <div class="studio-layout sandbox-layout">
        <header class="studio-header">
          <div><span class="step-label">02 — Create with living elements</span><h1>${config.symbol} ${config.displayName}</h1></div>
          <p>This world is yours to set in motion.<br><span>Place elements. Watch them meet. Change what happens.</span></p>
        </header>
        <div class="canvas-frame sandbox-frame"><canvas id="artwork-canvas" width="${this.artwork.width}" height="${this.artwork.height}" aria-label="Your living emotion sandbox"></canvas><div class="simulation-status"><i></i><span>World alive</span></div><span class="canvas-corner">Drag to create</span></div>
        <aside class="canvas-toolbar sandbox-toolbar" aria-label="World elements">
          <div class="toolbar-heading"><span>Creator elements</span><small>Choose a force, then draw it into your world.</small></div>
          <div class="element-grid">${toolMeta.map((tool, index) => `<button class="element-button ${index === 0 ? "active" : ""}" data-material="${tool.id}" aria-label="Select ${tool.label}"><i style="--element-color:${tool.id === "eraser" ? "#c8c5bf" : materialColors[tool.id as ElementMaterial]}">${tool.icon}</i><span>${tool.label}</span></button>`).join("")}</div>
          <p class="element-description" id="element-description">${descriptions.sand}</p>
          <div class="tool-group brush-control"><span>Flow size</span><div class="size-options"><button data-radius="1">Fine</button><button class="active" data-radius="3">Flow</button><button data-radius="6">Wave</button></div></div>
          <div class="simulation-controls"><button id="pause-simulation" aria-label="Pause simulation">Ⅱ <span>Pause</span></button><button id="reset-simulation">↺ <span>Reset</span></button></div>
          <div class="history-buttons"><button id="undo" aria-label="Undo">↶ <span>Undo</span></button><button id="redo" aria-label="Redo">↷ <span>Redo</span></button></div>
        </aside>
        <div class="studio-finish"><div class="creator-legend"><span><i class="legend-dot water-dot"></i>Water grows seeds</span><span><i class="legend-dot fire-dot"></i>Fire makes mist</span><span><i class="legend-dot wind-dot"></i>Wind moves matter</span></div><button class="primary-cta" id="finish-artwork">Shape My World <span>→</span></button></div>
      </div>`;
  }

  private bind(): void {
    this.host.querySelectorAll<HTMLButtonElement>("[data-material]").forEach((button) => button.addEventListener("click", () => {
      this.tool = button.dataset.material as SandboxTool;
      this.host.querySelectorAll("[data-material]").forEach((item) => item.classList.toggle("active", item === button));
      const description = this.host.querySelector<HTMLElement>("#element-description");
      if (description) description.textContent = descriptions[this.tool];
      this.canvas.dataset.tool = this.tool;
    }));
    this.host.querySelectorAll<HTMLButtonElement>("[data-radius]").forEach((button) => button.addEventListener("click", () => {
      this.brushRadius = Number(button.dataset.radius);
      this.host.querySelectorAll("[data-radius]").forEach((item) => item.classList.toggle("active", item === button));
    }));
    this.host.querySelector("#undo")?.addEventListener("click", () => this.undo());
    this.host.querySelector("#redo")?.addEventListener("click", () => this.redo());
    this.host.querySelector("#reset-simulation")?.addEventListener("click", () => this.reset());
    this.host.querySelector("#pause-simulation")?.addEventListener("click", () => this.togglePause());
    this.canvas.onpointerdown = (event) => this.pointerDown(event);
    this.canvas.onpointermove = (event) => this.pointerMove(event);
    this.canvas.onpointerup = (event) => this.pointerUp(event);
    this.canvas.onpointercancel = (event) => this.pointerUp(event);
  }

  private pointerDown(event: PointerEvent): void {
    if (!this.enabled) return;
    this.canvas.setPointerCapture(event.pointerId);
    this.pushHistory();
    this.painting = true;
    this.lastPoint = this.gridPoint(event);
    this.paintAt(this.lastPoint.x, this.lastPoint.y);
    this.render();
  }

  private pointerMove(event: PointerEvent): void {
    if (!this.enabled || !this.painting || !this.canvas.hasPointerCapture(event.pointerId)) return;
    const point = this.gridPoint(event);
    if (this.lastPoint) {
      this.windDirection = point.x < this.lastPoint.x ? -1 : 1;
      const distance = Math.max(Math.abs(point.x - this.lastPoint.x), Math.abs(point.y - this.lastPoint.y));
      for (let step = 1; step <= Math.max(1, distance); step += 1) {
        const progress = step / Math.max(1, distance);
        this.paintAt(Math.round(this.lastPoint.x + (point.x - this.lastPoint.x) * progress), Math.round(this.lastPoint.y + (point.y - this.lastPoint.y) * progress));
      }
    }
    this.lastPoint = point;
    this.render();
  }

  private pointerUp(event: PointerEvent): void {
    if (!this.canvas.hasPointerCapture(event.pointerId)) return;
    this.painting = false;
    this.lastPoint = null;
    this.canvas.releasePointerCapture(event.pointerId);
    this.updateControls();
  }

  private paintAt(centerX: number, centerY: number): void {
    for (let y = -this.brushRadius; y <= this.brushRadius; y += 1) {
      for (let x = -this.brushRadius; x <= this.brushRadius; x += 1) {
        if (x * x + y * y > this.brushRadius * this.brushRadius) continue;
        const column = centerX + x;
        const row = centerY + y;
        if (!this.inBounds(column, row)) continue;
        const index = this.index(column, row);
        if (this.tool === "eraser") {
          this.cells[index] = 0;
          this.energy[index] = 0;
        } else {
          this.cells[index] = materialIds[this.tool];
          this.energy[index] = this.tool === "fire" ? 95 : this.tool === "wind" || this.tool === "mist" ? 65 : 100;
        }
      }
    }
  }

  private readonly animate = (time: number) => {
    if (!this.enabled) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    if (!this.paused && time - this.lastStep >= 32) {
      this.stepSimulation();
      this.lastStep = time;
      this.render();
    }
  };

  private stepSimulation(): void {
    this.tick += 1;
    this.moved.fill(0);
    for (let y = this.rows - 2; y >= 0; y -= 1) {
      const reverse = (this.tick + y) % 2 === 0;
      for (let offset = 0; offset < this.columns; offset += 1) {
        const x = reverse ? this.columns - 1 - offset : offset;
        const index = this.index(x, y);
        if (this.moved[index]) continue;
        const material = this.cells[index];
        if (material === materialIds.sand) this.updateSand(x, y, index);
        else if (material === materialIds.water) this.updateWater(x, y, index);
        else if (material === materialIds.seed) this.updateSeed(x, y, index);
        else if (material === materialIds.plant) this.updatePlant(x, y);
      }
    }
    for (let y = 1; y < this.rows; y += 1) {
      for (let x = 0; x < this.columns; x += 1) {
        const index = this.index(x, y);
        if (this.moved[index]) continue;
        const material = this.cells[index];
        if (material === materialIds.fire) this.updateFire(x, y, index);
        else if (material === materialIds.wind) this.updateWind(x, y, index);
        else if (material === materialIds.mist) this.updateMist(x, y, index);
      }
    }
  }

  private updateSand(x: number, y: number, index: number): void {
    const below = this.index(x, y + 1);
    if (this.isLooseSpace(below)) { this.move(index, below, true); return; }
    const direction = (x + y + this.tick) % 2 === 0 ? -1 : 1;
    for (const dx of [direction, -direction]) {
      if (!this.inBounds(x + dx, y + 1)) continue;
      const diagonal = this.index(x + dx, y + 1);
      if (this.isLooseSpace(diagonal)) { this.move(index, diagonal, true); return; }
    }
  }

  private updateWater(x: number, y: number, index: number): void {
    const below = this.index(x, y + 1);
    if (this.isAir(below)) { this.move(index, below); return; }
    const direction = (x * 3 + y + this.tick) % 2 === 0 ? -1 : 1;
    for (const dx of [direction, -direction]) {
      if (!this.inBounds(x + dx, y)) continue;
      const side = this.index(x + dx, y);
      if (this.isAir(side)) { this.move(index, side); return; }
    }
  }

  private updateSeed(x: number, y: number, index: number): void {
    if (y + 1 < this.rows && this.cells[this.index(x, y + 1)] === 0) {
      this.move(index, this.index(x, y + 1));
      return;
    }
    const supported = y + 1 < this.rows && [materialIds.sand, materialIds.stone, materialIds.plant].includes(this.cells[this.index(x, y + 1)] ?? 0);
    if (supported && this.tick % 16 === 0 && this.findNeighbor(x, y, materialIds.water, 3) !== -1) {
      this.cells[index] = materialIds.plant;
      if (y > 0 && this.cells[this.index(x, y - 1)] === 0) {
        const above = this.index(x, y - 1);
        this.cells[above] = materialIds.plant;
        this.energy[above] = 100;
      }
    }
  }

  private updatePlant(x: number, y: number): void {
    if ((this.tick + x * 7 + y) % 53 !== 0 || y === 0) return;
    if (this.findNeighbor(x, y, materialIds.water, 4) === -1) return;
    const above = this.index(x, y - 1);
    if (this.cells[above] === 0) {
      this.cells[above] = materialIds.plant;
      this.energy[above] = 100;
    }
  }

  private updateFire(x: number, y: number, index: number): void {
    const currentEnergy = Math.max(0, (this.energy[index] ?? 0) - 1);
    this.energy[index] = currentEnergy;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (!this.inBounds(x + dx, y + dy)) continue;
        const neighbor = this.index(x + dx, y + dy);
        if (this.cells[neighbor] === materialIds.plant || this.cells[neighbor] === materialIds.seed) {
          this.cells[neighbor] = materialIds.fire;
          this.energy[neighbor] = 88;
        } else if (this.cells[neighbor] === materialIds.water) {
          this.cells[neighbor] = materialIds.mist;
          this.energy[neighbor] = 75;
          this.energy[index] = Math.max(0, currentEnergy - 18);
        }
      }
    }
    if (this.energy[index] === 0) { this.cells[index] = 0; return; }
    const above = this.index(x, y - 1);
    if (this.isAir(above) && (x + y + this.tick) % 3 !== 0) this.move(index, above);
  }

  private updateWind(x: number, y: number, index: number): void {
    this.energy[index] = Math.max(0, (this.energy[index] ?? 0) - 1);
    if (this.energy[index] === 0) { this.cells[index] = 0; return; }
    const targetX = x + this.windDirection;
    if (!this.inBounds(targetX, y)) { this.cells[index] = 0; return; }
    const target = this.index(targetX, y);
    if (this.cells[target] === 0) this.move(index, target);
    else if ([materialIds.sand, materialIds.water, materialIds.fire, materialIds.mist].includes(this.cells[target] ?? 0) && this.inBounds(targetX + this.windDirection, y)) {
      const beyond = this.index(targetX + this.windDirection, y);
      if (this.cells[beyond] === 0) {
        this.move(target, beyond);
        this.move(index, target);
      }
    }
  }

  private updateMist(x: number, y: number, index: number): void {
    this.energy[index] = Math.max(0, (this.energy[index] ?? 0) - 1);
    if (this.energy[index] === 0) { this.cells[index] = 0; return; }
    const direction = (x + this.tick) % 2 === 0 ? -1 : 1;
    for (const dx of [0, direction]) {
      if (!this.inBounds(x + dx, y - 1)) continue;
      const target = this.index(x + dx, y - 1);
      if (this.cells[target] === 0) { this.move(index, target); return; }
    }
  }

  private move(from: number, to: number, swap = false): void {
    const targetMaterial = this.cells[to] ?? 0;
    const targetEnergy = this.energy[to] ?? 0;
    this.cells[to] = this.cells[from] ?? 0;
    this.energy[to] = this.energy[from] ?? 0;
    this.cells[from] = swap ? targetMaterial : 0;
    this.energy[from] = swap ? targetEnergy : 0;
    this.moved[to] = 1;
  }

  private isAir(index: number): boolean {
    const material = this.cells[index] ?? 0;
    return material === 0 || material === materialIds.wind || material === materialIds.mist;
  }

  private isLooseSpace(index: number): boolean {
    const material = this.cells[index] ?? 0;
    return this.isAir(index) || material === materialIds.water;
  }

  private findNeighbor(x: number, y: number, material: number, radius: number): number {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (!this.inBounds(x + dx, y + dy)) continue;
        const index = this.index(x + dx, y + dy);
        if (this.cells[index] === material) return index;
      }
    }
    return -1;
  }

  private gridPoint(event: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(this.columns - 1, Math.floor((event.clientX - rect.left) / rect.width * this.columns))),
      y: Math.max(0, Math.min(this.rows - 1, Math.floor((event.clientY - rect.top) / rect.height * this.rows))),
    };
  }

  private loadElements(artwork: Artwork): void {
    this.cells.fill(0);
    this.energy.fill(0);
    for (const element of artwork.elements) {
      const x = Math.max(0, Math.min(this.columns - 1, Math.floor(element.x / CELL_SIZE)));
      const y = Math.max(0, Math.min(this.rows - 1, Math.floor(element.y / CELL_SIZE)));
      const index = this.index(x, y);
      this.cells[index] = materialIds[element.material];
      this.energy[index] = element.energy;
    }
  }

  private syncElements(): void {
    this.artwork.elements = [];
    for (let index = 0; index < this.cells.length; index += 1) {
      const materialId = this.cells[index] ?? 0;
      if (materialId === 0) continue;
      const material = idMaterials[materialId];
      if (!material) continue;
      this.artwork.elements.push({
        x: (index % this.columns) * CELL_SIZE + CELL_SIZE / 2,
        y: Math.floor(index / this.columns) * CELL_SIZE + CELL_SIZE / 2,
        material,
        energy: this.energy[index] ?? 100,
      });
    }
  }

  private pushHistory(): void {
    this.syncElements();
    this.undoStack.push(cloneArtwork(this.artwork));
    if (this.undoStack.length > 24) this.undoStack.shift();
    this.redoStack = [];
    this.updateControls();
  }

  private undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.syncElements();
    this.redoStack.push(cloneArtwork(this.artwork));
    this.artwork = previous;
    this.loadElements(this.artwork);
    this.render();
    this.updateControls();
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.syncElements();
    this.undoStack.push(cloneArtwork(this.artwork));
    this.artwork = next;
    this.loadElements(this.artwork);
    this.render();
    this.updateControls();
  }

  private reset(): void {
    this.pushHistory();
    this.artwork = cloneArtwork(this.baseline);
    this.loadElements(this.artwork);
    this.render();
  }

  private togglePause(): void {
    this.paused = !this.paused;
    const button = this.host.querySelector<HTMLButtonElement>("#pause-simulation");
    const status = this.host.querySelector<HTMLElement>(".simulation-status span");
    this.host.classList.toggle("simulation-paused", this.paused);
    if (button) button.innerHTML = this.paused ? "▶ <span>Resume</span>" : "Ⅱ <span>Pause</span>";
    if (button) button.setAttribute("aria-label", this.paused ? "Resume simulation" : "Pause simulation");
    if (status) status.textContent = this.paused ? "World paused" : "World alive";
  }

  private render(): void {
    this.renderer.render(this.artwork, undefined, { columns: this.columns, rows: this.rows, cells: this.cells, energy: this.energy });
  }

  private updateControls(): void {
    const undo = this.host.querySelector<HTMLButtonElement>("#undo");
    const redo = this.host.querySelector<HTMLButtonElement>("#redo");
    if (undo) undo.disabled = this.undoStack.length === 0;
    if (redo) redo.disabled = this.redoStack.length === 0;
  }

  private index(x: number, y: number): number { return y * this.columns + x; }
  private inBounds(x: number, y: number): boolean { return x >= 0 && x < this.columns && y >= 0 && y < this.rows; }
}
