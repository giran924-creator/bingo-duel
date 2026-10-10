import { test, expect, type Page } from "@playwright/test";
import type { GameView, PublicUser } from "../shared/types";
const player: PublicUser = {
  id: "00000000-0000-4000-8000-000000000001",
  firstName: "Layout Player",
  username: null,
  photoUrl: null,
  rating: 1000,
  xp: 0,
  level: 1,
  wins: 0,
  losses: 0,
  draws: 0,
  gamesPlayed: 0,
  currentWinStreak: 0,
  bestWinStreak: 0,
  totalLines: 0,
  totalTurns: 0,
  createdAt: "2026-10-09T00:00:00Z",
};
const gameId = "00000000-0000-4000-8000-000000000010";
const game: GameView = {
  id: gameId,
  publicCode: "ABCDEFGH",
  type: "FRIEND",
  boardMode: "RANDOM",
  status: "ACTIVE",
  numberMin: 1,
  numberMax: 40,
  boardSize: 5,
  winLines: 5,
  diagonalEnabled: false,
  currentPlayerId: player.id,
  firstPlayerId: player.id,
  winnerId: null,
  result: null,
  rulesVersion: "1.0",
  startedAt: "2026-10-09T00:00:00Z",
  finishedAt: null,
  createdAt: "2026-10-09T00:00:00Z",
  turnDeadline: null,
  rematchRequestedBy: null,
  rematchGameId: null,
  inviteUrl: null,
  players: [
    {
      id: "p1",
      user: player,
      seat: 1,
      isReady: true,
      lineCount: 4,
      online: true,
      ratingBefore: null,
      ratingAfter: null,
      ratingDelta: null,
      board: Array.from({ length: 25 }, (_, i) => i + 1),
      completedLines: ["r0", "r1", "r2", "r3"],
    },
    {
      id: "p2",
      user: {
        ...player,
        id: "00000000-0000-4000-8000-000000000002",
        firstName: "Opponent",
      },
      seat: 2,
      isReady: true,
      lineCount: 1,
      online: true,
      ratingBefore: null,
      ratingAfter: null,
      ratingDelta: null,
      completedLines: [],
    },
  ],
  turns: Array.from({ length: 20 }, (_, i) => ({
    number: i + 1,
    turnIndex: i + 1,
    userId: player.id,
    createdAt: "2026-10-09T00:00:00Z",
  })),
};
async function prepare(page: Page) {
  await page.route("https://telegram.org/js/telegram-web-app.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
 const listeners=new Map();
 window.Telegram={WebApp:{initData:'',colorScheme:'dark',themeParams:{},safeAreaInset:{top:24,bottom:20,left:8,right:8},contentSafeAreaInset:{top:56,bottom:16,left:4,right:4},viewportStableHeight:740,
 ready(){},expand(){},enableClosingConfirmation(){},disableClosingConfirmation(){},
 onEvent(name,cb){const set=listeners.get(name)||new Set();set.add(cb);listeners.set(name,set)},offEvent(name,cb){listeners.get(name)?.delete(cb)},
 emit(name){for(const cb of listeners.get(name)||[])cb()}}};`,
    }),
  );
  await page.addInitScript(() =>
    sessionStorage.setItem("bingo-token", "layout-test-token"),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      path === "/api/config"
        ? { devAuth: false }
        : path === "/api/me"
          ? {
              user: player,
              isAdmin: false,
              isBanned: false,
              liveGameId: null,
              queued: false,
            }
          : path === `/api/games/${gameId}`
            ? game
            : null;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data }),
    });
  });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function withinSafeArea(page: Page, selector: string, checkTop = true) {
  const rects = await page.locator(selector).evaluateAll((elements) =>
    elements.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  expect(rects.length).toBeGreaterThan(0);
  const safe = await page.evaluate(() => {
    const tg = window.Telegram!.WebApp;
    const a = tg.safeAreaInset!,
      b = tg.contentSafeAreaInset!;
    return {
      top: a.top + b.top + 8,
      bottom: innerHeight - a.bottom - b.bottom,
      left: a.left + b.left,
      right: innerWidth - a.right - b.right,
    };
  });
  for (const rect of rects) {
    expect(rect.left).toBeGreaterThanOrEqual(safe.left);
    expect(rect.right).toBeLessThanOrEqual(safe.right);
    if (checkTop) expect(rect.top).toBeGreaterThanOrEqual(safe.top);
    expect(rect.bottom).toBeLessThanOrEqual(safe.bottom);
  }
}
test("320px Telegram safe areas protect header, navigation and tall modal controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await prepare(page);
  await page.goto("/");
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".app")).toHaveCSS("padding-top", "88px");
  await withinSafeArea(page, ".topbar button");
  await withinSafeArea(page, ".bottom-nav button");
  await noOverflow(page);
  // Change both classes of insets and the stable viewport, as Telegram does in fullscreen/orientation changes.
  await page.evaluate(() => {
    const tg = window.Telegram!.WebApp;
    tg.safeAreaInset = { top: 30, bottom: 24, left: 8, right: 8 };
    tg.contentSafeAreaInset = { top: 80, bottom: 20, left: 4, right: 4 };
    tg.viewportStableHeight = 700;
    for (const event of [
      "safeAreaChanged",
      "contentSafeAreaChanged",
      "viewportChanged",
    ])
      (tg as typeof tg & { emit: (name: string) => void }).emit(event);
  });
  await expect(page.locator(".app")).toHaveCSS("padding-top", "118px");
  await expect(page.locator(".app")).toHaveCSS("min-height", "700px");
  await withinSafeArea(page, ".topbar button");
  await withinSafeArea(page, ".bottom-nav button");
  await page.goto(`/game/${gameId}`);
  await expect(page.locator(".game-header")).toBeVisible();
  await withinSafeArea(page, ".game-header button");
  await noOverflow(page);
  expect(
    await page
      .locator(".board")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.locator(".called-history .icon-button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await withinSafeArea(page, ".modal");
  await withinSafeArea(page, ".modal .icon-button");
  await noOverflow(page);
  await page.locator(".modal .icon-button").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
test("Telegram Desktop fills viewport and centers readable 760px content", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await prepare(page);
  await page.goto("/");
  await expect(page.locator(".screen")).toBeVisible();
  expect(
    await page
      .locator(".app")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(1280);
  for (const selector of [".screen", ".topbar", ".bottom-nav-content"]) {
    const box = await page.locator(selector).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBe(760);
    expect(box!.x + box!.width / 2).toBe(640);
  }
  await withinSafeArea(page, ".topbar button");
  await withinSafeArea(page, ".bottom-nav button");
  await noOverflow(page);
  await page.goto(`/game/${gameId}`);
  await expect(page.locator(".game-screen")).toBeVisible();
  expect(
    await page
      .locator(".game-screen")
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(760);
  await page.locator(".called-history .icon-button").click();
  await withinSafeArea(page, ".modal");
  await withinSafeArea(page, ".modal .icon-button");
});
