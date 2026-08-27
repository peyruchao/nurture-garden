import type { Emotion } from "../emotion/emotionTypes";
import { emotionConfigs } from "../emotion/emotionConfig";
import { hashString, SeededRandom } from "../utils/random";
import type { Artwork, ElementMaterial, ShapeType } from "./artworkTypes";

const WIDTH = 900;
const HEIGHT = 560;

export function generateInitialArtwork(emotion: Emotion, demo = false): Artwork {
  const config = emotionConfigs[emotion];
  const random = new SeededRandom(hashString(`${emotion}-${demo ? "demo" : "initial"}`));
  const artwork: Artwork = { width: WIDTH, height: HEIGHT, background: config.backgroundColor, strokes: [], shapes: [], elements: [], createdAt: Date.now() };
  const shapeCount = demo ? Math.max(config.shapeDensity, emotion === "quiet" ? 2 : 6) : config.shapeDensity;
  const strokeCount = demo ? Math.max(config.initialStrokeCount, emotion === "quiet" ? 2 : 8) : config.initialStrokeCount;

  for (let index = 0; index < shapeCount; index += 1) {
    const large = emotion === "heavy" || (emotion === "quiet" && index === 0);
    const size = large ? random.range(130, 240) : random.range(35, 110);
    const types: ShapeType[] = emotion === "intense" ? ["triangle", "triangle", "circle"] : ["circle", "rectangle", "triangle"];
    artwork.shapes.push({
      id: `initial-shape-${index}`, type: random.pick(types), x: random.range(35, WIDTH - size - 35), y: random.range(30, HEIGHT - size - 30),
      width: size, height: size * random.range(0.65, 1.15), rotation: random.range(-0.8, 0.8), color: random.pick(config.brushColors),
      opacity: emotion === "unclear" ? random.range(0.25, 0.58) : random.range(0.58, 0.9),
    });
  }

  for (let index = 0; index < strokeCount; index += 1) {
    const pointCount = Math.floor(random.range(4, emotion === "chaotic" ? 10 : 7));
    const originX = random.range(40, WIDTH - 40);
    const originY = random.range(40, HEIGHT - 40);
    const points = Array.from({ length: pointCount }, (_, pointIndex) => ({
      x: Math.max(10, Math.min(WIDTH - 10, originX + (pointIndex - pointCount / 2) * random.range(16, 46))),
      y: Math.max(10, Math.min(HEIGHT - 10, originY + random.range(-70, 70))),
    }));
    artwork.strokes.push({
      id: `initial-stroke-${index}`, color: random.pick(config.brushColors),
      width: emotion === "heavy" ? random.range(15, 30) : emotion === "quiet" ? random.range(2, 6) : random.range(5, 13), points,
    });
  }
  generateInitialElements(artwork, emotion, random, demo);
  return artwork;
}

function generateInitialElements(artwork: Artwork, emotion: Emotion, random: SeededRandom, demo: boolean): void {
  const cellSize = 5;
  const columns = Math.floor(artwork.width / cellSize);
  const rows = Math.floor(artwork.height / cellSize);
  const occupied = new Set<string>();
  const add = (x: number, y: number, material: ElementMaterial, energy = 100) => {
    const column = Math.max(0, Math.min(columns - 1, Math.round(x)));
    const row = Math.max(0, Math.min(rows - 1, Math.round(y)));
    const key = `${column}:${row}`;
    if (occupied.has(key)) return;
    occupied.add(key);
    artwork.elements.push({ x: column * cellSize + cellSize / 2, y: row * cellSize + cellSize / 2, material, energy });
  };

  for (let x = 0; x < columns; x += 1) {
    const ridge = Math.round(Math.sin(x * 0.12) * 2 + (emotion === "heavy" ? 5 : 2));
    for (let y = rows - 1; y >= rows - 2 - ridge; y -= 1) add(x, y, emotion === "quiet" && y < rows - 2 ? "sand" : "stone");
  }

  const presets: Record<Emotion, ElementMaterial[]> = {
    chaotic: ["sand", "water", "wind", "fire"],
    heavy: ["stone", "sand", "water"],
    quiet: ["water", "seed", "sand"],
    intense: ["fire", "sand", "stone"],
    unclear: ["water", "wind", "mist", "seed"],
  };
  const clusterCount = demo ? 9 : 6;
  for (let cluster = 0; cluster < clusterCount; cluster += 1) {
    const material = random.pick(presets[emotion]);
    const centerX = random.range(12, columns - 12);
    const centerY = random.range(rows * 0.36, rows * 0.76);
    const radius = material === "water" ? random.range(5, 10) : random.range(3, 7);
    for (let index = 0; index < radius * 5; index += 1) {
      const angle = random.range(0, Math.PI * 2);
      const distance = Math.sqrt(random.next()) * radius;
      add(centerX + Math.cos(angle) * distance, centerY + Math.sin(angle) * distance, material, material === "fire" ? 90 : material === "wind" || material === "mist" ? 60 : 100);
    }
  }
}
