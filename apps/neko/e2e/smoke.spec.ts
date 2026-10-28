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
  "/api/usage": {
    window: 30,
    days: 12,
    android: 10,
    web: 4,
    screens: [
      { event: "hoje", label: "Hoje", count: 31 },
      { event: "faturas", label: "Faturas", count: 6 },
    ],
    taps: [{ event: "simular", label: "Simular compra", count: 0 }],
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
            use: "corrente",
          },
          {
            id: "cartao-azul",
            name: "Azul Platinum",
            card: true,
            last4: "4321",
            balance: 1_640_00,
            cardNumbers: ["4321", "8765"],
            use: null,
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
    if (pathname === "/api/mia/lancamento")
      return route.fulfill({
        json: {
          lancamento: {
            kind: "cartao",
            card: "Cartão Azul",
            installments: 4,
            amount: 12_000,
            date: "2026-10-04",
            description: "Farmácia",
          },
        },
      });
    if (pathname === "/api/entries/preview")
      return route.fulfill({ json: { parts: [{ fingerprint: "f" }] } });
    if (pathname === "/api/entries")
      return route.fulfill({ json: { entryId: "e", state: "done" } });
    if (
      pathname.startsWith("/api/queue/") ||
      ["/api/banks/cancel", "/api/banks/owner"].includes(pathname)
    )
      return route.fulfill({ json: { ok: true } });
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
  // One item at a time, with the count and a way to the next one.
  await expect(queue.getByRole("button", { name: "Lançar" })).toHaveCount(1);
  await expect(queue).toContainText("1 de 6");
  // Each item says why it is there and what Lançar writes, line by line, with the day's total.
  await expect(queue).toContainText("Linha nova na planilha03/10 · DiárioR$ 42,50");
  await queue.getByRole("button", { name: "Detalhes" }).click();
  await expect(queue).toContainText("Diário do diaR$ 56,38 → R$ 98,88");
  await expect(queue.getByText("1 ignorado")).toBeVisible();
  const next = queue.getByRole("button", { name: "Próximo" });
  for (let i = 0; i < 3; i++) await next.click();
  await expect(queue).toContainText(
    "12/11 · Saída · Cartão AzulR$ 2.922,70era R$ 2.838,07+R$ 84,63",
  );
  // Why the bill goes up: the purchase the sheet lacks, in place of a sentence.
  await expect(queue).toContainText("Compras novas · R$ 84,63Padaria do Ze 4 outR$ 52,90");
  await queue.getByText("Mais 1 compra").click();
  await expect(queue).toContainText("Uber *trip 3 outR$ 4,00");
  await expect(queue).not.toContainText("O banco já tem compras");
  // Someone else's card: the bill and her payback go together unless only the bill is picked.
  await next.click();
  const choice = queue.getByRole("group", { name: "O que lançar" });
  await expect(choice.getByRole("button", { name: "Fatura e reembolso" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(queue).toContainText("12/11 · Entrada · Cartão Verde");
  await choice.getByRole("button", { name: "Só a fatura" }).click();
  await expect(queue).not.toContainText("12/11 · Entrada · Cartão Verde");
  // A question about an account comes last, naming the account.
  await next.click();
  await expect(queue).toContainText("6 de 6");
  await expect(queue.getByRole("listitem").last()).toContainText("Conta Banco Verde");
  await expect(queue.getByRole("button", { name: "Guarda", exact: true })).toBeVisible();
  await queue.screenshot({ path: "test-results/para-lancar.png" });
  await queue.getByRole("button", { name: "Anterior" }).click();
  await queue.getByRole("button", { name: "Lançar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Lançado na planilha" })).toBeVisible();
  // The next one takes its place, and the count keeps its place in the whole queue.
  await expect(queue.getByRole("button", { name: "Guarda", exact: true })).toBeVisible();
  await expect(queue).toContainText("6 de 6");
  // Ignorar takes an item away with Desfazer, like a launch.
  await queue.getByRole("button", { name: "Ignorar" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Ignorado" })).toBeVisible();
  await expect(queue).toContainText("Fatura Cartão Azul");
  await page.getByRole("link", { name: "Faturas", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Por mês" })).toBeVisible();
  // A bar of the card's own chart opens that month, with the card still open.
  await page.getByRole("button", { name: /Cartão Azul: ver/ }).click();
  await page
    .locator(".invoice-detail")
    .getByRole("button", { name: /^Dezembro:/ })
    .click();
  await expect(page.getByText("Vencem em dezembro")).toBeVisible();
  await expect(page.getByRole("button", { name: /Cartão Azul: fechar/ })).toBeVisible();
  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bancos" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Azul Platinum/ })).toHaveValue("Cartão Azul");
  await expect(page.getByRole("combobox", { name: /Conta corrente/ })).toHaveValue("corrente");
  expect(errors).toEqual([]);
});

test("the Diário previsto paces the month, closes the day and asks for its review", async ({
  page,
}) => {
  const errors = await open(page, "/");
  await expect(page.getByRole("heading", { name: "Diário de outubro" })).toBeVisible();
  // What still fits in the month, never split by the days left: the diário is an average.
  await expect(page.locator(".dial-label")).toContainText("Ainda cabem");
  await expect(page.locator(".dial-label")).toContainText("de R$ 2.945,00 no mês");
  await expect(page.locator(".behind")).toHaveText(
    "R$ 352,20 acima do previsto até ontem. Uns 4 dias sem gastar e você volta ao previsto.",
  );
  await expect(page.locator(".dial-label")).not.toContainText("por dia");
  const queue = page.getByRole("region", { name: "Para lançar" });
  await queue.getByRole("button", { name: "Próximo" }).click();
  await queue.getByRole("button", { name: "Próximo" }).click();
  await expect(queue).toContainText("Fechar o dia");
  await expect(queue).toContainText("04/10 · DiárioR$ 0,00era R$ 95,00−R$ 95,00");
  const review = page.getByRole("region", { name: "Diário previsto" });
  await expect(review).toContainText(
    "Hora de ver se o valor ainda serve. Usar grava o novo valor nos dias que vêm, até dezembro de 2026.",
  );
  await expect(review.getByRole("button", { name: "Usar R$ 100,00" })).toBeVisible();
  // Keeping writes nothing, and says why the panel goes.
  await review.getByRole("button", { name: "Manter R$ 95,00" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Mantido. O Neko pergunta de novo em 3 meses" }),
  ).toBeVisible();
  // The keyboard goes on to the next days, not back to the top of the page.
  await expect(page.getByRole("heading", { name: "Próximos 7 dias" })).toBeFocused();
  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await expect(page.getByRole("switch", { name: /Diário previsto/ })).toBeChecked();
  await page.getByRole("button", { name: "Trocar o valor" }).click();
  await expect(page.getByRole("form", { name: "Diário previsto" })).toContainText(
    "um dia seu custa R$ 100,00",
  );
  expect(errors).toEqual([]);
});

test("Mia answers on her own screen with the engine's values, each one a link", async ({
  page,
}) => {
  const errors = await open(page, "/");
  await page.getByRole("link", { name: /^Perguntar à Mia/ }).click();
  await expect(page).toHaveURL(/\/mia$/);
  // Her screen is the whole page: no tabs, a way back.
  await expect(page.getByRole("navigation", { name: "Telas" })).toHaveCount(0);
  await page.getByRole("button", { name: "Quanto saiu no mês passado?" }).click();
  const answer = page.getByRole("list", { name: "Conversa com a Mia" });
  await expect(answer.getByRole("link", { name: /5\.123,40/ })).toHaveAttribute(
    "href",
    "/mes?m=2026-09",
  );
  // A difference shows its size; "caíram" already says which way.
  await expect(answer.getByRole("link", { name: /200,00/ })).not.toContainText("−");
  // The month the numbers came from is a way out, and the next questions are a tap away.
  await expect(answer.getByRole("link", { name: "Ver setembro" })).toHaveAttribute(
    "href",
    "/mes?m=2026-09",
  );
  await expect(page.getByRole("button", { name: "Quanto ainda cabe?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quanto saiu no mês passado?" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/mia.png" });
  // Leaving and coming back finds the conversation where it was.
  await page.getByRole("button", { name: "Voltar" }).click();
  await expect(page).toHaveURL(/\/$/);
  // Back on Hoje, the keyboard carries on from her mark in the head, now saying she remembers.
  const resume = page.getByRole("link", { name: "Continuar a conversa com a Mia" });
  await expect(resume).toBeFocused();
  await resume.click();
  await expect(answer.getByRole("link", { name: "Ver setembro" })).toBeVisible();
  await page.getByRole("button", { name: "Nova conversa" }).click();
  await expect(page.getByRole("button", { name: "Como está minha reserva?" })).toBeVisible();
  // From another tab, Mia's mark in the head opens her with questions about that screen.
  await page.getByRole("button", { name: "Voltar" }).click();
  await page.getByRole("link", { name: "Faturas", exact: true }).click();
  await expect(page).toHaveURL(/\/faturas$/);
  await page.getByRole("link", { name: "Perguntar à Mia sobre as faturas" }).click();
  await expect(page).toHaveURL(/\/mia\?de=faturas$/);
  await expect(page.getByRole("heading", { name: "Pergunte sobre as faturas" })).toBeVisible();
  await page.getByRole("button", { name: "Voltar" }).click();
  await expect(page).toHaveURL(/\/faturas$/);
  await expect(page.getByRole("link", { name: "Perguntar à Mia sobre as faturas" })).toBeFocused();
  await page.getByRole("link", { name: "Perguntar à Mia sobre as faturas" }).click();

  await page.getByRole("textbox", { name: "Pergunta para a Mia" }).press("Escape");
  await expect(page).toHaveURL(/\/faturas$/);
  expect(errors).toEqual([]);
});

test("Faturas lists the monthly charges and marks one to cancel", async ({ page }) => {
  const errors = await open(page, "/faturas");
  const subs = page.locator("section", { has: page.getByRole("heading", { name: "Assinaturas" }) });
  await expect(subs.getByText("R$ 139,80 por mês")).toBeVisible();
  await expect(subs.getByText("Marcadas: R$ 39,90 a menos por mês")).toBeVisible();
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/api/banks/cancel") && r.method() === "PUT",
  );
  await subs.getByRole("button", { name: "Vou cancelar Academia do Bairro" }).click();
  expect((await sent).postDataJSON()).toEqual({ key: "academiadobairro|9990", on: true });
  expect(errors).toEqual([]);
});

test("Faturas marks a purchase as someone else's and shows what they owe", async ({ page }) => {
  const errors = await open(page, "/faturas");
  await page
    .getByRole("button", { name: /^Novembro:/ })
    .first()
    .click();
  const owed = page.locator("section", { has: page.getByRole("heading", { name: "A receber" }) });
  await expect(owed.getByText("Bia")).toBeVisible();
  await expect(owed.getByText("R$ 129,90")).toBeVisible();
  await expect(owed.getByText("1 compra · mais R$ 259,80 nas próximas parcelas")).toBeVisible();
  // Each purchase opens with where it is: the card, its bill and the parcels left.
  await owed.getByRole("button", { name: "Bia: ver compras" }).click();
  await expect(owed.getByText("Cartão Azul · vence 12 nov")).toBeVisible();
  await expect(owed.getByText("2 out · parcela 1 de 3 · faltam R$ 259,80")).toBeVisible();
  // A purchase there opens the same "De quem é?", to fix the mark without hunting for it.
  await owed.getByRole("button", { name: /^Fone, R\$ 129,90, de Bia/ }).click();
  await expect(owed.getByRole("button", { name: "É minha" })).toBeVisible();
  await owed.getByRole("button", { name: /^Fone, R\$ 129,90, de Bia/ }).click();
  await owed.screenshot({ path: "test-results/owed-detail.png" });
  await page.getByRole("button", { name: "Cartão Azul: ver detalhes" }).click();
  await page.getByText("Parcelas no banco (2)").click();
  await expect(page.getByText("De Bia · 1/3 · Faltam 2")).toBeVisible();
  await page.getByRole("button", { name: /Loja de Móveis/ }).click();
  await expect(page.getByText("De quem são estas parcelas? Vale para todas.")).toBeVisible();
  await page.screenshot({ path: "test-results/owed-faturas.png", fullPage: true });
  const sent = page.waitForRequest(
    (r) => r.url().endsWith("/api/banks/owner") && r.method() === "PUT",
  );
  await page.getByRole("button", { name: "Bia", exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({
    key: "cartao azul|lojademoveisparc|45000|6x",
    person: "Bia",
  });
  expect(errors).toEqual([]);
});

test("Hoje shows one warning at a time and leaves the months ahead to Mês", async ({ page }) => {
  const errors = await open(page, "/");
  await expect(page.getByText("Fatura acima do normal")).toBeVisible();
  // One warning at a time: the others wait behind a quiet line.
  await expect(page.getByText("Qual dia fecha o Cartão Azul?")).toBeHidden();
  await expect(page.getByText("Mais 1 aviso")).toBeVisible();
  await expect(page.getByText("Novembro gasta mais do que entra")).toHaveCount(0);
  // The payday's saving is a panel of its own, not one more warning.
  const save = page.getByRole("region", { name: "Dia de guardar" });
  await expect(save).toContainText("Na conta, dá para guardar R$ 11.200,00 hoje");
  await expect(page.getByRole("list", { name: "Avisos" }).getByText(/guardar/)).toHaveCount(0);
  // Mês warns of it on today's month, and the warning opens the month it is about.
  await page.getByRole("link", { name: "Mês" }).first().click();
  const warnings = page.getByRole("list", { name: "Avisos" });
  await warnings.getByText("Novembro gasta mais do que entra").click();
  await expect(page.getByRole("heading", { name: "Novembro 2026" })).toBeVisible();
  // There it stays, a plain row: it is already where it points.
  await expect(warnings.getByText("Novembro gasta mais do que entra")).toBeVisible();
  await expect(warnings.getByRole("link")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Hoje keeps to its three fixed panels on a day with nothing special", async ({ page }) => {
  const errors = await open(page, "/");
  await expect(page.getByRole("heading", { name: "Próximos 7 dias" })).toBeVisible();
  // The run only on the day of a mark or a record; the closed month lives in Mês.
  await expect(page.getByText(/Planilha em dia/)).toHaveCount(0);
  await expect(page.getByText("Setembro fechou")).toHaveCount(0);
  const marked = JSON.parse(projection);
  marked.habit = { ...marked.habit, milestone: 14 };
  await open(page, "/", JSON.stringify(marked));
  await expect(page.getByText(/Planilha em dia/)).toBeVisible();
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
  const errors = await open(page, "/mes?m=2026-09");
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

test("with the month's ceiling, Hoje shows what still fits for cards and Pix", async ({ page }) => {
  const data = JSON.parse(projection);
  data.previsto.on = false;
  data.projection.canSpend = {
    ...data.projection.canSpend,
    mode: "cards",
    card: "",
    budget: 250_000,
    budgetSource: "configured",
    // Next month's bills and this month's Pix already hold R$ 600 of a R$ 2.500 ceiling.
    accumulated: 60_000,
    bills: 45_000,
    pix: 15_000,
    daysLeft: 27,
    perDay: 7_037,
    closing: "2026-10-31",
    due: "2026-11-30",
    cycleDays: 31,
    paceExpected: 60_000,
    paceGap: 0,
    overBy: 0,
    daysBehind: 0,
    left: 190_000,
    used: 0,
  };
  const errors = await open(page, "/", JSON.stringify(data));
  await expect(page.getByRole("heading", { name: "Teto de outubro" })).toBeVisible();
  await expect(page.getByText("Ainda cabem")).toBeVisible();
  await expect(page.getByText("Dentro do teto")).toBeVisible();
  await expect(page.getByText("Cartões R$ 450,00")).toBeVisible();
  await expect(page.getByText("Pix R$ 150,00")).toBeVisible();
  await page.getByText("Como calculei").click();
  await expect(page.getByText(/2\.500,00 de teto no mês menos R\$\s450,00/)).toBeVisible();
  await page.screenshot({ path: "test-results/teto-cartoes.png", fullPage: true });
  expect(errors).toEqual([]);
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

test("Lançar com a Mia fills the form from one sentence, and only Lançar writes", async ({
  page,
}) => {
  const data = JSON.parse(projection);
  data.cardsKnown[0].closingEstimated = false;
  const errors = await open(page, "/", JSON.stringify(data));
  await page.getByRole("button", { name: "Lançar", exact: true }).first().click();
  const form = page.getByRole("form", { name: "Lançar à mão" });
  await form.getByLabel("Numa frase").fill("farmácia 120 no azul em 4x ontem");
  // Enter fills; it does not launch.
  await form.getByLabel("Numa frase").press("Enter");
  await expect(form.getByText("A Mia preencheu. Confira e lance.")).toBeVisible();
  await expect(form.getByLabel("Valor")).toHaveValue("120,00");
  await expect(form.getByRole("button", { name: "Cartão Azul" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(form.getByRole("button", { name: "4×" })).toHaveAttribute("aria-pressed", "true");
  await expect(form.getByLabel("Nome")).toHaveValue("Farmácia");
  await expect(form.getByLabel("Dia")).toHaveValue("2026-10-04");
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(0);
  await form.screenshot({ path: "test-results/lancar-com-a-mia.png" });
  await form.getByRole("button", { name: "Lançar" }).click();
  await expect(page.getByRole("button", { name: "Desfazer" })).toBeVisible();
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

test("on a desktop the tabs stand on the left and the panels in three columns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors = await open(page, "/");
  const tabs = await page.getByRole("navigation", { name: "Telas" }).boundingBox();
  const dial = await page.getByRole("heading", { name: "Diário de outubro" }).boundingBox();
  const queue = await page.getByRole("region", { name: "Para lançar" }).boundingBox();
  const next = await page.getByRole("heading", { name: "Próximos 7 dias" }).boundingBox();
  expect(tabs && dial && tabs.x + tabs.width < dial.x).toBe(true);
  // Para lançar stands in the column beside the dial, near the top; what to know goes to the third.
  expect(dial && queue && queue.x > dial.x + 300 && queue.y < dial.y + 300).toBe(true);
  expect(queue && next && next.x > queue.x + 300).toBe(true);
  expect(errors).toEqual([]);
});

test("Neko counts the screens it shows, and Ajustes tells what was used", async ({ page }) => {
  const counted: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/usage") && r.method() === "POST")
      counted.push(JSON.parse(r.postData() ?? "{}").event);
  });
  const errors = await open(page, "/");
  await page.getByRole("link", { name: "Ajustes", exact: true }).click();
  await expect.poll(() => counted).toEqual(["hoje", "ajustes"]);
  const usage = page.getByRole("region", { name: "Uso do Neko" });
  await usage.getByText("Aberto em 12 dos últimos 30 dias").click();
  await expect(usage).toContainText("OndeNo app Android10 dias");
  await expect(usage).toContainText("TelasHoje31 vezes");
  await expect(usage).toContainText("BotõesSimular compraNunca");
  await expect(usage).toContainText("Nenhum valor da planilha");
  expect(errors).toEqual([]);
});
