import type { BoardInvitation, MemoryBoard } from "../models/types";

export interface InvitationService {
  createInvitation(boardId: string, userId: string): Promise<BoardInvitation>;
  getInvitation(token: string): Promise<BoardInvitation>;
  joinWithInvitation(token: string, userId: string): Promise<MemoryBoard>;
  revokeInvitation(invitationId: string, userId: string): Promise<void>;
}
