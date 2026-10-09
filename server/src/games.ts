import { randomInt } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { db } from "./db.js";
import { config } from "./config.js";
import { requireCondition, AppError } from "./errors.js";
import {
  generateBoard,
  validateBoard,
  calculateCompletedLines,
  calculateWinner,
  validateNumberCall,
  calculateElo,
  unlockedAchievements,
} from "./engine.js";
import { online, offlineDuration } from "./presence.js";
import type { GameView, PublicUser } from "../../shared/types.js";
import { logger } from "./logger.js";
export const includeGame = {
  players: {
    include: { user: true, board: true },
    orderBy: { seat: "asc" as const },
  },
  turns: { orderBy: { turnIndex: "asc" as const } },
} satisfies Prisma.GameInclude;
export type FullGame = Prisma.GameGetPayload<{ include: typeof includeGame }>;
type Tx = Prisma.TransactionClient;
// All v1 mutations share one transaction advisory lock. Works across processes,
// prevents membership, matchmaking, rating and turn races without retry ambiguity.
export async function atomic<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(9241403)`;
      return fn(tx);
    },
    { timeout: 15000, maxWait: 15000 },
  );
}
export function publicUser(u: User): PublicUser {
  return {
    id: u.id,
    firstName: u.firstName,
    username: u.username,
    photoUrl: u.photoUrl,
    rating: u.rating,
    xp: u.xp,
    level: u.level,
    wins: u.wins,
    losses: u.losses,
    draws: u.draws,
    gamesPlayed: u.gamesPlayed,
    currentWinStreak: u.currentWinStreak,
    bestWinStreak: u.bestWinStreak,
    totalLines: u.totalLines,
    totalTurns: u.totalTurns,
    createdAt: u.createdAt.toISOString(),
  };
}
export function sanitizeGame(g: FullGame, userId: string): GameView {
  requireCondition(
    g.players.some((p) => p.userId === userId),
    "FORBIDDEN",
    403,
  );
  const called = g.turns.map((t) => t.number),
    reveal = g.status === "FINISHED";
  return {
    id: g.id,
    publicCode: g.publicCode,
    type: g.type,
    boardMode: g.boardMode,
    status: g.status,
    numberMin: g.numberMin,
    numberMax: g.numberMax,
    boardSize: g.boardSize,
    winLines: g.winLines,
    diagonalEnabled: g.diagonalEnabled,
    currentPlayerId: g.currentPlayerId,
    firstPlayerId: g.firstPlayerId,
    winnerId: g.winnerId,
    result: g.result,
    rulesVersion: g.rulesVersion,
    startedAt: g.startedAt?.toISOString() ?? null,
    finishedAt: g.finishedAt?.toISOString() ?? null,
    createdAt: g.createdAt.toISOString(),
    turnDeadline: g.turnDeadline?.toISOString() ?? null,
    rematchRequestedBy: g.rematchRequestedBy,
    rematchGameId: g.rematchGameId,
    inviteUrl: config.BOT_USERNAME
      ? `https://t.me/${config.BOT_USERNAME}?startapp=game_${g.publicCode}`
      : null,
    turns: g.turns.map((t) => ({
      number: t.number,
      turnIndex: t.turnIndex,
      userId: t.userId,
      createdAt: t.createdAt.toISOString(),
    })),
    players: g.players.map((p) => {
      const visible = p.userId === userId || reveal;
      return {
        id: p.id,
        user: publicUser(p.user),
        seat: p.seat,
        isReady: p.isReady,
        lineCount: p.lineCount,
        online: online(p.userId),
        ratingBefore: p.ratingBefore,
        ratingAfter: p.ratingAfter,
        ratingDelta: p.ratingDelta,
        ...(visible && p.board ? { board: p.board.cells } : {}),
        completedLines:
          visible && p.board
            ? calculateCompletedLines(
                p.board.cells,
                called,
                g.boardSize,
                g.diagonalEnabled,
              )
            : [],
      };
    }),
  };
}
async function load(tx: Tx, id: string, userId?: string) {
  const g = await tx.game.findUnique({ where: { id }, include: includeGame });
  requireCondition(g, "GAME_NOT_FOUND", 404);
  if (userId)
    requireCondition(
      g.players.some((p) => p.userId === userId),
      "FORBIDDEN",
      403,
    );
  return g;
}
async function allowed(tx: Tx, userId: string) {
  const u = await tx.user.findUnique({ where: { id: userId } });
  requireCondition(u, "INVALID_AUTH", 401);
  requireCondition(!u.isBanned, "BANNED", 403);
  return u;
}
async function available(tx: Tx, userId: string) {
  await allowed(tx, userId);
  const live = await tx.gamePlayer.findFirst({
    where: {
      userId,
      game: { status: { in: ["WAITING", "ACTIVE", "PAUSED"] } },
    },
  });
  requireCondition(!live, "ALREADY_IN_GAME", 409);
}
async function code(tx: Tx) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 10; attempt++) {
    const c = Array.from(
      { length: 8 },
      () => alphabet[randomInt(alphabet.length)],
    ).join("");
    if (
      !(await tx.game.findUnique({
        where: { publicCode: c },
        select: { id: true },
      }))
    )
      return c;
  }
  throw new AppError(503, "TRY_AGAIN");
}
export interface GameSettings {
  boardMode?: "RANDOM" | "MANUAL";
  winLines?: number;
  diagonalEnabled?: boolean;
}
async function create(
  tx: Tx,
  users: string[],
  type: "FRIEND" | "QUICK",
  settings: GameSettings,
  firstPlayerId?: string,
) {
  const g = await tx.game.create({
    data: {
      publicCode: await code(tx),
      type,
      boardMode: settings.boardMode ?? "RANDOM",
      winLines: settings.winLines ?? config.WIN_LINES,
      diagonalEnabled: settings.diagonalEnabled ?? false,
      boardSize: config.BOARD_SIZE,
      numberMin: config.NUMBER_MIN,
      numberMax: config.NUMBER_MAX,
      firstPlayerId,
    },
  });
  for (const [seat, userId] of users.entries())
    await tx.gamePlayer.create({
      data: {
        gameId: g.id,
        userId,
        seat: seat + 1,
        board:
          g.boardMode === "RANDOM"
            ? {
                create: {
                  cells: generateBoard(g.boardSize, g.numberMin, g.numberMax),
                },
              }
            : undefined,
      },
    });
  await tx.matchmakingEntry.deleteMany({ where: { userId: { in: users } } });
  logger.info({ gameId: g.id, type }, "game created");
  return g.id;
}
export async function createFriend(userId: string, settings: GameSettings) {
  return atomic(async (tx) => {
    await available(tx, userId);
    return create(tx, [userId], "FRIEND", settings);
  });
}
export async function joinFriend(userId: string, publicCode: string) {
  return atomic(async (tx) => {
    await allowed(tx, userId);
    const g = await tx.game.findUnique({
      where: { publicCode },
      include: includeGame,
    });
    requireCondition(g, "GAME_NOT_FOUND", 404);
    if (g.players.some((p) => p.userId === userId)) return g.id;
    requireCondition(
      g.status === "WAITING" && g.players.length < 2,
      "ROOM_FULL",
      409,
    );
    requireCondition(
      Date.now() - g.createdAt.getTime() < config.LOBBY_TTL_SECONDS * 1000,
      "LOBBY_EXPIRED",
      409,
    );
    await available(tx, userId);
    await tx.gamePlayer.create({
      data: {
        gameId: g.id,
        userId,
        seat: 2,
        board:
          g.boardMode === "RANDOM"
            ? {
                create: {
                  cells: generateBoard(g.boardSize, g.numberMin, g.numberMax),
                },
              }
            : undefined,
      },
    });
    await tx.matchmakingEntry.deleteMany({ where: { userId } });
    return g.id;
  });
}
export async function ready(userId: string, id: string, cells?: number[]) {
  return atomic(async (tx) => {
    await allowed(tx, userId);
    const g = await load(tx, id, userId);
    requireCondition(g.status === "WAITING", "GAME_NOT_WAITING", 409);
    const p = g.players.find((p) => p.userId === userId)!;
    if (p.isReady) return id;
    if (g.boardMode === "MANUAL") {
      requireCondition(cells, "INVALID_BOARD");
      validateBoard(cells, g.boardSize, g.numberMin, g.numberMax);
      await tx.board.create({
        data: { gamePlayerId: p.id, cells, lockedAt: new Date() },
      });
    } else {
      requireCondition(p.board, "INVALID_BOARD");
      await tx.board.update({
        where: { gamePlayerId: p.id },
        data: { lockedAt: new Date() },
      });
    }
    await tx.gamePlayer.update({
      where: { id: p.id },
      data: { isReady: true },
    });
    const fresh = await load(tx, id);
    if (
      fresh.players.length === 2 &&
      fresh.players.every((p) => p.isReady && p.board?.lockedAt)
    ) {
      const first = fresh.firstPlayerId ?? fresh.players[randomInt(2)].userId;
      const starts = new Date(Date.now() + 3000);
      await tx.game.update({
        where: { id },
        data: {
          status: "ACTIVE",
          currentPlayerId: first,
          firstPlayerId: first,
          startedAt: starts,
          turnDeadline: config.TURN_TIMER_SECONDS
            ? new Date(starts.getTime() + config.TURN_TIMER_SECONDS * 1000)
            : null,
        },
      });
    }
    return id;
  });
}
async function finish(
  tx: Tx,
  g: FullGame,
  winnerId: string | null,
  result: "WIN" | "DRAW" | "FORFEIT",
  counts: number[],
  turnCount: number,
) {
  requireCondition(
    g.status === "ACTIVE" || g.status === "PAUSED",
    "GAME_NOT_ACTIVE",
    409,
  );
  await tx.game.update({
    where: { id: g.id },
    data: {
      status: "FINISHED",
      winnerId,
      result,
      finishedAt: new Date(),
      turnDeadline: null,
    },
  });
  // Surrender before any number has been called yields a recorded result, but no competitive rewards.
  const competitive = result !== "FORFEIT" || turnCount >= 1;
  const a = g.players[0].user.rating,
    b = g.players[1].user.rating;
  const score =
    winnerId === null ? 0.5 : winnerId === g.players[0].userId ? 1 : 0;
  const ratings = competitive ? calculateElo(a, b, score) : [a, b];
  for (const [i, p] of g.players.entries()) {
    const won = p.userId === winnerId,
      draw = winnerId === null;
    await tx.gamePlayer.update({
      where: { id: p.id },
      data: {
        lineCount: counts[i],
        ratingBefore: p.user.rating,
        ratingAfter: ratings[i],
        ratingDelta: ratings[i] - p.user.rating,
      },
    });
    if (!competitive) continue;
    const streak = won ? p.user.currentWinStreak + 1 : 0;
    const xp = p.user.xp + 10 + (won ? 20 : draw ? 10 : 0);
    const user = await tx.user.update({
      where: { id: p.userId },
      data: {
        rating: ratings[i],
        xp,
        level: 1 + Math.floor(xp / 100),
        gamesPlayed: { increment: 1 },
        wins: { increment: won ? 1 : 0 },
        losses: { increment: !won && !draw ? 1 : 0 },
        draws: { increment: draw ? 1 : 0 },
        currentWinStreak: streak,
        bestWinStreak: Math.max(streak, p.user.bestWinStreak),
        totalLines: { increment: counts[i] },
        totalTurns: { increment: turnCount },
      },
    });
    for (const achievement of unlockedAchievements(
      user,
      won,
      counts[1 - i],
      turnCount,
    )) {
      await tx.achievement.upsert({
        where: { code: achievement },
        create: { code: achievement },
        update: {},
      });
      await tx.userAchievement.upsert({
        where: { userId_code: { userId: p.userId, code: achievement } },
        create: { userId: p.userId, code: achievement },
        update: {},
      });
    }
  }
  logger.info({ gameId: g.id, result, winnerId }, "game completed");
}
async function applyNumber(
  tx: Tx,
  g: FullGame,
  userId: string,
  number: number,
) {
  validateNumberCall(
    {
      status: g.status,
      currentPlayerId: g.currentPlayerId,
      called: g.turns.map((t) => t.number),
      min: g.numberMin,
      max: g.numberMax,
    },
    userId,
    number,
  );
  requireCondition(
    g.startedAt && g.startedAt.getTime() <= Date.now(),
    "COUNTDOWN",
    409,
  );
  requireCondition(
    g.players.length === 2 && g.players.every((p) => p.board?.lockedAt),
    "INVALID_BOARD",
    409,
  );
  const called = [...g.turns.map((t) => t.number), number];
  await tx.turn.create({
    data: { gameId: g.id, userId, number, turnIndex: g.turns.length + 1 },
  });
  const counts = g.players.map(
    (p) =>
      calculateCompletedLines(
        p.board!.cells,
        called,
        g.boardSize,
        g.diagonalEnabled,
      ).length,
  );
  for (const [i, p] of g.players.entries())
    await tx.gamePlayer.update({
      where: { id: p.id },
      data: { lineCount: counts[i] },
    });
  const winner = calculateWinner(counts[0], counts[1], g.winLines);
  if (winner !== null)
    await finish(
      tx,
      g,
      winner === "DRAW" ? null : g.players[winner].userId,
      winner === "DRAW" ? "DRAW" : "WIN",
      counts,
      called.length,
    );
  else
    await tx.game.update({
      where: { id: g.id },
      data: {
        currentPlayerId: g.players.find((p) => p.userId !== userId)!.userId,
        turnDeadline: config.TURN_TIMER_SECONDS
          ? new Date(Date.now() + config.TURN_TIMER_SECONDS * 1000)
          : null,
      },
    });
  return g.id;
}
export async function callNumber(userId: string, id: string, number: number) {
  return atomic(async (tx) => {
    await allowed(tx, userId);
    return applyNumber(tx, await load(tx, id, userId), userId, number);
  });
}
export async function leave(userId: string, id: string) {
  return atomic(async (tx) => {
    const g = await load(tx, id, userId);
    if (g.status === "WAITING")
      await tx.game.update({
        where: { id },
        data: { status: "CANCELLED", finishedAt: new Date() },
      });
    else if (g.status === "ACTIVE" || g.status === "PAUSED")
      await finish(
        tx,
        g,
        g.players.find((p) => p.userId !== userId)!.userId,
        "FORFEIT",
        g.players.map((p) => p.lineCount),
        g.turns.length,
      );
    else throw new AppError(409, "GAME_FINISHED");
    return id;
  });
}
export async function requestRematch(userId: string, id: string) {
  return atomic(async (tx) => {
    await allowed(tx, userId);
    const g = await load(tx, id, userId);
    requireCondition(g.status === "FINISHED", "GAME_NOT_FINISHED", 409);
    requireCondition(!g.rematchGameId, "REMATCH_EXISTS", 409);
    if (g.rematchRequestedBy && g.rematchRequestedBy !== userId)
      throw new AppError(409, "REMATCH_PENDING");
    await tx.game.update({
      where: { id },
      data: { rematchRequestedBy: userId },
    });
    return id;
  });
}
export async function respondRematch(
  userId: string,
  id: string,
  accept: boolean,
) {
  return atomic(async (tx) => {
    await allowed(tx, userId);
    const g = await load(tx, id, userId);
    requireCondition(
      g.status === "FINISHED" &&
        g.rematchRequestedBy &&
        g.rematchRequestedBy !== userId,
      "NO_REMATCH_REQUEST",
      409,
    );
    if (!accept) {
      await tx.game.update({
        where: { id },
        data: { rematchRequestedBy: null },
      });
      return { gameId: id, newGameId: null };
    }
    if (g.rematchGameId) return { gameId: id, newGameId: g.rematchGameId };
    for (const p of g.players) await available(tx, p.userId);
    const newGameId = await create(
      tx,
      g.players.map((p) => p.userId),
      g.type,
      {
        boardMode: g.boardMode,
        winLines: g.winLines,
        diagonalEnabled: g.diagonalEnabled,
      },
      g.players.find((p) => p.userId !== g.firstPlayerId)!.userId,
    );
    await tx.game.update({
      where: { id },
      data: { rematchGameId: newGameId, rematchRequestedBy: null },
    });
    return { gameId: id, newGameId };
  });
}
export async function matchmaking(userId: string) {
  return atomic(async (tx) => {
    await available(tx, userId);
    await tx.matchmakingEntry.deleteMany({
      where: {
        createdAt: {
          lt: new Date(Date.now() - config.QUEUE_TTL_SECONDS * 1000),
        },
      },
    });
    const entry = await tx.matchmakingEntry.findFirst({
      where: {
        userId: { not: userId },
        user: {
          isBanned: false,
          players: {
            none: { game: { status: { in: ["WAITING", "ACTIVE", "PAUSED"] } } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });
    if (entry) {
      const id = await create(tx, [entry.userId, userId], "QUICK", {});
      return { gameId: id, users: [entry.userId, userId] };
    }
    await tx.matchmakingEntry.upsert({
      where: { userId },
      create: { userId },
      update: { createdAt: new Date() },
    });
    return { gameId: null, users: [] };
  });
}
export async function cancelQueue(userId: string) {
  await atomic((tx) => tx.matchmakingEntry.deleteMany({ where: { userId } }));
}
export async function getGame(id: string, userId: string) {
  const g = await load(db, id, userId);
  return sanitizeGame(g, userId);
}
export async function liveGame(userId: string) {
  const p = await db.gamePlayer.findFirst({
    where: {
      userId,
      game: { status: { in: ["WAITING", "ACTIVE", "PAUSED"] } },
    },
    select: { gameId: true },
  });
  return p?.gameId ?? null;
}
export async function cleanup(): Promise<string[]> {
  return atomic(async (tx) => {
    const now = Date.now(),
      changed: string[] = [];
    await tx.matchmakingEntry.deleteMany({
      where: {
        createdAt: { lt: new Date(now - config.QUEUE_TTL_SECONDS * 1000) },
      },
    });
    const waiting = await tx.game.findMany({
      where: {
        status: "WAITING",
        createdAt: { lt: new Date(now - config.LOBBY_TTL_SECONDS * 1000) },
      },
      select: { id: true },
    });
    if (waiting.length) {
      await tx.game.updateMany({
        where: { id: { in: waiting.map((g) => g.id) } },
        data: { status: "CANCELLED", finishedAt: new Date() },
      });
      changed.push(...waiting.map((g) => g.id));
    }
    const games = await tx.game.findMany({
      where: { status: { in: ["ACTIVE", "PAUSED"] } },
      include: includeGame,
    });
    for (const g of games) {
      const durations = g.players.map((p) => offlineDuration(p.userId));
      if (durations.some((d) => d >= config.ABANDON_SECONDS)) {
        await tx.game.update({
          where: { id: g.id },
          data: {
            status: "CANCELLED",
            result: "ABANDONED",
            finishedAt: new Date(),
            turnDeadline: null,
          },
        });
        changed.push(g.id);
      } else if (
        g.status === "ACTIVE" &&
        durations.some((d) => d >= config.RECONNECT_GRACE_SECONDS)
      ) {
        await tx.game.update({
          where: { id: g.id },
          data: { status: "PAUSED", pausedAt: new Date(), turnDeadline: null },
        });
        changed.push(g.id);
      } else if (
        g.status === "PAUSED" &&
        g.players.every((p) => online(p.userId))
      ) {
        await tx.game.update({
          where: { id: g.id },
          data: {
            status: "ACTIVE",
            pausedAt: null,
            turnDeadline: config.TURN_TIMER_SECONDS
              ? new Date(now + config.TURN_TIMER_SECONDS * 1000)
              : null,
          },
        });
        changed.push(g.id);
      } else if (
        g.status === "ACTIVE" &&
        g.turnDeadline &&
        g.turnDeadline.getTime() <= now &&
        g.players.every((p) => online(p.userId))
      ) {
        const available = Array.from(
          { length: g.numberMax - g.numberMin + 1 },
          (_, i) => i + g.numberMin,
        ).filter((n) => !g.turns.some((t) => t.number === n));
        await applyNumber(
          tx,
          g,
          g.currentPlayerId!,
          available[randomInt(available.length)],
        );
        changed.push(g.id);
      }
    }
    return changed;
  });
}
export async function adminCancel(id: string) {
  return atomic(async (tx) => {
    const g = await load(tx, id);
    requireCondition(
      ["WAITING", "ACTIVE", "PAUSED"].includes(g.status),
      "GAME_FINISHED",
      409,
    );
    await tx.game.update({
      where: { id },
      data: {
        status: "CANCELLED",
        result: "ABANDONED",
        finishedAt: new Date(),
        turnDeadline: null,
      },
    });
    return id;
  });
}
export async function setBan(
  userId: string,
  isBanned: boolean,
  banReason: string,
) {
  return atomic(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId } });
    requireCondition(u, "USER_NOT_FOUND", 404);
    await tx.user.update({
      where: { id: userId },
      data: {
        isBanned,
        banReason: isBanned ? banReason : null,
        bannedAt: isBanned ? new Date() : null,
      },
    });
    await tx.matchmakingEntry.deleteMany({ where: { userId } });
    const ids: string[] = [];
    if (isBanned) {
      const live = await tx.game.findMany({
        where: {
          status: { in: ["WAITING", "ACTIVE", "PAUSED"] },
          players: { some: { userId } },
        },
        select: { id: true },
      });
      for (const g of live) {
        await tx.game.update({
          where: { id: g.id },
          data: {
            status: "CANCELLED",
            finishedAt: new Date(),
            result: "ABANDONED",
          },
        });
        ids.push(g.id);
      }
    }
    return ids;
  });
}
