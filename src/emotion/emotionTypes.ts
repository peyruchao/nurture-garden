export type Emotion = "chaotic" | "heavy" | "quiet" | "intense" | "unclear";

export interface EmotionConfig {
  id: Emotion;
  displayName: string;
  symbol: string;
  description: string;
  palette: string[];
  backgroundColor: string;
  brushColors: string[];
  defaultBrushSize: number;
  initialStrokeCount: number;
  shapeDensity: number;
  worldScale: number;
  worldDensity: number;
  fogDensity: number;
  movementSpeed: number;
}

export interface EmotionClassificationResult {
  emotion: Emotion;
  confidence: number;
  source: "mock" | "ai";
}
