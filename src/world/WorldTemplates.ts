import type { Artwork } from "../canvas/artworkTypes";
import { emotionConfigs } from "../emotion/emotionConfig";
import type { Emotion } from "../emotion/emotionTypes";
import { darken } from "../utils/colorUtils";
import { SeededRandom } from "../utils/random";
import type { WorldDefinition, WorldLight, WorldObject } from "./worldTypes";

export interface WorldTemplate {
  emotion: Emotion;
  decorate(artwork: Artwork, objects: WorldObject[], random: SeededRandom): WorldDefinition;
}

const lights: Record<Emotion, WorldLight[]> = {
  chaotic: [
    { type: "ambient", color: "#79658c", intensity: 0.75 },
    { type: "point", color: "#ef3f6b", intensity: 22, position: { x: -10, y: 7, z: 4 } },
    { type: "point", color: "#664cff", intensity: 18, position: { x: 12, y: 5, z: -12 } },
  ],
  heavy: [{ type: "ambient", color: "#536078", intensity: 0.52 }, { type: "directional", color: "#8994ad", intensity: 1.2, position: { x: -5, y: 9, z: 3 } }],
  quiet: [{ type: "ambient", color: "#b6c9c6", intensity: 1.05 }, { type: "directional", color: "#dce8df", intensity: 1.7, position: { x: 3, y: 12, z: 6 } }],
  intense: [{ type: "ambient", color: "#6e271f", intensity: 0.7 }, { type: "point", color: "#ff5b2e", intensity: 35, position: { x: 0, y: 7, z: 2 } }, { type: "point", color: "#dc1759", intensity: 22, position: { x: -12, y: 4, z: -8 } }],
  unclear: [{ type: "ambient", color: "#a3acb5", intensity: 0.8 }, { type: "directional", color: "#b0a7c2", intensity: 0.8, position: { x: 5, y: 10, z: -2 } }],
};

class EmotionWorldTemplate implements WorldTemplate {
  constructor(public readonly emotion: Emotion) {}

  decorate(_artwork: Artwork, objects: WorldObject[], random: SeededRandom): WorldDefinition {
    const config = emotionConfigs[this.emotion];
    const ambientCount = this.emotion === "quiet" ? 3 : this.emotion === "heavy" ? 6 : 10;
    for (let index = 0; index < ambientCount; index += 1) {
      const type = this.emotion === "heavy" ? "box" : this.emotion === "intense" ? "cone" : this.emotion === "unclear" ? "torus" : "fragment";
      objects.push({
        type, position: { x: random.range(-28, 28), y: this.emotion === "chaotic" ? random.range(1, 9) : random.range(0.35, 2.4), z: random.range(-30, 18) },
        scale: { x: random.range(0.35, 1.8) * config.worldScale, y: random.range(0.5, 2.6) * config.worldScale, z: random.range(0.35, 1.8) * config.worldScale },
        rotation: { x: random.range(-0.4, 0.4), y: random.range(0, Math.PI), z: random.range(-0.4, 0.4) },
        color: random.pick(config.palette), opacity: this.emotion === "unclear" ? random.range(0.22, 0.48) : 0.7,
        emissive: this.emotion === "intense" ? random.pick(config.brushColors) : undefined,
      });
    }
    return {
      emotion: this.emotion, backgroundColor: darken(config.backgroundColor, 0.28), fogColor: config.backgroundColor,
      fogDensity: config.fogDensity, groundColor: darken(config.backgroundColor, 0.05), objects, lights: lights[this.emotion],
      spawnPosition: { x: 0, y: 1.65, z: 14 },
    };
  }
}

export const worldTemplates: Record<Emotion, WorldTemplate> = {
  chaotic: new EmotionWorldTemplate("chaotic"), heavy: new EmotionWorldTemplate("heavy"), quiet: new EmotionWorldTemplate("quiet"),
  intense: new EmotionWorldTemplate("intense"), unclear: new EmotionWorldTemplate("unclear"),
};
