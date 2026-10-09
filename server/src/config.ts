import "dotenv/config";
import { z } from "zod";
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const env = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(32),
    BOT_TOKEN: z.string().default(""),
    BOT_USERNAME: z
      .string()
      .regex(/^[A-Za-z0-9_]*$/)
      .default(""),
    WEBAPP_URL: z.url().default("http://localhost:5173"),
    ADMIN_TELEGRAM_IDS: z.string().default(""),
    DEV_AUTH: bool.default(false),
    DEV_AUTH_KEY: z.string().default(""),
    BOT_MODE: z.enum(["off", "polling", "webhook"]).default("off"),
    TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
    BOARD_SIZE: z.coerce.number().int().min(5).max(5).default(5),
    NUMBER_MIN: z.coerce.number().int().min(1).max(1).default(1),
    NUMBER_MAX: z.coerce.number().int().min(40).max(40).default(40),
    WIN_LINES: z.coerce.number().int().min(1).max(10).default(5),
    RECONNECT_GRACE_SECONDS: z.coerce.number().int().min(5).default(60),
    ABANDON_SECONDS: z.coerce.number().int().min(120).default(600),
    LOBBY_TTL_SECONDS: z.coerce.number().int().min(60).default(1800),
    QUEUE_TTL_SECONDS: z.coerce.number().int().min(30).default(120),
    TURN_TIMER_SECONDS: z.coerce.number().int().min(0).default(0),
    TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  })
  .parse(process.env);
if (env.NODE_ENV === "production") {
  if (env.DEV_AUTH) throw new Error("DEV_AUTH must be disabled in production");
  if (
    !env.BOT_TOKEN ||
    !env.BOT_USERNAME ||
    !env.WEBAPP_URL.startsWith("https://")
  )
    throw new Error(
      "Production requires Telegram bot configuration and HTTPS WEBAPP_URL",
    );
  if (
    env.BOT_MODE !== "webhook" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET)
  )
    throw new Error(
      "Production requires webhook mode and a strong webhook secret",
    );
}
if (env.DEV_AUTH && env.DEV_AUTH_KEY.length < 24)
  throw new Error("DEV_AUTH_KEY must be at least 24 characters");
if (env.ABANDON_SECONDS <= env.RECONNECT_GRACE_SECONDS)
  throw new Error("ABANDON_SECONDS must exceed grace period");
export const config = {
  ...env,
  adminIds: new Set(
    env.ADMIN_TELEGRAM_IDS.split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  ),
};
