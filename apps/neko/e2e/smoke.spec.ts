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
  "/api/mia": { ligada: true, usadoPct: 3, pausadaAte: null },
  "/api/settings": {
    dailyForecast: null,
    usualCard: null,
    cycleBudget: null,
    cards: [],
    othersCards: ["Cartão Verde"],
    writing: true,
    previstoSince: "2026-07-01",
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

// An invented answer, shaped like the Worker's: the text points, the values come beside it.
const MIA_REPLY = {
  texto: "Em setembro saíram {{v1}}, e as saídas caíram {{v2}} desde agosto.",
  valores: {
    v1: { tipo: "total", rotulo: "Saídas de 2026-09", tela: "mes", mes: "2026-09", cents: 512_340 },
    v2: { tipo: "diferenca", rotulo: "Saídas: 2026-09 menos 2026-08", tela: "mes", cents: -20_000 },
  },
  modelo: "claude-haiku-5-5",
};

/** Answers the API from fixtures and fails the test on any error the page logs or throws. */
const open = async (page: Page, path: string, body = projection) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.route("**/api/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/mia" && route.request().method() === "POST")
      return route.fulfill({ json: MIA_REPLY });
    if (pathname === "/api/entries/preview")
      return route.fulfill({ json: { parts: [{ fingerprint: "f" }] } });
    if (pathname === "/api/entries")
      return route.fulfill({ json: { entryId: "e", state: "done" } });
    if (pathname === "/api/projection")
      return route.fulfill({ contentType: "application/json", body });
    if (pathname in API) return route.fulfill({ json: API[pathname] });
    return route.fulfill({ status: 204 });
  });
  await page.goto(path);
  return errors;
};

for (const [path, heading] of [
  ["/", "Hoje"],
  ["/faturas", "Faturas"],
  ["/mes", "Mês"],
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
  const queue = page.getByRole("region", { name: "Para lançar" });
  await expect(queue.getByRole("button", { name: "Lançar" })).toHaveCount(3);
  await expect(queue).toContainText("Diário de 03/10");
  await queue.screenshot({ path: "test-results/para-lancar.png" });
  await queue.getByRole("button", { name: "Lançar" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Lançado na planilha" })).toBeVisible();
  await expect(queue.getByRole("button", { name: "Lançar" })).toHaveCount(2);
  await page.getByRole("link", { name: "Faturas", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Faturas no banco" })).toBeVisible();
  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bancos" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Azul Platinum/ })).toHaveValue("Cartão Azul");
  expect(errors).toEqual([]);
});

test("the Diário previsto paces the month, closes the day and asks for its review", async ({
  page,
}) => {
  const errors = await open(page, "/");
  await expect(page.getByRole("heading", { name: "Diário de outubro" })).toBeVisible();
  await expect(page.locator(".behind")).toContainText(
    "Uns 4 dias sem gastar e você volta ao previsto",
  );
  const queue = page.getByRole("region", { name: "Para lançar" });
  await expect(queue).toContainText("Fechar o dia");
  await expect(queue).toContainText("Diário de 04/10: R$ 95,00 → R$ 0,00");
  const review = page.getByRole("region", { name: "Diário previsto" });
  await expect(review.getByRole("button", { name: "Trocar para R$ 100,00" })).toBeVisible();
  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await expect(page.getByRole("switch", { name: /Diário previsto/ })).toBeChecked();
  await page.getByRole("button", { name: "Trocar o valor" }).click();
  await expect(page.getByRole("form", { name: "Diário previsto" })).toContainText(
    "um dia seu custa R$ 100,00",
  );
  expect(errors).toEqual([]);
});

test("Mia answers with the engine's values, each one a link to its screen", async ({ page }) => {
  const errors = await open(page, "/");
  await page.getByRole("button", { name: "Perguntar à Mia" }).click();
  await page.getByRole("button", { name: "Quanto saiu no mês passado?" }).click();
  const answer = page.getByRole("region", { name: "Conversa com a Mia" });
  await expect(answer.getByRole("link", { name: /5\.123,40/ })).toHaveAttribute("href", "/mes");
  // A difference shows its size; "caíram" already says which way.
  await expect(answer.getByRole("link", { name: /200,00/ })).not.toContainText("−");
  await answer.screenshot({ path: "test-results/mia.png" });
  expect(errors).toEqual([]);
});

test("a card named after a known bank shows the bank's mark", async ({ page }) => {
  // The fixture's invented cards, renamed to banks the app knows.
  const banks = projection.replaceAll("Cartão Azul", "Nubank").replaceAll("Cartão Verde", "Itaú");
  const errors = await open(page, "/faturas", banks);
  await expect(page.locator(".avatar.brand").first()).toBeVisible();
  await expect(page.locator(".avatar.mono")).toHaveCount(0);
  await page.screenshot({ path: "test-results/logos-faturas.png", fullPage: true });
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

test("keys switch screens and months, but a calendar arrow stays in the calendar", async ({
  page,
}) => {
  await open(page, "/");
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  await page.keyboard.press("3");
  await expect(page).toHaveURL(/\/mes$/);
  const month = page.locator(".month-nav h2");
  const shown = (await month.textContent()) ?? "";
  await page.locator(".thermo-grid button.day").first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(month).toHaveText(shown);
  await page.locator(".month-nav h2").click();
  await page.keyboard.press("ArrowLeft");
  await expect(month).not.toHaveText(shown);
  await page.keyboard.press("4");
  await expect(page).toHaveURL(/\/ajustes$/);
});

test("Lançar à mão asks the value, how it was paid and the name, then offers Desfazer", async ({
  page,
}) => {
  // A card takes purchases once its closing day is set in Ajustes.
  const data = JSON.parse(projection);
  data.cardsKnown[0].closingEstimated = false;
  const errors = await open(page, "/", JSON.stringify(data));
  await page.getByRole("button", { name: "Lançar", exact: true }).first().click();
  const form = page.getByRole("form", { name: "Lançar à mão" });
  await form.getByLabel("Valor").fill("18,90");
  await form.getByRole("button", { name: "Cartão Azul" }).click();
  await form.getByRole("button", { name: "3×" }).click();
  await form.getByLabel("Nome").fill("Padaria");
  await form.screenshot({ path: "test-results/lancar-a-mao.png" });
  await form.getByRole("button", { name: "Lançar" }).click();
  await expect(page.getByRole("button", { name: "Desfazer" })).toBeVisible();
  await expect(form).toBeHidden();
  expect(errors).toEqual([]);
});

test("with nothing left to launch, Para lançar compares the Saldo with the bank", async ({
  page,
}) => {
  const data = JSON.parse(projection);
  data.bank.queue = [];
  const errors = await open(page, "/", JSON.stringify(data));
  const queue = page.getByRole("region", { name: "Para lançar" });
  await expect(queue).toContainText("Faltam");
  await queue.getByRole("button", { name: "Lançar a diferença" }).click();
  await queue.screenshot({ path: "test-results/saldo.png" });
  expect(errors).toEqual([]);
});
