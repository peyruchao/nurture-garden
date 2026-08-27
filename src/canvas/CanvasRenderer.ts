import type { Artwork, ElementMaterial, Shape } from "./artworkTypes";

export interface SimulationFrame {
  columns: number;
  rows: number;
  cells: Uint8Array;
  energy: Uint8Array;
}

export const materialIds: Record<ElementMaterial, number> = {
  sand: 1, water: 2, seed: 3, plant: 4, wind: 5, fire: 6, stone: 7, mist: 8,
};

export const idMaterials: ElementMaterial[] = ["sand", "sand", "water", "seed", "plant", "wind", "fire", "stone", "mist"];

export const materialColors: Record<ElementMaterial, string> = {
  sand: "#d5ac68", water: "#58a8c4", seed: "#a6a15d", plant: "#5b9c70",
  wind: "#d8e5e3", fire: "#f06838", stone: "#62636b", mist: "#a8c2ca",
};

export class CanvasRenderer {
  constructor(private readonly context: CanvasRenderingContext2D) {}

  render(artwork: Artwork, preview?: Shape, simulation?: SimulationFrame): void {
    const { context } = this;
    context.save();
    context.clearRect(0, 0, artwork.width, artwork.height);
    context.fillStyle = artwork.background;
    context.fillRect(0, 0, artwork.width, artwork.height);
    for (const shape of artwork.shapes) this.drawShape(shape);
    if (preview) this.drawShape(preview);
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of artwork.strokes) {
      if (!stroke.points.length) continue;
      context.beginPath();
      context.strokeStyle = stroke.color;
      context.lineWidth = stroke.width;
      context.moveTo(stroke.points[0]?.x ?? 0, stroke.points[0]?.y ?? 0);
      for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
      if (stroke.points.length === 1) context.lineTo(stroke.points[0]!.x + 0.1, stroke.points[0]!.y + 0.1);
      context.stroke();
    }
    if (simulation) this.drawSimulation(artwork, simulation);
    context.restore();
  }

  private drawSimulation(artwork: Artwork, simulation: SimulationFrame): void {
    const cellWidth = artwork.width / simulation.columns;
    const cellHeight = artwork.height / simulation.rows;
    for (let materialId = 1; materialId <= 8; materialId += 1) {
      const material = idMaterials[materialId] ?? "sand";
      this.context.fillStyle = materialColors[material];
      for (let index = 0; index < simulation.cells.length; index += 1) {
        if (simulation.cells[index] !== materialId) continue;
        const x = index % simulation.columns;
        const y = Math.floor(index / simulation.columns);
        const energy = simulation.energy[index] ?? 100;
        this.context.globalAlpha = material === "wind" || material === "mist" ? Math.max(0.16, energy / 150) : material === "water" ? 0.82 : 0.96;
        if (material === "wind") {
          this.context.fillRect(x * cellWidth, y * cellHeight + cellHeight * 0.4, cellWidth * 1.8, Math.max(1, cellHeight * 0.2));
        } else if (material === "fire") {
          this.context.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight * 1.25);
        } else {
          this.context.fillRect(x * cellWidth, y * cellHeight, cellWidth + 0.35, cellHeight + 0.35);
        }
      }
    }
    this.context.globalAlpha = 1;
  }

  private drawShape(shape: Shape): void {
    const context = this.context;
    context.save();
    context.translate(shape.x + shape.width / 2, shape.y + shape.height / 2);
    context.rotate(shape.rotation);
    context.globalAlpha = shape.opacity;
    context.fillStyle = shape.color;
    context.beginPath();
    if (shape.type === "circle") {
      context.ellipse(0, 0, Math.abs(shape.width / 2), Math.abs(shape.height / 2), 0, 0, Math.PI * 2);
    } else if (shape.type === "rectangle") {
      context.rect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
    } else {
      context.moveTo(0, -shape.height / 2);
      context.lineTo(shape.width / 2, shape.height / 2);
      context.lineTo(-shape.width / 2, shape.height / 2);
      context.closePath();
    }
    context.fill();
    context.restore();
  }
}
