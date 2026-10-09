import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { config } from "./config.js";
import { db } from "./db.js";
import { logger } from "./logger.js";
export function createBot() {
  if (!config.BOT_TOKEN) return null;
  const bot = new Bot(config.BOT_TOKEN);
  const open = (invite?: string) => {
    const url = new URL(config.WEBAPP_URL);
    if (invite && /^game_[A-Z2-9]{8}$/.test(invite))
      url.searchParams.set("invite", invite.slice(5));
    return new InlineKeyboard().webApp("🎮 O‘YINNI OCHISH", url.toString());
  };
  bot.command(["start", "play"], (ctx) =>
    ctx.reply(
      "🎮 BINGO DUEL\n\nDo‘stlaringiz yoki tasodifiy raqibga qarshi Bingo o‘ynang!",
      { reply_markup: open(ctx.match) },
    ),
  );
  bot.command("help", (ctx) =>
    ctx.reply(
      "5×5 maydonda navbat bilan 1–40 orasidan son tanlang. Har bir tanlangan son ikkala maydonda belgilanadi. 5 ta to‘liq qator yoki ustunni birinchi yig‘gan o‘yinchi g‘olib. Bir vaqtda yutuq — durrang.",
      { reply_markup: open() },
    ),
  );
  bot.command(["profile", "stats"], async (ctx) => {
    const u = await db.user.findUnique({
      where: { telegramId: String(ctx.from?.id) },
    });
    return ctx.reply(
      u
        ? `📊 ${u.firstName}\nReyting: ${u.rating}\nO‘yinlar: ${u.gamesPlayed}\nG‘alaba: ${u.wins}\nMag‘lubiyat: ${u.losses}\nDurrang: ${u.draws}\nDaraja: ${u.level}`
        : "Profil yaratish uchun o‘yinni oching.",
      { reply_markup: open() },
    );
  });
  bot.command("leaderboard", async (ctx) => {
    const users = await db.user.findMany({
      where: { isBanned: false },
      orderBy: [{ rating: "desc" }, { id: "asc" }],
      take: 10,
    });
    return ctx.reply(
      "🏆 Reyting\n\n" +
        users
          .map((u, i) => `${i + 1}. ${u.firstName} — ${u.rating}`)
          .join("\n"),
      { reply_markup: open() },
    );
  });
  bot.catch((e) =>
    logger.error(
      { message: e.error instanceof Error ? e.error.message : "Bot error" },
      "bot update failed",
    ),
  );
  return bot;
}
export function webhook(bot: Bot) {
  return webhookCallback(bot, "express", {
    secretToken: config.TELEGRAM_WEBHOOK_SECRET,
  });
}
