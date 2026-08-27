import type { Memory } from "../models/types";

export interface MemoryRepository {
  getMemories(boardId: string): Promise<Memory[]>;
  createMemory(memory: Memory): Promise<Memory>;
}
