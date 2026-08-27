import type { Emotion, EmotionClassificationResult } from "./emotionTypes";

export interface EmotionClassifier {
  classify(text: string): Promise<EmotionClassificationResult>;
}

const keywords: Record<Emotion, string[]> = {
  chaotic: ["overwhelmed", "messy", "too much", "confused", "everything", "scattered"],
  heavy: ["tired", "exhausted", "burden", "pressure", "sad", "heavy"],
  quiet: ["peaceful", "calm", "alone", "quiet", "empty", "still"],
  intense: ["angry", "excited", "frustrated", "passionate", "anxious", "energetic"],
  unclear: ["don't know", "dont know", "unsure", "strange", "weird", "numb", "nothing"],
};

export class MockEmotionClassifier implements EmotionClassifier {
  async classify(text: string): Promise<EmotionClassificationResult> {
    const normalized = text.toLowerCase();
    let best: Emotion = "unclear";
    let matches = 0;
    for (const [emotion, words] of Object.entries(keywords) as [Emotion, string[]][]) {
      const score = words.filter((word) => normalized.includes(word)).length;
      if (score > matches) {
        best = emotion;
        matches = score;
      }
    }
    return { emotion: best, confidence: matches ? Math.min(0.62 + matches * 0.1, 0.92) : 0.5, source: "mock" };
  }
}
