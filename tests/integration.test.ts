import { afterAll, beforeAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createServer, type Server } from "node:http";
import { io as client, type Socket } from "socket.io-client";
import type { ClientEvents, ServerEvents, GameView } from "../shared/types.js";
const enabled = process.env.RUN_DB_TESTS === "1";
// Integration tests have isolated users in an explicit TEST_DATABASE_URL.
process.env.NODE_ENV = "test";
process.env.DEV_AUTH = "true";
process.env.DEV_AUTH_KEY = "integration-only-development-key-1234";
process.env.SESSION_SECRET = "integration-only-session-secret-123456789";
process.env.BOT_MODE = "off";
process.env.BOT_TOKEN = "";
process.env.ADMIN_TELEGRAM_IDS = "900003";
if (enabled) {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error(
      "Set TEST_DATABASE_URL to an isolated, migrated test database",
    );
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
let app: ReturnType<typeof import("../server/src/app.js").createApp>["app"],
  db: typeof import("../server/src/db.js").db,
  games: typeof import("../server/src/games.js"),
  server: Server,
  sio: ReturnType<typeof import("../server/src/sockets.js").attachSockets>;
let a: { id: string; token: string },
  b: { id: string; token: string },
  c: { id: string; token: string };
let socketA: Socket<ServerEvents, ClientEvents>,
  socketB: Socket<ServerEvents, ClientEvents>;
const tracked = new Set<string>();
function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}
async function newGame(manual = true, winLines = 5) {
  const r = await request(app)
    .post("/api/games/friend")
    .set(auth(a.token))
    .send({ boardMode: manual ? "MANUAL" : "RANDOM", winLines });
  expect(r.status).toBe(201);
  const id = r.body.data.gameId;
  tracked.add(id);
  const g = (await request(app).get(`/api/games/${id}`).set(auth(a.token))).body
    .data as GameView;
  expect(
    (
      await request(app)
        .post(`/api/games/${g.publicCode}/join`)
        .set(auth(b.token))
    ).status,
  ).toBe(200);
  return id as string;
}
async function start(id: string, cells?: number[], other?: number[]) {
  expect(
    (
      await request(app)
        .post(`/api/games/${id}/ready`)
        .set(auth(a.token))
        .send(cells ? { cells } : {})
    ).status,
  ).toBe(200);
  expect(
    (
      await request(app)
        .post(`/api/games/${id}/ready`)
        .set(auth(b.token))
        .send(other ? { cells: other } : cells ? { cells } : {})
    ).status,
  ).toBe(200);
  await db.game.update({
    where: { id },
    data: { startedAt: new Date(Date.now() - 1000) },
  });
}
async function finishDraw(id: string, upto = 25) {
  for (let num = 1; num <= upto; num++) {
    const g = await db.game.findUniqueOrThrow({ where: { id } });
    if (g.status === "FINISHED") break;
    const token = g.currentPlayerId === a.id ? a.token : b.token;
    expect(
      (
        await request(app)
          .post(`/api/games/${id}/call`)
          .set(auth(token))
          .send({ number: num })
      ).status,
    ).toBe(200);
  }
}
async function cleanLive() {
  await db.game.updateMany({
    where: {
      players: { some: { userId: { in: [a.id, b.id, c.id] } } },
      status: { in: ["WAITING", "ACTIVE", "PAUSED"] },
    },
    data: { status: "CANCELLED" },
  });
  await db.matchmakingEntry.deleteMany({
    where: { userId: { in: [a.id, b.id, c.id] } },
  });
}
const suite = enabled ? describe : describe.skip;
suite("PostgreSQL + HTTP + Socket.IO two-player integration", () => {
  beforeAll(async () => {
    games = await import("../server/src/games.js");
    db = (await import("../server/src/db.js")).db;
    await db.$connect();
    for (const telegramId of ["900001", "900002", "900003"]) {
      const user = await db.user.findUnique({ where: { telegramId } });
      if (user) {
        await db.game.deleteMany({
          where: { players: { some: { userId: user.id } } },
        });
        await db.user.delete({ where: { id: user.id } });
      }
    }
    app = (await import("../server/src/app.js")).createApp(() => sio).app;
    server = createServer(app);
    sio = (await import("../server/src/sockets.js")).attachSockets(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const login = async (devId: number) => {
      const r = await request(app)
        .post("/api/auth")
        .send({ devId, devKey: process.env.DEV_AUTH_KEY });
      expect(r.status).toBe(200);
      return { id: r.body.data.user.id, token: r.body.data.token };
    };
    a = await login(900001);
    b = await login(900002);
    c = await login(900003);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No server address");
    const url = `http://127.0.0.1:${address.port}`;
    socketA = client(url, {
      auth: { token: a.token },
      transports: ["websocket"],
    });
    socketB = client(url, {
      auth: { token: b.token },
      transports: ["websocket"],
    });
    await Promise.all(
      [socketA, socketB].map(
        (s) =>
          new Promise<void>((resolve, reject) => {
            s.once("connect", resolve);
            s.once("connect_error", reject);
          }),
      ),
    );
  });
  afterAll(async () => {
    socketA?.disconnect();
    socketB?.disconnect();
    if (sio) {
      await new Promise<void>((resolve) => sio.close(() => resolve()));
      await (await import("../server/src/sockets.js")).drainSocketTasks(sio);
    }
    server?.close();
    if (db) {
      if (a)
        await db.game.deleteMany({
          where: { players: { some: { userId: { in: [a.id, b.id, c.id] } } } },
        });
      await db.user.deleteMany({
        where: { telegramId: { in: ["900001", "900002", "900003"] } },
      });
      await db.$disconnect();
    }
  });
  it("health checks the actual database and unauthenticated APIs reject", async () => {
    expect((await request(app).get("/health")).body.status).toBe("ok");
    expect((await request(app).get("/api/me")).status).toBe(401);
    expect(
      (await request(app).post("/api/auth").send({ devId: 4, devKey: "wrong" }))
        .status,
    ).toBe(401);
  });
  it("friend lobby is private, has at most two players and locks manual boards", async () => {
    const id = await newGame();
    expect(
      (await request(app).get(`/api/games/${id}`).set(auth(c.token))).status,
    ).toBe(403);
    const g = (await request(app).get(`/api/games/${id}`).set(auth(a.token)))
      .body.data as GameView;
    expect(
      (
        await request(app)
          .post(`/api/games/${g.publicCode}/join`)
          .set(auth(c.token))
      ).status,
    ).toBe(409);
    expect(
      (await request(app).post("/api/games/friend").set(auth(a.token)).send({}))
        .body.error,
    ).toBe("ALREADY_IN_GAME");
    expect(
      (
        await request(app)
          .post(`/api/games/${id}/ready`)
          .set(auth(a.token))
          .send({ cells: Array(25).fill(1) })
      ).body.error,
    ).toBe("INVALID_BOARD");
    const cells = Array.from({ length: 25 }, (_, i) => i + 1);
    await start(id, cells);
    const view = await games.getGame(id, a.id);
    expect(view.players.find((p) => p.user.id === a.id)?.board).toEqual(cells);
    expect(view.players.find((p) => p.user.id === b.id)?.board).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("telegramId");
    expect(
      (
        await request(app)
          .post(`/api/games/${id}/ready`)
          .set(auth(a.token))
          .send({ cells: cells.slice().reverse() })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post(`/api/games/${id}/call`)
          .set(auth(c.token))
          .send({ number: 1 })
      ).status,
    ).toBe(403);
    await cleanLive();
  });
  it("socket rooms reject outsiders and every recipient gets only their own board", async () => {
    const id = await newGame();
    const cells = Array.from({ length: 25 }, (_, i) => i + 1),
      other = Array.from({ length: 25 }, (_, i) => 40 - i);
    await start(id, cells, other);
    const bad = await new Promise<{ ok: boolean; error?: string }>((resolve) =>
      socketA.emit(
        "game:join",
        { gameId: "00000000-0000-4000-8000-000000000000" },
        resolve,
      ),
    );
    expect(bad.ok).toBe(false);
    const pa = new Promise<GameView>((resolve) =>
        socketA.once("game:state", resolve),
      ),
      pb = new Promise<GameView>((resolve) =>
        socketB.once("game:state", resolve),
      );
    await new Promise<void>((resolve) =>
      socketA.emit("game:join", { gameId: id }, () => resolve()),
    );
    const [va, vb] = await Promise.all([pa, pb]);
    expect(va.players.find((p) => p.user.id === b.id)?.board).toBeUndefined();
    expect(vb.players.find((p) => p.user.id === a.id)?.board).toBeUndefined();
    expect(vb.players.find((p) => p.user.id === b.id)?.board).toEqual(other);
    const g = await db.game.findUniqueOrThrow({ where: { id } }),
      s = g.currentPlayerId === a.id ? socketA : socketB;
    const result = await new Promise<{ ok: boolean }>((resolve) =>
      s.emit("game:call-number", { gameId: id, number: 17 }, resolve),
    );
    expect(result.ok).toBe(true);
    expect(await db.turn.count({ where: { gameId: id } })).toBe(1);
    await cleanLive();
  });
  it("concurrent duplicate submissions yield exactly one valid turn", async () => {
    const id = await newGame(false);
    await start(id);
    const g = await db.game.findUniqueOrThrow({ where: { id } }),
      token = g.currentPlayerId === a.id ? a.token : b.token,
      wrong = g.currentPlayerId === a.id ? b.token : a.token;
    expect(
      (
        await request(app)
          .post(`/api/games/${id}/call`)
          .set(auth(wrong))
          .send({ number: 18 })
      ).body.error,
    ).toBe("WRONG_TURN");
    const results = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post(`/api/games/${id}/call`)
          .set(auth(token))
          .send({ number: 18 }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    expect(await db.turn.count({ where: { gameId: id } })).toBe(1);
    expect(
      (
        await request(app)
          .post(`/api/games/${id}/call`)
          .set(auth(wrong))
          .send({ number: 18 })
      ).body.error,
    ).toBe("NUMBER_CALLED");
    await cleanLive();
  });
  it("simultaneous five-line completion draws, persists once, reveals boards and records history", async () => {
    const id = await newGame(),
      cells = Array.from({ length: 25 }, (_, i) => i + 1);
    await start(id, cells);
    const before = await db.user.findUniqueOrThrow({ where: { id: a.id } });
    await finishDraw(id);
    const g = await games.getGame(id, a.id);
    expect(g.status).toBe("FINISHED");
    expect(g.result).toBe("DRAW");
    expect(g.winnerId).toBeNull();
    expect(g.players.every((p) => !!p.board)).toBe(true);
    expect(g.turns.length).toBe(21);
    const after = await db.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.draws).toBe(before.draws + 1);
    expect(after.rating).toBe(before.rating);
    expect(after.xp).toBe(before.xp + 20);
    expect(
      (
        await request(app)
          .post(`/api/games/${id}/call`)
          .set(auth(a.token))
          .send({ number: 40 })
      ).status,
    ).toBe(409);
    const history = await request(app)
      .get("/api/me/history")
      .set(auth(a.token));
    expect(history.body.data.some((game: GameView) => game.id === id)).toBe(
      true,
    );
  });
  it("normal five-line victory computes winner and Elo from both private boards", async () => {
    const id = await newGame(),
      cells = Array.from({ length: 25 }, (_, i) => i + 1),
      other = Array.from({ length: 25 }, (_, i) => 40 - i);
    await start(id, cells, other);
    const before = await db.user.findUniqueOrThrow({ where: { id: a.id } });
    await finishDraw(id);
    const game = await games.getGame(id, a.id);
    expect(game.result).toBe("WIN");
    expect(game.winnerId).toBe(a.id);
    expect(game.players[0].lineCount).toBe(5);
    expect(game.players[1].lineCount).toBe(1);
    const after = await db.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.wins).toBe(before.wins + 1);
    expect(after.rating).toBeGreaterThan(before.rating);
  });
  it("rematch creates a new record and alternates first player", async () => {
    const old = await db.game.findFirstOrThrow({
      where: { status: "FINISHED", players: { some: { userId: a.id } } },
      orderBy: { finishedAt: "desc" },
    });
    expect(
      (
        await request(app)
          .post(`/api/games/${old.id}/rematch`)
          .set(auth(a.token))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/games/${old.id}/rematch-response`)
          .set(auth(a.token))
          .send({ accept: true })
      ).status,
    ).toBe(409);
    const r = await request(app)
      .post(`/api/games/${old.id}/rematch-response`)
      .set(auth(b.token))
      .send({ accept: true });
    expect(r.status).toBe(200);
    const g = await db.game.findUniqueOrThrow({
      where: { id: r.body.data.gameId },
    });
    tracked.add(g.id);
    expect(g.id).not.toBe(old.id);
    expect(g.firstPlayerId).not.toBe(old.firstPlayerId);
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: old.id } })).status,
    ).toBe("FINISHED");
    await cleanLive();
  });
  it("forfeit awards Elo after play and unlocks server-derived XP/achievements", async () => {
    const id = await newGame(false);
    await start(id);
    const g = await db.game.findUniqueOrThrow({ where: { id } });
    await games.callNumber(g.currentPlayerId!, id, 1);
    const before = await db.user.findUniqueOrThrow({ where: { id: b.id } });
    expect(
      (await request(app).post(`/api/games/${id}/leave`).set(auth(a.token)))
        .status,
    ).toBe(200);
    const done = await games.getGame(id, b.id);
    expect(done.winnerId).toBe(b.id);
    expect(done.result).toBe("FORFEIT");
    const after = await db.user.findUniqueOrThrow({ where: { id: b.id } });
    expect(after.wins).toBe(before.wins + 1);
    expect(after.rating).toBeGreaterThan(before.rating);
    expect(after.xp).toBe(before.xp + 30);
    expect(
      await db.userAchievement.findUnique({
        where: { userId_code: { userId: b.id, code: "FIRST_WIN" } },
      }),
    ).not.toBeNull();
  });
  it("matchmaking entries are unique and pairing is transactional", async () => {
    await cleanLive();
    await Promise.all([games.matchmaking(a.id), games.matchmaking(a.id)]);
    expect(await db.matchmakingEntry.count({ where: { userId: a.id } })).toBe(
      1,
    );
    const r = await games.matchmaking(b.id);
    expect(r.gameId).not.toBeNull();
    tracked.add(r.gameId!);
    expect(
      await db.matchmakingEntry.count({
        where: { userId: { in: [a.id, b.id] } },
      }),
    ).toBe(0);
    expect(
      (await db.game.findUniqueOrThrow({ where: { id: r.gameId! } })).type,
    ).toBe("QUICK");
    await cleanLive();
  });
  it("reconnect reloads durable own state and updates opponent presence", async () => {
    const id = await newGame(false);
    await start(id);
    const g = await db.game.findUniqueOrThrow({ where: { id } });
    await games.callNumber(g.currentPlayerId!, id, 8);
    const before = await games.getGame(id, a.id);
    socketA.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 100));
    socketA.connect();
    await new Promise<void>((resolve) => socketA.once("connect", resolve));
    const restored = await games.getGame(id, a.id);
    expect(restored.turns).toEqual(before.turns);
    expect(restored.players.find((p) => p.user.id === a.id)?.board).toEqual(
      before.players.find((p) => p.user.id === a.id)?.board,
    );
    expect(restored.currentPlayerId).toBe(before.currentPlayerId);
    await cleanLive();
  });
  it("admin requires configured Telegram ID and bans prevent game entry", async () => {
    expect(
      (await request(app).get("/api/admin").set(auth(a.token))).status,
    ).toBe(403);
    expect(
      (await request(app).get("/api/admin").set(auth(c.token))).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/api/admin/users/${a.id}/ban`)
          .set(auth(c.token))
          .send({ isBanned: true, reason: "test" })
      ).status,
    ).toBe(200);
    expect(
      (await request(app).post("/api/games/friend").set(auth(a.token)).send({}))
        .body.error,
    ).toBe("BANNED");
    expect(
      (await request(app).post("/api/matchmaking/join").set(auth(a.token))).body
        .error,
    ).toBe("BANNED");
    await request(app)
      .post(`/api/admin/users/${a.id}/ban`)
      .set(auth(c.token))
      .send({ isBanned: false });
  });
});
