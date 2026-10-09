import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
test("two mobile browser contexts play a private manual match, reconnect and rematch", async ({
  browser,
}) => {
  if (!process.env.DEV_AUTH_KEY)
    throw new Error("Set DEV_AUTH_KEY in your local .env");
  const one = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
      viewport: { width: 320, height: 740 },
    }),
    two = await browser.newContext({
      baseURL: "http://127.0.0.1:3000",
      viewport: { width: 390, height: 844 },
    });
  const a = await one.newPage(),
    b = await two.newPage(),
    errors: string[] = [];
  for (const p of [a, b]) p.on("pageerror", (e) => errors.push(e.message));
  async function login(p: Page, id: number) {
    await p.goto("/");
    await p.getByLabel("O‘yinchi raqami").fill(String(id));
    await p.getByLabel("Mahalliy kalit").fill(process.env.DEV_AUTH_KEY!);
    await p.getByRole("button", { name: "Kirish", exact: true }).click();
    await expect(
      p.getByRole("button", { name: /Do‘st bilan o‘ynash/ }),
    ).toBeVisible();
  }
  await login(a, 910001);
  await login(b, 910002);
  // Recover only these dedicated local browser test accounts from earlier runs.
  for (const p of [a, b]) {
    const resume = p.getByRole("button", { name: /Faol o‘yinga qaytish/ });
    if (await resume.count()) {
      await resume.click();
      const cancel = p.getByRole("button", {
        name: "O‘yinni bekor qilish",
        exact: true,
      });
      p.once("dialog", (d) => d.accept());
      if (await cancel.count()) await cancel.click();
      else
        await p
          .getByRole("button", { name: "Taslim bo‘lish", exact: true })
          .click();
      await p.getByRole("button", { name: "Bosh sahifa", exact: true }).click();
    }
  }
  await a.screenshot({ path: "e2e-artifacts/home-320.png", fullPage: true });
  await a.getByRole("button", { name: /Do‘st bilan o‘ynash/ }).click();
  await a.getByLabel("Maydon turi").selectOption("MANUAL");
  await a.getByRole("button", { name: "Xona yaratish" }).click();
  await expect(a.locator(".invite-code")).toBeVisible();
  const code = (await a.locator(".invite-code").textContent())!;
  await b.getByRole("button", { name: /Do‘st bilan o‘ynash/ }).click();
  await b.getByLabel("Taklif kodi").fill(code);
  await b.getByRole("button", { name: "Qo‘shilish", exact: true }).click();
  for (const p of [a, b]) {
    await expect(p.locator(".invite-code")).toHaveText(code);
    for (let num = 1; num <= 25; num++)
      await p
        .locator(".number-picker")
        .getByRole("button", { name: String(num), exact: true })
        .click();
    await p.getByRole("button", { name: "TAYYORMAN", exact: true }).click();
  }
  await expect(a.locator(".number-picker")).toBeVisible();
  await expect(a.locator(".countdown")).toHaveCount(0, { timeout: 10000 });
  for (let num = 1; num <= 21; num++) {
    const active = (await a.locator(".my-turn").count()) ? a : b;
    await active
      .locator(".number-picker")
      .getByRole("button", { name: String(num), exact: true })
      .click();
    await active
      .getByRole("dialog")
      .getByRole("button", { name: "Ha, tasdiqlayman" })
      .click();
    for (const p of [a, b])
      await expect(p.locator(".board").first().locator(".marked")).toHaveCount(
        num,
      );
    if (num === 10) {
      await a.screenshot({
        path: "e2e-artifacts/game-320.png",
        fullPage: true,
      });
      for (const p of [a, b])
        expect(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
    }
    if (num === 12) {
      await b.reload();
      await expect(b.locator(".board .marked")).toHaveCount(12);
    }
  }
  for (const p of [a, b])
    await expect(
      p.getByRole("heading", { name: "DURRANG", exact: true }),
    ).toBeVisible();
  await a.screenshot({ path: "e2e-artifacts/draw-320.png", fullPage: true });
  await a.getByRole("button", { name: /Ikkala maydonni ko‘rish/ }).click();
  await expect(a.locator(".board")).toHaveCount(2);
  const old = a.url();
  await a.getByRole("button", { name: /Qayta o‘ynash/ }).click();
  await expect(b.getByText("Raqib qayta o‘ynashni xohlaydi.")).toBeVisible();
  await b.getByRole("button", { name: "Qabul qilish" }).click();
  await expect(a.locator(".invite-code")).toBeVisible();
  expect(a.url()).not.toBe(old);
  for (const p of [a, b]) {
    const cancel = p.getByRole("button", {
      name: "O‘yinni bekor qilish",
      exact: true,
    });
    if (await cancel.count()) {
      p.once("dialog", (d) => d.accept());
      await cancel.click();
      break;
    }
  }
  expect(errors).toEqual([]);
  await one.close();
  await two.close();
});
