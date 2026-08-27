import type { AvatarData } from "../models/types";
import type { AvatarProvider } from "./AvatarProvider";

const avatars: Record<string, AvatarData> = {
  peggy: { userId: "peggy", displayName: "Peggy", avatarUrl: "", palette: ["#efb7a9", "#894f75"] },
  michelle: { userId: "michelle", displayName: "Michelle", avatarUrl: "", palette: ["#d8b9ef", "#665ca8"] },
  david: { userId: "david", displayName: "David", avatarUrl: "", palette: ["#9ecac5", "#3f7384"] },
};

export class MockAvatarProvider implements AvatarProvider {
  async getCurrentUserAvatar(): Promise<AvatarData> {
    return avatars.peggy;
  }

  async getUserAvatar(userId: string): Promise<AvatarData> {
    return avatars[userId] ?? {
      userId,
      displayName: userId === "guest" ? "Alex" : "Memory Keeper",
      avatarUrl: "",
      palette: ["#f0cf91", "#916b6a"],
    };
  }
}
