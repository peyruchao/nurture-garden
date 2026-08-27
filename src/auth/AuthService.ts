import type { AvatarData, User } from "../models/types";

export type AuthMode = "guest" | "viverse";

export interface AuthSession {
  user: User;
  avatar: AvatarData;
  mode: AuthMode;
  accessToken?: string;
  appId?: string;
  expiresAt?: number;
}

export interface AuthService {
  restoreSession(): Promise<AuthSession | null>;
  signInAsGuest(): Promise<AuthSession>;
  signInWithViverse(): Promise<AuthSession | null>;
  signOut(): Promise<void>;
  getSession(): AuthSession | null;
  isViverseConfigured(): boolean;
}
