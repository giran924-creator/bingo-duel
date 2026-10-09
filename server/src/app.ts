import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import path from "node:path";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { db } from "./db.js";
import { authenticate, verifyToken } from "./auth.js";
import { AppError, requireCondition } from "./errors.js";
import * as games from "./games.js";
import { profile, leaderboard, sortFields } from "./profiles.js";
import { broadcast, announceMatch, type GameIO } from "./sockets.js";
import { onlineCount } from "./presence.js";
import { logger } from "./logger.js";
import { createBot, webhook } from "./bot.js";
export const settingsSchema = z.object({
  boardMode: z.enum(["RANDOM", "MANUAL"]).default("RANDOM"),
  winLines: z.number().int().min(1).max(10).default(config.WIN_LINES),
  diagonalEnabled: z.boolean().default(false),
});
const id = (r: Request) => z.uuid().parse(r.params.id);
const user = (r: Request) => String((r as Request & { userId: string }).userId);
export function createApp(getIo: () => GameIO | undefined = () => undefined) {
  const app = express();
  app.set("trust proxy", config.TRUST_PROXY);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "https://telegram.org"],
          connectSrc: ["'self'", "wss:"],
          imgSrc: ["'self'", "data:", "https:"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          frameAncestors: [
            "'self'",
            "https://web.telegram.org",
            "https://*.telegram.org",
          ],
        },
      },
      frameguard: false,
    }),
  );
  app.use(cors({ origin: new URL(config.WEBAPP_URL).origin }));
  app.use(express.json({ limit: "20kb" }));
  app.get("/health", async (_req, res) => {
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        version: "1.0.0",
      });
    } catch {
      res
        .status(503)
        .json({ status: "unavailable", timestamp: new Date().toISOString() });
    }
  });
  const bot = createBot();
  if (bot && config.BOT_MODE === "webhook")
    app.post("/telegram/webhook", webhook(bot));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "RATE_LIMITED" },
    }),
  );
  app.get("/api/config", (_r, res) =>
    res.json({
      data: {
        devAuth: config.NODE_ENV !== "production" && config.DEV_AUTH,
        version: "1.0.0",
        rulesVersion: "1.0",
        turnTimerSeconds: config.TURN_TIMER_SECONDS,
      },
    }),
  );
  app.post(
    "/api/auth",
    rateLimit({
      windowMs: 60000,
      limit: 20,
      message: { error: "RATE_LIMITED" },
    }),
    async (req, res) => {
      const { token, user: u } = await authenticate(req.body);
      res.json({ data: { token, user: games.publicUser(u) } });
    },
  );
  app.use("/api", async (req, _res, next) => {
    try {
      const header = req.headers.authorization;
      requireCondition(
        header && header.startsWith("Bearer "),
        "INVALID_AUTH",
        401,
      );
      const uid = await verifyToken(header.slice(7));
      requireCondition(
        await db.user.findUnique({ where: { id: uid }, select: { id: true } }),
        "INVALID_AUTH",
        401,
      );
      (req as Request & { userId: string }).userId = uid;
      next();
    } catch (e) {
      next(e);
    }
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 120,
      keyGenerator: (req) => user(req),
      message: { error: "RATE_LIMITED" },
    }),
  );
  const notify = async (gameId: string) => {
    const io = getIo();
    if (io) await broadcast(io, gameId);
  };
  app.get("/api/me", async (req, res) => {
    const u = await db.user.findUniqueOrThrow({ where: { id: user(req) } });
    const q = await db.matchmakingEntry.findUnique({ where: { userId: u.id } });
    res.json({
      data: {
        user: games.publicUser(u),
        isAdmin: config.adminIds.has(u.telegramId),
        isBanned: u.isBanned,
        banReason: u.banReason,
        liveGameId: await games.liveGame(u.id),
        queued: !!q,
      },
    });
  });
  app.get("/api/stats/me", async (req, res) =>
    res.json({ data: await profile(user(req)) }),
  );
  app.get("/api/profile/:id", async (req, res) =>
    res.json({ data: await profile(id(req)) }),
  );
  app.get("/api/leaderboard", async (req, res) =>
    res.json({
      data: await leaderboard(
        user(req),
        z.enum(sortFields).parse(req.query.sort ?? "rating"),
      ),
    }),
  );
  app.get("/api/me/history", async (req, res) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(10000)
      .parse(req.query.page ?? 1);
    const rows = await db.game.findMany({
      where: {
        status: { in: ["FINISHED", "CANCELLED"] },
        players: { some: { userId: user(req) } },
      },
      include: games.includeGame,
      orderBy: { finishedAt: "desc" },
      skip: (page - 1) * 20,
      take: 20,
    });
    res.json({ data: rows.map((g) => games.sanitizeGame(g, user(req))) });
  });
  app.post("/api/games/friend", async (req, res) => {
    const gameId = await games.createFriend(
      user(req),
      settingsSchema.parse(req.body),
    );
    await notify(gameId);
    res.status(201).json({ data: { gameId } });
  });
  app.post("/api/games/:code/join", async (req, res) => {
    const code = z
      .string()
      .regex(/^[A-Z2-9]{8}$/)
      .parse(req.params.code);
    const gameId = await games.joinFriend(user(req), code);
    await notify(gameId);
    res.json({ data: { gameId } });
  });
  app.get("/api/games/:id", async (req, res) =>
    res.json({ data: await games.getGame(id(req), user(req)) }),
  );
  app.post("/api/games/:id/ready", async (req, res) => {
    const data = z
      .object({ cells: z.array(z.number().int()).length(25).optional() })
      .parse(req.body);
    const gameId = await games.ready(user(req), id(req), data.cells);
    await notify(gameId);
    res.json({ data: { gameId } });
  });
  app.post("/api/games/:id/call", async (req, res) => {
    const n = z
      .object({ number: z.number().int().min(1).max(40) })
      .parse(req.body);
    const gameId = await games.callNumber(user(req), id(req), n.number);
    await notify(gameId);
    res.json({ data: { gameId } });
  });
  app.post("/api/games/:id/leave", async (req, res) => {
    const gameId = await games.leave(user(req), id(req));
    await notify(gameId);
    res.json({ data: { gameId } });
  });
  app.post("/api/games/:id/rematch", async (req, res) => {
    const gameId = await games.requestRematch(user(req), id(req));
    await notify(gameId);
    res.json({ data: { gameId } });
  });
  app.post("/api/games/:id/rematch-response", async (req, res) => {
    const d = z.object({ accept: z.boolean() }).parse(req.body);
    const r = await games.respondRematch(user(req), id(req), d.accept);
    await notify(r.gameId);
    if (r.newGameId) {
      await notify(r.newGameId);
      const io = getIo();
      if (io)
        announceMatch(
          io,
          r.newGameId,
          (
            await db.gamePlayer.findMany({ where: { gameId: r.newGameId } })
          ).map((p) => p.userId),
        );
    }
    res.json({ data: { gameId: r.newGameId ?? r.gameId } });
  });
  app.post("/api/matchmaking/join", async (req, res) => {
    const r = await games.matchmaking(user(req));
    if (r.gameId) {
      await notify(r.gameId);
      const io = getIo();
      if (io) announceMatch(io, r.gameId, r.users);
    }
    res.json({ data: { gameId: r.gameId } });
  });
  app.delete("/api/matchmaking", async (req, res) => {
    await games.cancelQueue(user(req));
    res.json({ data: { ok: true } });
  });
  app.use("/api/admin", async (req, _res, next) => {
    try {
      const u = await db.user.findUniqueOrThrow({ where: { id: user(req) } });
      requireCondition(config.adminIds.has(u.telegramId), "FORBIDDEN", 403);
      next();
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/admin", async (_req, res) => {
    const day = new Date(new Date().toISOString().slice(0, 10));
    const [
      users,
      active,
      completed,
      today,
      queue,
      recentUsers,
      recentGames,
      daily,
    ] = await Promise.all([
      db.user.count(),
      db.game.count({ where: { status: { in: ["ACTIVE", "PAUSED"] } } }),
      db.game.count({ where: { status: "FINISHED" } }),
      db.game.count({ where: { createdAt: { gte: day } } }),
      db.matchmakingEntry.count(),
      db.user.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
      db.game.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          publicCode: true,
          status: true,
          type: true,
          createdAt: true,
        },
      }),
      db.dailyActivity.count({ where: { day } }),
    ]);
    const completedToday = await db.game.findMany({
      where: { finishedAt: { gte: day }, status: "FINISHED" },
      select: { startedAt: true, finishedAt: true, type: true },
    });
    res.json({
      data: {
        users,
        online: onlineCount(),
        active,
        completed,
        today,
        queue,
        dailyActive: daily,
        completedToday: completedToday.length,
        quickToday: completedToday.filter((g) => g.type === "QUICK").length,
        friendToday: completedToday.filter((g) => g.type === "FRIEND").length,
        averageSeconds: completedToday.length
          ? Math.round(
              completedToday.reduce(
                (sum, g) =>
                  sum +
                  (g.finishedAt!.getTime() -
                    (g.startedAt ?? g.finishedAt)!.getTime()) /
                    1000,
                0,
              ) / completedToday.length,
            )
          : 0,
        recentUsers: recentUsers.map((u) => ({
          ...games.publicUser(u),
          isBanned: u.isBanned,
          banReason: u.banReason,
        })),
        recentGames,
      },
    });
  });
  app.get("/api/admin/games/:id", async (req, res) => {
    const g = await db.game.findUnique({
      where: { id: id(req) },
      include: games.includeGame,
    });
    requireCondition(g, "GAME_NOT_FOUND", 404);
    const view = games.sanitizeGame(g, g.players[0].userId);
    res.json({
      data: {
        ...view,
        players: view.players.map((p) => ({
          ...p,
          board: g.status === "FINISHED" ? p.board : undefined,
          completedLines: [],
        })),
      },
    });
  });
  app.post("/api/admin/games/:id/cancel", async (req, res) => {
    const gameId = await games.adminCancel(id(req));
    await notify(gameId);
    res.json({ data: { ok: true } });
  });
  app.post("/api/admin/users/:id/ban", async (req, res) => {
    const d = z
      .object({
        isBanned: z.boolean(),
        reason: z.string().max(200).default("Admin decision"),
      })
      .parse(req.body);
    const changed = await games.setBan(id(req), d.isBanned, d.reason);
    for (const gameId of changed) await notify(gameId);
    res.json({ data: { ok: true } });
  });
  app.use("/api", (_req, res) => res.status(404).json({ error: "NOT_FOUND" }));
  const client = path.resolve("dist/client");
  if (existsSync(client)) {
    app.use(express.static(client));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(path.join(client, "index.html")),
    );
  }
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: "INVALID_INPUT" });
      return;
    }
    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.code });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: "INVALID_INPUT" });
      return;
    }
    logger.error({ err }, "request failed");
    res.status(500).json({ error: "SERVER_ERROR" });
  });
  return { app, bot };
}
