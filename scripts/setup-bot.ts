import { Bot } from "grammy";
import { config } from "../server/src/config.js";
if (!config.BOT_TOKEN)
  throw new Error("Set BOT_TOKEN securely in your environment");
if (!config.WEBAPP_URL.startsWith("https://"))
  throw new Error("Telegram requires an HTTPS WEBAPP_URL");
const bot = new Bot(config.BOT_TOKEN);
await bot.api.setMyCommands([
  { command: "start", description: "O‘yinni ochish" },
  { command: "play", description: "BINGO DUEL" },
  { command: "help", description: "Qoidalar" },
  { command: "profile", description: "Profil" },
  { command: "stats", description: "Statistika" },
  { command: "leaderboard", description: "Reyting" },
]);
await bot.api.setChatMenuButton({
  menu_button: {
    type: "web_app",
    text: "🎮 BINGO DUEL",
    web_app: { url: config.WEBAPP_URL },
  },
});
if (config.BOT_MODE === "webhook") {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(config.TELEGRAM_WEBHOOK_SECRET))
    throw new Error("Set a strong TELEGRAM_WEBHOOK_SECRET");
  await bot.api.setWebhook(
    new URL("/telegram/webhook", config.WEBAPP_URL).toString(),
    {
      secret_token: config.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    },
  );
}
console.log("Bot commands, menu and configured webhook registered.");
