import { createServer } from "node:http";
import { config } from "./config.js";
import { db } from "./db.js";
import { createApp } from "./app.js";
import { attachSockets, broadcast, drainSocketTasks } from "./sockets.js";
import { cleanup, atomic } from "./games.js";
import { logger } from "./logger.js";
await db.$connect();
// Live socket presence is per process. V1 deliberately uses a single instance.
await atomic((tx) => tx.matchmakingEntry.deleteMany());
const { app, bot } = createApp(() => io);
const server = createServer(app);
const io = attachSockets(server);
server.listen(config.PORT, "0.0.0.0", () =>
  logger.info({ port: config.PORT }, "BINGO DUEL listening"),
);
if (bot && config.BOT_MODE === "polling") {
  await bot.api.deleteWebhook();
  void bot
    .start({ onStart: () => logger.info("Telegram polling started") })
    .catch((e) =>
      logger.error(
        { message: e instanceof Error ? e.message : "Polling failed" },
        "bot polling failed",
      ),
    );
}
let running = false;
let periodicTask: Promise<void> = Promise.resolve();
const timer = setInterval(() => {
  if (running) return;
  running = true;
  periodicTask = cleanup()
    .then(async (ids) => {
      for (const id of ids) if (io) await broadcast(io, id);
    })
    .catch((e) => logger.error({ err: e }, "cleanup failed"))
    .finally(() => {
      running = false;
    });
}, 3000);
timer.unref();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  if (bot?.isRunning()) await bot.stop();
  await new Promise<void>((resolve) => io.close(() => resolve()));
  server.close();
  await periodicTask;
  await drainSocketTasks(io);
  await db.$disconnect();
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});
