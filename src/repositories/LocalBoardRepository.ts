import type { MemoryBoard } from "../models/types";
import { createId } from "../utils/ids";
import type { BoardRepository } from "./BoardRepository";

const KEY = "art-of-my-life:boards:v3";

function canAccessBoard(userId: string, board: MemoryBoard): boolean {
  return board.type === "personal" ? board.ownerId === userId : board.memberIds.includes(userId);
}

export class LocalBoardRepository implements BoardRepository {
  private read(): MemoryBoard[] {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as MemoryBoard[];
  }

  private write(boards: MemoryBoard[]): void {
    localStorage.setItem(KEY, JSON.stringify(boards));
  }

  seed(boards: MemoryBoard[]): void {
    if (this.read().length === 0) this.write(boards);
  }

  async getPersonalBoard(userId: string): Promise<MemoryBoard> {
    const board = this.read().find((item) => item.type === "personal" && item.ownerId === userId);
    if (!board) throw new Error("Your personal board could not be found.");
    return board;
  }

  async createPersonalBoard(ownerId: string, name: string): Promise<MemoryBoard> {
    const existing = this.read().find((item) => item.type === "personal" && item.ownerId === ownerId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const board: MemoryBoard = {
      id: createId("personal"),
      type: "personal",
      ownerId,
      name,
      memberIds: [ownerId],
      createdAt: now,
      updatedAt: now,
    };
    this.write([...this.read(), board]);
    return board;
  }

  async getSharedBoards(userId: string): Promise<MemoryBoard[]> {
    return this.read().filter((item) => item.type === "shared" && item.memberIds.includes(userId));
  }

  async getBoard(boardId: string, userId: string): Promise<MemoryBoard> {
    const board = await this.getBoardUnsafe(boardId);
    if (!canAccessBoard(userId, board)) throw new Error("This memory board is private.");
    return board;
  }

  async getBoardUnsafe(boardId: string): Promise<MemoryBoard> {
    const board = this.read().find((item) => item.id === boardId);
    if (!board) throw new Error("This memory board no longer exists.");
    return board;
  }

  async createSharedBoard(ownerId: string, name: string): Promise<MemoryBoard> {
    const now = new Date().toISOString();
    const board: MemoryBoard = {
      id: createId("board"),
      type: "shared",
      ownerId,
      name: name.trim(),
      memberIds: [ownerId],
      createdAt: now,
      updatedAt: now,
    };
    this.write([...this.read(), board]);
    return board;
  }

  async joinBoard(boardId: string, userId: string): Promise<void> {
    const boards = this.read();
    const board = boards.find((item) => item.id === boardId);
    if (!board || board.type !== "shared") throw new Error("This invitation is not valid.");
    if (!board.memberIds.includes(userId)) board.memberIds.push(userId);
    board.updatedAt = new Date().toISOString();
    this.write(boards);
  }
}
