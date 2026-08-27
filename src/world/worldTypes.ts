import type { Emotion } from "../emotion/emotionTypes";
import type { ElementMaterial } from "../canvas/artworkTypes";

export interface VectorDefinition { x: number; y: number; z: number }

export interface WorldObject {
  type: "box" | "sphere" | "cone" | "torus" | "fragment";
  position: VectorDefinition;
  scale: VectorDefinition;
  rotation: VectorDefinition;
  color: string;
  opacity: number;
  emissive?: string;
  sourceId?: string;
  elementMaterial?: ElementMaterial;
}

export interface WorldLight {
  type: "ambient" | "directional" | "point";
  color: string;
  intensity: number;
  position?: VectorDefinition;
}

export interface WorldDefinition {
  emotion: Emotion;
  backgroundColor: string;
  fogColor: string;
  fogDensity: number;
  groundColor: string;
  objects: WorldObject[];
  lights: WorldLight[];
  spawnPosition: VectorDefinition;
}
