export interface User {
  id: string;
  displayName: string;
}

export interface MemoryBoard {
  id: string;
  type: "personal" | "shared";
  ownerId: string;
  name: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Memory {
  id: string;
  boardId: string;
  creatorId: string;
  contributorIds: string[];
  title: string;
  date: string;
  story: string;
  emotion?: string;
  originalPhotoUrl: string;
  artworkUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface BoardInvitation {
  id: string;
  boardId: string;
  token: string;
  createdBy: string;
  createdAt: string;
  expiresAt?: string;
  revoked: boolean;
}

export interface AvatarData {
  userId: string;
  displayName: string;
  avatarUrl: string;
  headIconUrl?: string;
  palette: [string, string];
  source?: "guest" | "viverse";
}
