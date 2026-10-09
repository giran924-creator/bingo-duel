import { randomInt } from "node:crypto";
import { AppError } from "./errors.js";
export function generateBoard(size = 5, min = 1, max = 40): number[] {
  if (size * size > max - min + 1) throw new Error("Insufficient numbers");
  const pool = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, size * size);
}
export function validateBoard(cells: number[], size = 5, min = 1, max = 40) {
  if (
    cells.length !== size * size ||
    new Set(cells).size !== cells.length ||
    cells.some((n) => !Number.isInteger(n) || n < min || n > max)
  )
    throw new AppError(400, "INVALID_BOARD");
}
export function markBoard(cells: number[], called: readonly number[]) {
  const set = new Set(called);
  return cells.map((n) => set.has(n));
}
export function calculateCompletedLines(
  cells: number[],
  called: readonly number[],
  size = 5,
  diagonals = false,
): string[] {
  const marks = markBoard(cells, called),
    lines: string[] = [];
  for (let i = 0; i < size; i++) {
    if (
      Array.from({ length: size }, (_, j) => marks[i * size + j]).every(Boolean)
    )
      lines.push(`r${i}`);
    if (
      Array.from({ length: size }, (_, j) => marks[j * size + i]).every(Boolean)
    )
      lines.push(`c${i}`);
  }
  if (diagonals) {
    if (
      Array.from({ length: size }, (_, i) => marks[i * size + i]).every(Boolean)
    )
      lines.push("d0");
    if (
      Array.from(
        { length: size },
        (_, i) => marks[i * size + size - 1 - i],
      ).every(Boolean)
    )
      lines.push("d1");
  }
  return lines;
}
export function calculateBingoProgress(lines: number, target = 5) {
  return "BINGO"
    .split("")
    .map((_, i) => lines >= Math.ceil(((i + 1) * target) / 5));
}
export function calculateWinner(
  a: number,
  b: number,
  target = 5,
): 0 | 1 | "DRAW" | null {
  return a >= target && b >= target
    ? "DRAW"
    : a >= target
      ? 0
      : b >= target
        ? 1
        : null;
}
export function validateNumberCall(
  state: {
    status: string;
    currentPlayerId: string | null;
    called: number[];
    min: number;
    max: number;
  },
  userId: string,
  n: number,
) {
  if (state.status !== "ACTIVE") throw new AppError(409, "GAME_NOT_ACTIVE");
  if (state.currentPlayerId !== userId) throw new AppError(403, "WRONG_TURN");
  if (!Number.isInteger(n) || n < state.min || n > state.max)
    throw new AppError(400, "INVALID_NUMBER");
  if (state.called.includes(n)) throw new AppError(409, "NUMBER_CALLED");
}
export function calculateElo(
  a: number,
  b: number,
  score: 0 | 0.5 | 1,
  k = 32,
): [number, number] {
  const delta = Math.round(k * (score - 1 / (1 + 10 ** ((b - a) / 400))));
  return [a + delta, b - delta];
}
export const achievementCodes = [
  "FIRST_WIN",
  "10_WINS",
  "50_WINS",
  "100_WINS",
  "WIN_STREAK_3",
  "WIN_STREAK_5",
  "WIN_STREAK_10",
  "PERFECT_5_0",
  "FAST_WIN",
  "100_GAMES",
] as const;
export function unlockedAchievements(
  u: { wins: number; currentWinStreak: number; gamesPlayed: number },
  won: boolean,
  otherLines: number,
  turns: number,
) {
  return achievementCodes.filter((c) => {
    switch (c) {
      case "FIRST_WIN":
        return u.wins >= 1;
      case "10_WINS":
        return u.wins >= 10;
      case "50_WINS":
        return u.wins >= 50;
      case "100_WINS":
        return u.wins >= 100;
      case "WIN_STREAK_3":
        return u.currentWinStreak >= 3;
      case "WIN_STREAK_5":
        return u.currentWinStreak >= 5;
      case "WIN_STREAK_10":
        return u.currentWinStreak >= 10;
      case "PERFECT_5_0":
        return won && otherLines === 0;
      case "FAST_WIN":
        return won && turns <= 25;
      case "100_GAMES":
        return u.gamesPlayed >= 100;
    }
  });
}
