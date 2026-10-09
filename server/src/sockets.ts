import type { Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { config } from "./config.js";
import { verifyToken } from "./auth.js";
import { db } from "./db.js";
import {
  includeGame,
  sanitizeGame,
  ready,
  callNumber,
  requestRematch,
  respondRematch,
  cleanup,
} from "./games.js";
import { connect, disconnect } from "./presence.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";
import type { ClientEvents, ServerEvents, Ack } from "../../shared/types.js";
interface SocketData {
  userId: string;
}
export type GameIO = Server<
  ClientEvents,
  ServerEvents,
  Record<string, never>,
  SocketData
>;
const pendingTasks = new WeakMap<GameIO, Set<Promise<unknown>>>();
function background(io: GameIO, job: Promise<unknown>) {
  const pending = pendingTasks.get(io) ?? new Set<Promise<unknown>>();
  pendingTasks.set(io, pending);
  const tracked = job
    .catch((e) => logger.error({ err: e }, "socket background task failed"))
    .finally(() => pending.delete(tracked));
  pending.add(tracked);
}
export async function drainSocketTasks(io: GameIO) {
  const pending = pendingTasks.get(io);
  while (pending?.size) await Promise.all([...pending]);
}
export const gameIdSchema = z.object({ gameId: z.uuid() });
export const readySchema = gameIdSchema.extend({
  cells: z.array(z.number().int().min(1).max(40)).length(25).optional(),
});
export const callSchema = gameIdSchema.extend({
  number: z.number().int().min(1).max(40),
});
export const responseSchema = gameIdSchema.extend({ accept: z.boolean() });
export async function broadcast(io: GameIO, id: string) {
  const g = await db.game.findUnique({ where: { id }, include: includeGame });
  if (!g) return;
  for (const p of g.players)
    io.to(`user:${p.userId}`).emit("game:state", sanitizeGame(g, p.userId));
}
export function announceMatch(io: GameIO, id: string, users: string[]) {
  for (const user of users)
    io.to(`user:${user}`).emit("match:found", { gameId: id });
}
export function attachSockets(http: HttpServer) {
  const io: GameIO = new Server(http, {
    cors: { origin: new URL(config.WEBAPP_URL).origin },
    maxHttpBufferSize: 16384,
    allowRequest: (req, callback) =>
      callback(
        null,
        !req.headers.origin ||
          req.headers.origin === new URL(config.WEBAPP_URL).origin,
      ),
  });
  io.use(async (socket, next) => {
    try {
      socket.data.userId = await verifyToken(
        z.string().max(4096).parse(socket.handshake.auth.token),
      );
      if (
        !(await db.user.findUnique({
          where: { id: socket.data.userId },
          select: { id: true },
        }))
      )
        throw new AppError(401, "INVALID_AUTH");
      next();
    } catch {
      next(new Error("INVALID_AUTH"));
    }
  });
  io.on("connection", (socket) => {
    const id = socket.data.userId;
    connect(id, socket.id);
    void socket.join(`user:${id}`);
    logger.info({ userId: id }, "socket connected");
    let tokens = 12,
      last = Date.now();
    const rate = () => {
      const now = Date.now();
      tokens = Math.min(12, tokens + ((now - last) / 1000) * 2);
      last = now;
      if (tokens < 1) throw new AppError(429, "RATE_LIMITED");
      tokens--;
    };
    const run = async (
      ack: ((result: Ack) => void) | undefined,
      fn: () => Promise<string>,
    ) => {
      try {
        rate();
        const gameId = await fn();
        await broadcast(io, gameId);
        if (typeof ack === "function") ack({ ok: true, gameId });
      } catch (e) {
        const error =
          e instanceof AppError
            ? e.code
            : e instanceof z.ZodError
              ? "INVALID_INPUT"
              : "SERVER_ERROR";
        if (error === "SERVER_ERROR")
          logger.error({ err: e }, "socket event failed");
        if (typeof ack === "function") ack({ ok: false, error });
        else socket.emit("error", { message: error });
      }
    };
    socket.on("game:join", (payload, ack) => {
      void run(ack, async () => {
        const { gameId } = gameIdSchema.parse(payload);
        const g = await db.game.findUnique({
          where: { id: gameId },
          include: includeGame,
        });
        if (!g) throw new AppError(404, "GAME_NOT_FOUND");
        sanitizeGame(g, id);
        await socket.join(`game:${gameId}`);
        return gameId;
      });
    });
    socket.on("game:ready", (payload, ack) => {
      void run(ack, () => {
        const d = readySchema.parse(payload);
        return ready(id, d.gameId, d.cells);
      });
    });
    socket.on("game:call-number", (payload, ack) => {
      void run(ack, () => {
        const d = callSchema.parse(payload);
        return callNumber(id, d.gameId, d.number);
      });
    });
    socket.on("game:rematch-request", (payload, ack) => {
      void run(ack, () =>
        requestRematch(id, gameIdSchema.parse(payload).gameId),
      );
    });
    socket.on("game:rematch-response", (payload, ack) => {
      void run(ack, async () => {
        const d = responseSchema.parse(payload),
          r = await respondRematch(id, d.gameId, d.accept);
        if (r.newGameId) {
          await broadcast(io, r.newGameId);
          announceMatch(
            io,
            r.newGameId,
            (
              await db.gamePlayer.findMany({ where: { gameId: r.newGameId } })
            ).map((p) => p.userId),
          );
        }
        return r.gameId;
      });
    });
    background(io, syncPresence(io, id));
    socket.on("disconnect", () => {
      disconnect(id, socket.id);
      background(
        io,
        db.user
          .updateMany({ where: { id }, data: { lastSeenAt: new Date() } })
          .catch((e) => logger.error({ err: e }, "presence write failed")),
      );
      background(io, syncPresence(io, id));
    });
  });
  return io;
}
async function syncPresence(io: GameIO, id: string) {
  try {
    const p = await db.gamePlayer.findMany({
      where: {
        userId: id,
        game: { status: { in: ["WAITING", "ACTIVE", "PAUSED"] } },
      },
      select: { gameId: true },
    });
    const updated = await cleanup();
    for (const gameId of new Set([...updated, ...p.map((p) => p.gameId)]))
      await broadcast(io, gameId);
  } catch (e) {
    logger.error({ err: e }, "presence sync failed");
  }
}
export type GameSocket = Socket<
  ClientEvents,
  ServerEvents,
  Record<string, never>,
  SocketData
>;
