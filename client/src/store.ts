import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { GameView, PublicUser } from "../../shared/types";
export type Locale = "uz" | "en" | "ru";
export interface Settings {
  language: Locale;
  sound: boolean;
  haptic: boolean;
  confirmNumber: boolean;
  theme: "auto" | "light" | "dark";
}
interface Preferences {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}
export const usePreferences = create<Preferences>()(
  persist(
    (set) => ({
      settings: {
        language: "uz",
        sound: true,
        haptic: true,
        confirmNumber: true,
        theme: "auto",
      },
      update: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
    }),
    { name: "bingo-preferences" },
  ),
);
interface Session {
  token: string | null;
  user: PublicUser | null;
  isAdmin: boolean;
  game: GameView | null;
  connection: "online" | "reconnecting" | "offline";
  set: (patch: Partial<Omit<Session, "set">>) => void;
}
export const useSession = create<Session>((set) => ({
  token: sessionStorage.getItem("bingo-token"),
  user: null,
  isAdmin: false,
  game: null,
  connection: "offline",
  set: (patch) => set(patch),
}));
