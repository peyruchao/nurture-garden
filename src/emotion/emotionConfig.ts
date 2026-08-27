import type { Emotion, EmotionConfig } from "./emotionTypes";

export const emotionConfigs: Record<Emotion, EmotionConfig> = {
  chaotic: {
    id: "chaotic", displayName: "Chaotic", symbol: "✣", description: "Fragmented, restless, alive with motion.",
    palette: ["#160d24", "#e44b68", "#be3ab6", "#08080b", "#52648a"], backgroundColor: "#140f1d",
    brushColors: ["#ec526c", "#c342bd", "#7e59d1", "#1f2234", "#7085a8", "#f0d9e8"],
    defaultBrushSize: 7, initialStrokeCount: 12, shapeDensity: 8, worldScale: 1, worldDensity: 1, fogDensity: 0.022, movementSpeed: 4.2,
  },
  heavy: {
    id: "heavy", displayName: "Heavy", symbol: "●", description: "Deep, grounded, carrying quiet weight.",
    palette: ["#101827", "#25262c", "#4a3e59", "#34363c"], backgroundColor: "#11151d",
    brushColors: ["#26374f", "#3d4150", "#574764", "#17191e", "#747783", "#c1bbc5"],
    defaultBrushSize: 18, initialStrokeCount: 4, shapeDensity: 4, worldScale: 1.4, worldDensity: 0.65, fogDensity: 0.032, movementSpeed: 3.1,
  },
  quiet: {
    id: "quiet", displayName: "Quiet", symbol: "◯", description: "Spacious, still, with room to breathe.",
    palette: ["#172535", "#69777c", "#708c79", "#e5e2d8"], backgroundColor: "#18242a",
    brushColors: ["#8da6a0", "#76889a", "#d9d7ca", "#4c6768", "#a5afa7", "#334b54"],
    defaultBrushSize: 4, initialStrokeCount: 2, shapeDensity: 2, worldScale: 0.85, worldDensity: 0.35, fogDensity: 0.026, movementSpeed: 3.7,
  },
  intense: {
    id: "intense", displayName: "Intense", symbol: "▲", description: "Bright-edged, focused, impossible to ignore.",
    palette: ["#1c0c0b", "#ed3f25", "#ff8a26", "#da205d", "#080709"], backgroundColor: "#180b0c",
    brushColors: ["#ff4b2f", "#ff9429", "#e72b6f", "#f7d9b0", "#78152d", "#09080a"],
    defaultBrushSize: 9, initialStrokeCount: 10, shapeDensity: 6, worldScale: 1.1, worldDensity: 0.9, fogDensity: 0.018, movementSpeed: 4.5,
  },
  unclear: {
    id: "unclear", displayName: "Unclear", symbol: "≈", description: "Layered, shifting, not asking for an answer.",
    palette: ["#252a31", "#65717b", "#71647f", "#dce0df"], backgroundColor: "#20252b",
    brushColors: ["#82919c", "#7b6e8c", "#ccd3d4", "#4f5d69", "#a5a4b0", "#5b6571"],
    defaultBrushSize: 10, initialStrokeCount: 5, shapeDensity: 7, worldScale: 1, worldDensity: 0.7, fogDensity: 0.044, movementSpeed: 3.5,
  },
};

export const isEmotion = (value: string | null): value is Emotion =>
  value !== null && Object.prototype.hasOwnProperty.call(emotionConfigs, value);
