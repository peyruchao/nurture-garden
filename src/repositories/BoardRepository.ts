import type { MemoryBoard } from "../models/types";

export interface BoardRepository {
  getPersonalBoard(userId: string): Promise<MemoryBoard>;
  createPersonalBoard(ownerId: string, name: string): Promise<MemoryBoard>;
  getSharedBoards(userId: string): Promise<MemoryBoard[]>;
  getBoard(boardId: string, userId: string): Promise<MemoryBoard>;
  getBoardUnsafe(boardId: string): Promise<MemoryBoard>;
  createSharedBoard(ownerId: string, name: string): Promise<MemoryBoard>;
  joinBoard(boardId: string, userId: string): Promise<void>;
}
