import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";

const projection = readFileSync(join(import.meta.dirname, "projection.json"), "utf8");

const API: Record<string, unknown> = {
  "/api/me": { email: "dono@example.com" },
  "/api/config": { googleClientId: null },
  "/api/history": { points: [], delta: null },
  "/api/sessions": [],
  "/api/push/key": { publicKey: null },
  "/api/settings": {
    dailyForecast: null,
    usualCard: null,
    cycleBudget: null,
    cards: [],
    othersCards: ["Cartão Verde"],
  },
  // Invented bank, the same one e2e/make-projection.ts puts in the projection.
  "/api/banks": {
    configured: true,
    cards: [{ accountId: "cartao-azul", cardNumber: null, card: "Cartão Azul" }],
    items: [
      {
        itemId: "11111111-1111-4111-8111-111111111111",
        label: "Banco Azul",
        syncedAt: "2026-10-05T09:00:00.000Z",
        error: null,
        accounts: [
          {
            id: "conta",
            name: "Conta corrente",
            card: false,
            last4: "0001",
            balance: 2_353_747,
            cardNumbers: [],
          },
          {
            id: "cartao-azul",
            name: "Azul Platinum",
            card: true,
            last4: "4321",
            balance: 1_640_00,
            cardNumbers: ["4321", "8765"],
          },
        ],
      },
    ],
  },
};

/** Answers the API from fixtures and fails the test on any error the page logs or throws. */
const open = async (page: Page, path: string) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.route("**/api/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/projection")
      return route.fulfill({ contentType: "application/json", body: projection });
    if (pathname in API) return route.fulfill({ json: API[pathname] });
    return route.fulfill({ status: 204 });
  });
  await page.goto(path);
  return errors;
};

for (const [path, heading] of [
  ["/", "Hoje"],
  ["/faturas", "Faturas"],
  // Mês is titled by the month on screen: the fixture's today is 2026-10-05.
  ["/mes", /Outubro/i],
  ["/ajustes", "Ajustes"],
] as const) {
  test(`${path} renders from the projection without errors`, async ({ page }) => {
    const errors = await open(page, path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeAttached();
    await expect(page.locator("main")).not.toContainText("Esta tela travou");
    expect(errors).toEqual([]);
  });
}

test("the bank shows only where it and the sheet differ", async ({ page }) => {
  const errors = await open(page, "/");
  const missing = page.getByRole("region", { name: "Fora da planilha" });
  await expect(missing.getByRole("button")).toHaveCount(2);
  await page.getByRole("link", { name: "Faturas", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Já no banco" })).toBeVisible();
  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bancos" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Azul Platinum/ })).toHaveValue("Cartão Azul");
  expect(errors).toEqual([]);
});

test("the dock moves between the four tabs", async ({ page }) => {
  await open(page, "/");
  await page.getByRole("link", { name: "Faturas", exact: true }).click();
  await expect(page).toHaveURL(/\/faturas$/);
  await page.getByRole("link", { name: "Mês", exact: true }).click();
  await expect(page).toHaveURL(/\/mes$/);
});

test("a tip shows one at a time and stays gone once dismissed", async ({ page }) => {
  await open(page, "/");
  const tip = page.getByRole("complementary", { name: "Dica" });
  await expect(tip).toHaveCount(1);
  await tip.getByRole("button", { name: "Entendi" }).click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeAttached();
  await expect(tip).toHaveCount(0);
});

test("the month's wins become a picture to share, with no amounts", async ({ page }) => {
  const errors = await open(page, "/");
  const box = page.getByRole("list", { name: "Conquistas do mês" }).locator("..");
  const download = page.waitForEvent("download");
  await box.getByRole("button", { name: "Compartilhar" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("neko-conquista.png");
  if (process.env.WIN_CARD_OUT) await file.saveAs(process.env.WIN_CARD_OUT);
  expect(errors).toEqual([]);
});
