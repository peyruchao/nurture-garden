import type { AvatarData } from "../models/types";

export interface AvatarProvider {
  getCurrentUserAvatar(): Promise<AvatarData>;
  getUserAvatar(userId: string): Promise<AvatarData>;
}
