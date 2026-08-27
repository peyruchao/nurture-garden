import type { Artwork, ElementMaterial } from "../canvas/artworkTypes";
import { materialColors } from "../canvas/CanvasRenderer";
import type { Emotion } from "../emotion/emotionTypes";
import { SeededRandom } from "../utils/random";
import { worldTemplates } from "./WorldTemplates";
import type { WorldDefinition, WorldObject } from "./worldTypes";

export function artworkToWorld(artwork: Artwork, emotion: Emotion, seed = 2026): WorldDefinition {
  const random = new SeededRandom(seed);
  const objects: WorldObject[] = [];
  const mapX = (x: number) => (x / artwork.width - 0.5) * 42;
  const mapZ = (y: number) => (y / artwork.height - 0.5) * 40 - 6;

  for (const shape of artwork.shapes) {
    const size = Math.max(shape.width, shape.height) / Math.max(artwork.width, artwork.height) * 12;
    const type = shape.type === "circle" ? "sphere" : shape.type === "rectangle" ? "box" : "cone";
    const height = Math.max(0.5, size * (emotion === "heavy" ? 1.45 : 1));
    objects.push({
      type, position: { x: mapX(shape.x + shape.width / 2), y: height / 2 + (emotion === "chaotic" ? random.range(0, 4) : 0), z: mapZ(shape.y + shape.height / 2) },
      scale: { x: Math.max(0.35, shape.width / artwork.width * 13), y: height, z: Math.max(0.35, shape.height / artwork.height * 10) },
      rotation: { x: emotion === "chaotic" ? random.range(-0.5, 0.5) : 0, y: shape.rotation, z: emotion === "intense" ? random.range(-0.3, 0.3) : 0 },
      color: shape.color, opacity: shape.opacity, emissive: emotion === "intense" ? shape.color : undefined, sourceId: shape.id,
    });
  }

  let fragmentCount = 0;
  for (const stroke of artwork.strokes) {
    const step = Math.max(1, Math.ceil(stroke.points.length / 9));
    stroke.points.forEach((point, index) => {
      if (index % step !== 0 || fragmentCount >= 220) return;
      const width = Math.max(0.18, stroke.width / 13);
      objects.push({
        type: "fragment", position: { x: mapX(point.x), y: emotion === "quiet" ? 0.35 : random.range(0.35, emotion === "chaotic" ? 6 : 2.5), z: mapZ(point.y) },
        scale: { x: width * random.range(0.7, 1.5), y: width * random.range(1, 2.8), z: width * random.range(0.6, 1.3) },
        rotation: { x: random.range(-0.7, 0.7), y: random.range(0, Math.PI), z: random.range(-0.7, 0.7) },
        color: stroke.color, opacity: emotion === "unclear" ? 0.5 : 0.88, emissive: emotion === "intense" ? stroke.color : undefined, sourceId: stroke.id,
      });
      fragmentCount += 1;
    });
  }

  const elementTypes: Record<ElementMaterial, WorldObject["type"]> = {
    sand: "box", water: "sphere", seed: "cone", plant: "cone", wind: "torus", fire: "cone", stone: "box", mist: "sphere",
  };
  const grouped = new Map<ElementMaterial, typeof artwork.elements>();
  for (const element of artwork.elements) {
    const group = grouped.get(element.material) ?? [];
    group.push(element);
    grouped.set(element.material, group);
  }
  for (const [material, elements] of grouped) {
    const limit = material === "stone" ? 26 : 20;
    const step = Math.max(1, Math.ceil(elements.length / limit));
    for (let index = 0; index < elements.length; index += step) {
      const element = elements[index];
      if (!element || objects.length >= 270) break;
      const isPlant = material === "plant" || material === "seed";
      const isAir = material === "wind" || material === "mist";
      const isFire = material === "fire";
      const size = material === "stone" ? random.range(0.48, 0.86) : material === "water" ? random.range(0.38, 0.7) : random.range(0.3, 0.62);
      const height = isPlant ? random.range(1.3, 3.2) : isFire ? random.range(0.9, 2.1) : size;
      objects.push({
        type: elementTypes[material], position: { x: mapX(element.x), y: isAir ? random.range(2.2, 7.5) : height / 2 + (material === "water" ? 0.12 : 0), z: mapZ(element.y) },
        scale: { x: material === "wind" ? size * 2 : size, y: height, z: material === "water" ? size * 1.4 : size },
        rotation: { x: material === "wind" ? Math.PI / 2 : 0, y: random.range(0, Math.PI * 2), z: isPlant ? random.range(-0.12, 0.12) : 0 },
        color: materialColors[material], opacity: material === "wind" || material === "mist" ? 0.35 : material === "water" ? 0.68 : 0.9,
        emissive: isFire ? materialColors.fire : undefined, sourceId: `element-${material}-${index}`, elementMaterial: material,
      });
    }
  }
  return worldTemplates[emotion].decorate(artwork, objects, random);
}

export const generateWorld = artworkToWorld;
