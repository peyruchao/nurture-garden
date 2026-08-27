export interface Point { x: number; y: number }

export interface Stroke {
  id: string;
  color: string;
  width: number;
  points: Point[];
}

export type ShapeType = "circle" | "rectangle" | "triangle";

export interface Shape {
  id: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  opacity: number;
}

export type ElementMaterial = "sand" | "water" | "seed" | "plant" | "wind" | "fire" | "stone" | "mist";

export interface ElementCell {
  x: number;
  y: number;
  material: ElementMaterial;
  energy: number;
}

export interface Artwork {
  width: number;
  height: number;
  background: string;
  strokes: Stroke[];
  shapes: Shape[];
  elements: ElementCell[];
  createdAt: number;
}

export const cloneArtwork = (artwork: Artwork): Artwork => structuredClone(artwork);
