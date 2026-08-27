import type { BoardInvitation, MemoryBoard } from "../models/types";
import type { BoardRepository } from "../repositories/BoardRepository";
import { createId, createToken } from "../utils/ids";
import type { InvitationService } from "./InvitationService";

const KEY = "art-of-my-life:invitations:v1";

export class LocalInvitationService implements InvitationService {
  constructor(private readonly boards: BoardRepository) {}

  private read(): BoardInvitation[] {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as BoardInvitation[];
  }

  private write(invitations: BoardInvitation[]): void {
    localStorage.setItem(KEY, JSON.stringify(invitations));
  }

  async createInvitation(boardId: string, userId: string): Promise<BoardInvitation> {
    const board = await this.boards.getBoard(boardId, userId);
    if (board.type !== "shared") throw new Error("Personal boards cannot be shared.");
    const existing = this.read().find((item) => item.boardId === boardId && !item.revoked);
    if (existing) return existing;
    const invitation: BoardInvitation = {
      id: createId("invite"),
      boardId,
      token: createToken(),
      createdBy: userId,
      createdAt: new Date().toISOString(),
      revoked: false,
    };
    this.write([...this.read(), invitation]);
    return invitation;
  }

  async getInvitation(token: string): Promise<BoardInvitation> {
    const invitation = this.read().find((item) => item.token === token);
    if (!invitation) throw new Error("This invitation link is not valid.");
    if (invitation.revoked) throw new Error("This invitation has been revoked.");
    if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
      throw new Error("This invitation has expired.");
    }
    return invitation;
  }

  async joinWithInvitation(token: string, userId: string): Promise<MemoryBoard> {
    const invitation = await this.getInvitation(token);
    await this.boards.joinBoard(invitation.boardId, userId);
    return this.boards.getBoard(invitation.boardId, userId);
  }

  async revokeInvitation(invitationId: string, userId: string): Promise<void> {
    const invitations = this.read();
    const invitation = invitations.find((item) => item.id === invitationId);
    if (!invitation) throw new Error("Invitation not found.");
    const board = await this.boards.getBoard(invitation.boardId, userId);
    if (board.ownerId !== userId) throw new Error("Only the board owner can revoke this invitation.");
    invitation.revoked = true;
    this.write(invitations);
  }
}
