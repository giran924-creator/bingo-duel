import "dotenv/config";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: "http://127.0.0.1:3000",
    headless: true,
    launchOptions: process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {},
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:3000/health",
    reuseExistingServer: false,
    env: {
      NODE_ENV: "development",
      DEV_AUTH: "true",
      BOT_MODE: "off",
      WEBAPP_URL: "http://127.0.0.1:3000",
    },
  },
  reporter: "list",
});
