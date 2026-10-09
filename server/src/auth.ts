import { createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { config } from "./config.js";
import { db } from "./db.js";
import { AppError, requireCondition } from "./errors.js";
export const telegramUserSchema = z.object({
  id: z.number().int().positive().safe(),
  first_name: z.string().min(1).max(128),
  last_name: z.string().max(128).optional(),
  username: z.string().max(64).optional(),
  photo_url: z.url().optional(),
  language_code: z.string().max(16).optional(),
});
export function validateInitData(
  raw: string,
  botToken: string,
  now = Math.floor(Date.now() / 1000),
) {
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  requireCondition(new Set(keys).size === keys.length, "INVALID_AUTH", 401);
  const hash = params.get("hash");
  requireCondition(hash && /^[a-f0-9]{64}$/i.test(hash), "INVALID_AUTH", 401);
  const date = Number(params.get("auth_date"));
  requireCondition(
    Number.isInteger(date) &&
      date > 0 &&
      now - date <= 3600 &&
      date <= now + 30,
    "AUTH_EXPIRED",
    401,
  );
  params.delete("hash");
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(check).digest();
  requireCondition(
    timingSafeEqual(expected, Buffer.from(hash, "hex")),
    "INVALID_AUTH",
    401,
  );
  try {
    return telegramUserSchema.parse(JSON.parse(params.get("user") ?? ""));
  } catch {
    throw new AppError(401, "INVALID_AUTH");
  }
}
const key = new TextEncoder().encode(config.SESSION_SECRET);
export async function issueToken(id: string) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(id)
    .setIssuer("bingo-duel")
    .setAudience("bingo-duel")
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(key);
}
export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
      issuer: "bingo-duel",
      audience: "bingo-duel",
    });
    requireCondition(payload.sub, "INVALID_AUTH", 401);
    return payload.sub;
  } catch {
    throw new AppError(401, "INVALID_AUTH");
  }
}
export async function authenticate(payload: unknown) {
  const data = z
    .object({
      initData: z.string().max(16384).optional(),
      devId: z.number().int().min(1).max(1000000).optional(),
      devKey: z.string().max(256).optional(),
    })
    .parse(payload);
  let tg: z.infer<typeof telegramUserSchema>;
  if (data.initData) {
    requireCondition(config.BOT_TOKEN, "BOT_NOT_CONFIGURED", 503);
    tg = validateInitData(data.initData, config.BOT_TOKEN);
  } else {
    requireCondition(
      config.NODE_ENV !== "production" &&
        config.DEV_AUTH &&
        data.devId &&
        data.devKey,
      "INVALID_AUTH",
      401,
    );
    const supplied = Buffer.from(data.devKey),
      expected = Buffer.from(config.DEV_AUTH_KEY);
    requireCondition(
      supplied.length === expected.length &&
        timingSafeEqual(supplied, expected),
      "INVALID_AUTH",
      401,
    );
    tg = {
      id: data.devId,
      first_name: `Local Player ${data.devId}`,
      language_code: "uz",
    };
  }
  const user = await db.user.upsert({
    where: { telegramId: String(tg.id) },
    create: {
      telegramId: String(tg.id),
      firstName: tg.first_name,
      username: tg.username,
      lastName: tg.last_name,
      photoUrl: tg.photo_url,
      languageCode: tg.language_code ?? "uz",
    },
    update: {
      firstName: tg.first_name,
      username: tg.username ?? null,
      lastName: tg.last_name ?? null,
      photoUrl: tg.photo_url ?? null,
      lastSeenAt: new Date(),
    },
  });
  await db.dailyActivity.upsert({
    where: {
      userId_day: {
        userId: user.id,
        day: new Date(new Date().toISOString().slice(0, 10)),
      },
    },
    create: {
      userId: user.id,
      day: new Date(new Date().toISOString().slice(0, 10)),
    },
    update: {},
  });
  return { token: await issueToken(user.id), user };
}
