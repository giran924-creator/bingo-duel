import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { describe, it, expect, beforeAll } from "vitest";
process.env.DATABASE_URL ??= "postgresql://bingo:bingo@localhost:5432/bingo";
process.env.SESSION_SECRET ??= "unit-test-only-session-secret-at-least-32";
let validate: typeof import("../server/src/auth.js").validateInitData;
beforeAll(async () => {
  validate = (await import("../server/src/auth.js")).validateInitData;
});
function signed(now: number, token = "123:test") {
  const p = new URLSearchParams({
    auth_date: String(now),
    query_id: "example",
    user: JSON.stringify({ id: 42, first_name: "Ali", username: "ali" }),
  });
  const data = [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  p.set("hash", createHmac("sha256", secret).update(data).digest("hex"));
  return p;
}
describe("Telegram Mini App authentication", () => {
  it("accepts official two-stage HMAC with raw encoded data", () =>
    expect(validate(signed(10000).toString(), "123:test", 10030).id).toBe(42));
  it("rejects altered data, invalid bot token and missing hash", () => {
    const p = signed(10000);
    p.set("user", JSON.stringify({ id: 99, first_name: "Cheater" }));
    expect(() => validate(p.toString(), "123:test", 10030)).toThrow(
      "INVALID_AUTH",
    );
    expect(() => validate(signed(10000).toString(), "wrong", 10030)).toThrow(
      "INVALID_AUTH",
    );
    expect(() => validate("auth_date=10000", "123:test", 10030)).toThrow(
      "INVALID_AUTH",
    );
  });
  it("rejects expired and future authentication", () => {
    expect(() => validate(signed(10000).toString(), "123:test", 14000)).toThrow(
      "AUTH_EXPIRED",
    );
    expect(() => validate(signed(10100).toString(), "123:test", 10000)).toThrow(
      "AUTH_EXPIRED",
    );
  });
  it("rejects duplicate signed query fields", () => {
    const p = signed(10000);
    p.append("user", "{}");
    expect(() => validate(p.toString(), "123:test", 10030)).toThrow(
      "INVALID_AUTH",
    );
  });
  it("session JWT validates and rejects tampering", async () => {
    const a = await import("../server/src/auth.js");
    const token = await a.issueToken("user-id");
    expect(await a.verifyToken(token)).toBe("user-id");
    await expect(a.verifyToken(token.slice(0, -10) + "bad")).rejects.toThrow(
      "INVALID_AUTH",
    );
  });
  it("production rejects startup with development authentication enabled", () => {
    const r = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "await import('./server/src/config.ts')",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "production", DEV_AUTH: "true" },
      },
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("DEV_AUTH must be disabled in production");
  });
  it("production rejects a fake-user auth request before reaching the database", () => {
    const code =
      "const {authenticate}=await import('./server/src/auth.ts');try{await authenticate({devId:1,devKey:'fake'});process.exit(1)}catch(e){if(e.code!=='INVALID_AUTH')process.exit(2)}";
    const r = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", code],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "production",
          DEV_AUTH: "false",
          BOT_TOKEN: "test-only-placeholder",
          BOT_USERNAME: "test_bot",
          WEBAPP_URL: "https://example.com",
          BOT_MODE: "webhook",
          TELEGRAM_WEBHOOK_SECRET: "test-only-webhook-secret-long-enough",
        },
      },
    );
    expect(r.status).toBe(0);
  });
});
