import type { Memory } from "../models/types";
import type { MemoryRepository } from "./MemoryRepository";

const KEY = "art-of-my-life:memories:v3";

export class LocalMemoryRepository implements MemoryRepository {
  private read(): Memory[] {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Memory[];
  }

  seed(memories: Memory[]): void {
    if (this.read().length === 0) localStorage.setItem(KEY, JSON.stringify(memories));
  }

  async getMemories(boardId: string): Promise<Memory[]> {
    return this.read()
      .filter((memory) => memory.boardId === boardId)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async createMemory(memory: Memory): Promise<Memory> {
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.read(), memory]));
    } catch {
      throw new Error("Browser storage is full. Try a smaller photograph or export an older memory first.");
    }
    return memory;
  }
}
