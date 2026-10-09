import { describe, it, expect } from "vitest";
import {
  generateBoard,
  validateBoard,
  markBoard,
  calculateCompletedLines,
  calculateBingoProgress,
  calculateWinner,
  validateNumberCall,
  calculateElo,
  unlockedAchievements,
} from "../server/src/engine.js";
const board = Array.from({ length: 25 }, (_, i) => i + 1);
describe("authoritative game engine", () => {
  it("generates 25 distinct secure-shuffled numbers within 1–40", () => {
    for (let i = 0; i < 100; i++) {
      const b = generateBoard();
      expect(b).toHaveLength(25);
      expect(new Set(b).size).toBe(25);
      expect(b.every((n) => n >= 1 && n <= 40)).toBe(true);
    }
  });
  it("detects a row and a column and excludes diagonals by default", () => {
    expect(calculateCompletedLines(board, [1, 2, 3, 4, 5])).toEqual(["r0"]);
    expect(calculateCompletedLines(board, [1, 6, 11, 16, 21])).toEqual(["c0"]);
    expect(calculateCompletedLines(board, [1, 7, 13, 19, 25])).toEqual([]);
    expect(calculateCompletedLines(board, [1, 7, 13, 19, 25], 5, true)).toEqual(
      ["d0"],
    );
  });
  it("counts every unique line once even if calls are repeated", () => {
    expect(calculateCompletedLines(board, [1, 2, 3, 4, 5, 5, 5])).toEqual([
      "r0",
    ]);
  });
  it("one final cell completes a row and column together", () => {
    const called = [2, 3, 4, 5, 6, 11, 16, 21];
    expect(calculateCompletedLines(board, called)).toEqual([]);
    expect(calculateCompletedLines(board, [...called, 1])).toEqual([
      "r0",
      "c0",
    ]);
  });
  it("counts all ten lines on a full board", () =>
    expect(calculateCompletedLines(board, board)).toHaveLength(10));
  it("marks only globally called numbers", () =>
    expect(markBoard([1, 2, 3], [2, 40])).toEqual([false, true, false]));
  it("rejects incomplete, duplicated and out-of-range manual boards", () => {
    expect(() => validateBoard(board)).not.toThrow();
    expect(() => validateBoard(board.slice(1))).toThrow();
    expect(() => validateBoard(board.map(() => 1))).toThrow();
    expect(() => validateBoard([...board.slice(1), 41])).toThrow();
  });
  it("five lines wins and simultaneous five lines draws deterministically", () => {
    expect(calculateWinner(5, 4)).toBe(0);
    expect(calculateWinner(4, 5)).toBe(1);
    expect(calculateWinner(5, 7)).toBe("DRAW");
    expect(calculateWinner(4, 4)).toBe(null);
    expect(calculateWinner(3, 2, 3)).toBe(0);
    expect(calculateBingoProgress(3)).toEqual([true, true, true, false, false]);
  });
  it("rejects wrong turn, duplicate number, invalid number and inactive game", () => {
    const s = {
      status: "ACTIVE",
      currentPlayerId: "a",
      called: [17],
      min: 1,
      max: 40,
    };
    expect(() => validateNumberCall(s, "b", 18)).toThrow("WRONG_TURN");
    expect(() => validateNumberCall(s, "a", 17)).toThrow("NUMBER_CALLED");
    expect(() => validateNumberCall(s, "a", 41)).toThrow("INVALID_NUMBER");
    expect(() =>
      validateNumberCall({ ...s, status: "FINISHED" }, "a", 18),
    ).toThrow("GAME_NOT_ACTIVE");
    expect(() => validateNumberCall(s, "a", 18)).not.toThrow();
  });
  it("Elo is deterministic, zero sum and adjusts uneven draws", () => {
    expect(calculateElo(1000, 1000, 1)).toEqual([1016, 984]);
    expect(calculateElo(1000, 1000, 0.5)).toEqual([1000, 1000]);
    expect(calculateElo(1200, 1000, 0.5)).toEqual([1192, 1008]);
  });
  it("achievement conditions are server-derived", () => {
    expect(
      unlockedAchievements(
        { wins: 10, currentWinStreak: 3, gamesPlayed: 100 },
        true,
        0,
        22,
      ),
    ).toEqual([
      "FIRST_WIN",
      "10_WINS",
      "WIN_STREAK_3",
      "PERFECT_5_0",
      "FAST_WIN",
      "100_GAMES",
    ]);
  });
});
