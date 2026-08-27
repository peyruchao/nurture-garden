import type { AvatarData } from "../models/types";
import type { AvatarProvider } from "./AvatarProvider";

export class ViverseAvatarProvider implements AvatarProvider {
  async getCurrentUserAvatar(): Promise<AvatarData> {
    throw new Error("VIVERSE Avatar SDK is not configured yet.");
  }

  async getUserAvatar(_userId: string): Promise<AvatarData> {
    throw new Error("VIVERSE Avatar SDK is not configured yet.");
  }
}
