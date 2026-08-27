export type AppState =
  | "EMOTION_INPUT"
  | "ANALYZING"
  | "CANVAS"
  | "GENERATING_WORLD"
  | "WORLD_PREVIEW"
  | "ENTERING_WORLD"
  | "WORLD";

const allowedTransitions: Record<AppState, AppState[]> = {
  EMOTION_INPUT: ["ANALYZING"],
  ANALYZING: ["CANVAS"],
  CANVAS: ["GENERATING_WORLD"],
  GENERATING_WORLD: ["WORLD_PREVIEW"],
  WORLD_PREVIEW: ["ENTERING_WORLD", "CANVAS"],
  ENTERING_WORLD: ["WORLD", "WORLD_PREVIEW"],
  WORLD: ["CANVAS"],
};

export class StateMachine {
  constructor(private current: AppState) {}

  get value(): AppState {
    return this.current;
  }

  transition(next: AppState): void {
    if (!allowedTransitions[this.current].includes(next)) {
      throw new Error(`Invalid transition: ${this.current} → ${next}`);
    }
    this.current = next;
  }
}
