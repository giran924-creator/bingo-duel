import pino from "pino";
export const logger = pino({
  redact: [
    "req.headers.authorization",
    "token",
    "initData",
    "BOT_TOKEN",
    "SESSION_SECRET",
  ],
});
