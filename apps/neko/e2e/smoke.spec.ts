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
    taps: [{ event: "simular", label: "Simular", count: 0 }],
    notices: [
      { event: "notificacao_manha", label: "Contas e teto", count: 3 },
      { event: "notificacao_noite", label: "Lançar o dia", count: 8 },
      { event: "notificacao_aviso", label: "Avisos", count: 0 },
    ],
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
const open = async (
  page: Page,
  path: string,
  body = projection,
  answers: Record<string, unknown> = API,
) => {
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
      ["/api/banks/subscription", "/api/banks/owner", "/api/banks/person"].includes(pathname)
    )
      return route.fulfill({ json: { ok: true } });
    if (pathname === "/api/projection")
      return route.fulfill({ contentType: "application/json", body });
    if (pathname in answers) return route.fulfill({ json: answers[pathname] });
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
  // A bar of the card's own chart opens that month, with the card's page still open.
  await page.getByRole("link", { name: /^Cartão Azul, .*: abrir a fatura$/ }).click();
  await page
    .locator(".bill-head")
    .getByRole("button", { name: /^Dezembro:/ })
    .click();
  await expect(page.getByRole("heading", { name: "Cartão Azul", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Faturas de dezembro" })).toBeVisible();
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

test("Parar on Mia 2 keeps a question typed during her answer, unsent", async ({ page }) => {
  const errors = await open(page, "/mia", projection, {
    ...API,
    "/api/mia": { ligada: true, usadoPct: 3, pausadaAte: null, versao: 2 },
  });
  const asked: string[] = [];
  // She takes her time: the answer is still on its way when Parar is tapped.
  await page.route("**/api/mia2", async (route) => {
    asked.push(route.request().postDataJSON().pergunta);
    await new Promise((r) => setTimeout(r, 5_000));
    await route.fulfill({ status: 200, body: "" }).catch(() => undefined);
  });
  await page.getByRole("button", { name: "Quanto ainda cabe este mês?" }).click();
  const field = page.getByRole("textbox", { name: "Pergunta para a Mia" });
  await field.fill("E a fatura de dezembro?");
  await field.press("Enter");
  await expect(page.locator("p.mia-held")).toHaveText("Sua pergunta vai quando ela terminar.");
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Parar" }).click();
  await expect(page.getByText("Você parou esta resposta.")).toBeVisible();
  await expect(field).toHaveValue("E a fatura de dezembro?");
  await expect(page.getByRole("button", { name: "Enviar" })).toBeEnabled();
  expect(asked).toEqual(["Quanto ainda cabe este mês?"]);
  expect(errors).toEqual([]);
});

test("Posso comprar on Mia 2 starts the question in the field and sends nothing", async ({
  page,
}) => {
  const errors = await open(page, "/mia", projection, {
    ...API,
    "/api/mia": { ligada: true, usadoPct: 3, pausadaAte: null, versao: 2 },
  });
  const asked: string[] = [];
  const lines = [
    { t: "sessao", id: "sesn_teste" },
    {
      t: "veredito",
      id: "v1",
      veredito: "aperta",
      valor: 400,
      parcelas: 2,
      meio: "cartao",
      dura: 96,
    },
    {
      t: "mensagem",
      id: "m1",
      texto: "Em dezembro, as faturas com a parcela passam do teto.",
      valores: {},
    },
    { t: "fim" },
  ];
  await page.route("**/api/mia2", async (route) => {
    asked.push(route.request().postDataJSON().pergunta);
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/x-ndjson" },
      body: lines.map((l) => `${JSON.stringify(l)}\n`).join(""),
    });
  });
  await page.getByRole("button", { name: "Posso comprar…?" }).click();
  const field = page.getByRole("textbox", { name: "Pergunta para a Mia" });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue("Posso comprar ");
  // Only the start: nothing to send yet, and the line under it says what she needs.
  await expect(page.getByRole("button", { name: "Enviar" })).toBeDisabled();
  await expect(field).toHaveAccessibleDescription(/O quê, quanto e como paga/);
  await expect(page.getByRole("button", { name: "Quanto ainda cabe este mês?" })).toHaveCount(0);
  // The cursor waits after the words: what is typed next finishes the question.
  await page.keyboard.type("um tênis de R$ 400 em 2x?");
  await expect(field).toHaveValue("Posso comprar um tênis de R$ 400 em 2x?");
  expect(asked).toEqual([]);
  await field.press("Enter");
  await expect.poll(() => asked).toEqual(["Posso comprar um tênis de R$ 400 em 2x?"]);
  // The verdict is the Neko's, over her reason, with the purchase as it was checked.
  const answer = page.getByRole("list", { name: "Conversa com a Mia" });
  await expect(answer.getByText("Aperta", { exact: true })).toBeVisible();
  await expect(answer.getByText("R$ 400,00 em 2x no cartão, dura uns 8 anos")).toBeVisible();
  // Next, the same purchase another way.
  await expect(page.getByRole("button", { name: "E em 1x no cartão?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "E no Pix?" })).toBeVisible();
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

const sentTo = (page: Page, path: string) =>
  page.waitForRequest((r) => r.url().endsWith(path) && r.method() === "PUT");

test("Faturas shows the subscriptions in half a screen and decides one in its sheet", async ({
  page,
}) => {
  const errors = await open(page, "/faturas");
  const subs = page.locator("section", { has: page.getByRole("heading", { name: "Assinaturas" }) });
  await expect(subs.getByText("R$ 563,50 por mês")).toBeVisible();
  // What asks for a look comes first: went up, new, charged after the mark.
  await expect(subs.getByRole("button", { name: /^Assistente Virtual Subiu/ })).toBeVisible();
  await expect(
    subs.getByRole("button", { name: /^Streaming de Filmes Cobrou de novo/ }),
  ).toBeVisible();
  await expect(subs.getByText("1 a cancelar: R$ 39,90 a menos por mês")).toBeVisible();
  await expect(subs.getByText("Você já cortou R$ 19,90 por mês", { exact: false })).toBeVisible();
  await expect(subs.getByRole("button", { name: /^Jornal Digital/ })).toHaveCount(0);
  await subs.getByRole("button", { name: "Ver as outras 1" }).click();
  await expect(subs.getByRole("button", { name: /^Jornal Digital/ })).toBeVisible();
  await subs.getByRole("button", { name: /^Assistente Virtual/ }).click();
  const sheet = page.getByRole("dialog", { name: "Assinatura" });
  await expect(sheet.getByText("R$ 1.320,00 em um ano · antes era R$ 100,00")).toBeVisible();
  const sent = sentTo(page, "/api/banks/subscription");
  // The choice follows what the server holds, so the click is checked through the request.
  await sheet.getByRole("radio", { name: "Vou cancelar" }).click();
  expect((await sent).postDataJSON()).toEqual({ key: "assistentevirtual|10000", mark: "cancel" });
  // Splitting it every month is the same "De quem é?", on the monthly mark.
  await sheet.getByRole("button", { name: /^Dividir com alguém/ }).click();
  await sheet.getByRole("radio", { name: "Bia" }).check();
  await expect(sheet.getByRole("switch", { name: /Dividir o valor/ })).toBeChecked();
  const split = sentTo(page, "/api/banks/owner");
  await sheet.getByRole("button", { name: "Salvar" }).click();
  expect((await split).postDataJSON()).toEqual({
    key: "cartao azul|assistentevirtual|11000|mensal",
    person: "Bia",
    share: 5500,
  });
  expect(errors).toEqual([]);
});

test("Revisar uma a uma goes through the undecided ones, by button or arrow key", async ({
  page,
}) => {
  const errors = await open(page, "/faturas?revisar=true");
  await expect(page.getByRole("heading", { name: "Revisar assinaturas" })).toBeVisible();
  await expect(page.getByText("1 de 5", { exact: true })).toBeVisible();
  await expect(page.getByText("R$ 2.784,00 em um ano")).toBeVisible();
  const first = sentTo(page, "/api/banks/subscription");
  await page.getByRole("button", { name: "Vou cancelar" }).click();
  expect((await first).postDataJSON()).toEqual({ key: "cursodeidiomas|23200", mark: "cancel" });
  await expect(page.getByText("2 de 5", { exact: true })).toBeVisible();
  const second = sentTo(page, "/api/banks/subscription");
  await page.keyboard.press("ArrowRight");
  expect((await second).postDataJSON()).toEqual({ key: "assistentevirtual|10000", mark: "keep" });
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Manter" }).click();
  await expect(page.getByRole("heading", { name: "Pronto" })).toBeFocused();
  await expect(
    page.getByText("1 assinatura marcada para cancelar.", { exact: false }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("a card's page shows whose each purchase is, and splits one with another value", async ({
  page,
}) => {
  const errors = await open(page, "/faturas?m=2026-11");
  await page.getByRole("link", { name: /^Cartão Azul, R\$ 2\.838,07/ }).click();
  await expect(page.getByRole("heading", { name: "Cartão Azul", exact: true })).toBeFocused();
  await expect(page.getByText("Seu R$ 525,00 · conta no teto")).toBeVisible();
  await page.getByRole("radio", { name: "Bia 2" }).check();
  await expect(
    page.getByText("3 de 6 · acaba em fev/27 · Dividida · Bia paga R$ 225,00"),
  ).toBeVisible();
  await expect(page.getByText("Compras do ciclo")).toHaveCount(0);
  await page.getByRole("button", { name: /^Loja de Móveis/ }).click();
  const sheet = page.getByRole("dialog", { name: "De quem é?" });
  await expect(sheet.getByRole("radio", { name: "Bia" })).toBeChecked();
  await expect(sheet.getByRole("radio", { name: "Metade" })).toBeChecked();
  await sheet.getByRole("radio", { name: "Outro valor" }).check();
  await sheet.getByRole("textbox", { name: /Bia paga/ }).fill("150");
  await expect(
    sheet.getByText("Vale para as 6 parcelas: R$ 150,00 por mês para Bia.", { exact: false }),
  ).toBeVisible();
  const sent = sentTo(page, "/api/banks/owner");
  await sheet.getByRole("button", { name: "Salvar" }).click();
  expect((await sent).postDataJSON()).toEqual({
    key: "cartao azul|lojademoveisparc|45000|6x",
    person: "Bia",
    share: 15000,
  });
  await page.getByRole("button", { name: "Faturas de novembro" }).click();
  await expect(page.getByRole("heading", { name: "Cartões" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a person's page sums their month and hands the message to the phone", async ({ page }) => {
  const errors = await open(page, "/faturas?m=2026-11");
  const owed = page.locator("section", { has: page.getByRole("heading", { name: "A receber" }) });
  await expect(owed.getByText("2 compras · mais R$ 934,80 em parcelas")).toBeVisible();
  await owed.getByRole("link", { name: /^Bia, R\$ 354,90/ }).click();
  await expect(page.getByRole("heading", { name: "Bia", exact: true })).toBeFocused();
  await expect(
    page.getByText("Depois de novembro ainda vêm R$ 934,80 em parcelas, até fev/27."),
  ).toBeVisible();
  await expect(
    page.getByText("Cartão Azul · parcela 3 de 6 · faltam R$ 675,00 · de R$ 450,00"),
  ).toBeVisible();
  // Neko sends nothing: the phone's share sheet gets the text.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", {
      value: async (d: { text: string }) => {
        (window as unknown as { shared: string }).shared = d.text;
      },
    });
  });
  await page.getByRole("button", { name: "Mandar para Bia" }).click();
  const text = (
    await page.evaluate(() => (window as unknown as { shared: string }).shared)
  ).replaceAll("\u00a0", " ");
  expect(text).toContain("Oi, Bia! Sua parte nas faturas de novembro:");
  expect(text).toContain("• Loja de Móveis (parcela 3 de 6): R$ 225,00");
  expect(text).toContain("Total: R$ 354,90");
  const sent = sentTo(page, "/api/banks/person");
  await page.getByRole("radio", { name: "Quando o Pix cair" }).click();
  expect((await sent).postDataJSON()).toEqual({ person: "Bia", onArrival: true });
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
  // What saving it all does to the reserve: R$ 16.800 kept plus R$ 11.200 passes 3 months of cost.
  await expect(save).toContainText("Com isso, a reserva chega a 3 meses de custo de vida");
  await expect(page.getByRole("list", { name: "Avisos" }).getByText(/guardar/)).toHaveCount(0);
  // Mês warns of it on today's month, and the warning opens the month it is about.
  await page.getByRole("link", { name: "Mês" }).first().click();
  // The reserve climbs in steps: the one being climbed and what it still needs.
  const reserve = page.getByRole("region", { name: "Reserva de emergência" });
  await expect(reserve).toContainText("Degrau 3 de 5");
  await expect(reserve).toContainText("Faltam R$ 1.746 para 3 meses de custo de vida");
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

test("Simular opens apart from Hoje, moves only copies of the balances and forgets them", async ({
  page,
}) => {
  const errors = await open(page, "/");
  await page.getByRole("link", { name: "Simular" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Simular" })).toBeFocused();
  await expect(page.getByText("Nada aqui é salvo")).toBeVisible();
  // No ceiling in Ajustes: the sheet as it is, or the last months' average.
  await expect(page.getByRole("radio", { name: "Só a planilha" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "Teto" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ajustes" }).first()).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /^Só com a planilha, o menor saldo é/ }),
  ).toBeVisible();
  // C adds a purchase, as the add button's title says.
  await page.keyboard.press("c");
  await expect(page.getByRole("textbox", { name: /Compra no Cartão Azul/ })).toBeFocused();
  await page.keyboard.type("600");
  // The parcels are one radio group: the arrows move the choice inside it.
  await page.getByRole("radio", { name: "2×", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "3×" })).toBeChecked();
  await expect(page.getByText("1ª parcela em 12 out")).toBeVisible();
  // On a chip a letter is still a shortcut: S adds a Saída.
  await page.keyboard.press("s");
  await expect(page.getByRole("textbox", { name: /Saída/ })).toBeFocused();
  await page.keyboard.type("50000");
  // In the red, the answer says when, and how deep it goes.
  await expect(
    page.getByRole("heading", {
      name: /^Só com a planilha, fica negativo em 5 out e chega a −R\$\s[\d.]+/,
    }),
  ).toBeVisible();
  // Each what-if's own effect, in reais, without remembering the number from before.
  await expect(page.getByText(/^As mudanças tiram R\$\s[\d.]+ do menor saldo/)).toBeVisible();
  // A typo says so at once; a stray Esc steps out of the field and never wipes the what-ifs.
  await page.getByRole("button", { name: "Entrada", exact: true }).click();
  await page.keyboard.type("1,500.50");
  await expect(page.getByText("Use um valor como 1.500,00.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { level: 1, name: "Simular" })).toBeFocused();
  await expect(page.getByText("Esc de novo sai e apaga as mudanças.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Entrada/ })).toHaveValue("1,500.50");
  await page.getByRole("button", { name: "Tirar entrada" }).click();
  await expect(page.getByRole("textbox", { name: /Saída/ })).toBeFocused();
  // Taken out by mistake, it comes back as it was, until the next change.
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByRole("textbox", { name: /Entrada/ })).toHaveValue("1,500.50");
  await expect(page.getByRole("textbox", { name: /Entrada/ })).toBeFocused();
  await page.getByRole("button", { name: "Tirar entrada" }).click();
  await expect(page.getByText("Entrada removida.")).toBeVisible();
  await expect(page.getByRole("figure").getByText("Simulação")).toBeVisible();
  await page.getByText("Mês a mês").click();
  await expect(page.getByRole("columnheader", { name: "Planilha" })).toBeVisible();
  await page.screenshot({ path: "test-results/simular.png", fullPage: true });
  // Leaving forgets it: back on Hoje, and a new visit starts clean.
  await page.getByRole("button", { name: "Voltar" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hoje" })).toBeVisible();
  await page.getByRole("link", { name: "Simular" }).click();
  await expect(
    page.getByRole("heading", { name: /^Só com a planilha, o menor saldo é/ }),
  ).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(0);
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

test("Simular keeps the what-ifs while Ajustes is read again, and lands on the new answer", async ({
  page,
}) => {
  await open(page, "about:blank");
  let fail = true;
  await page.route("**/api/settings", async (route) => {
    if (!fail)
      return route.fulfill({ json: { ...(API["/api/settings"] as object), cycleBudget: 300_000 } });
    // Slow enough to see "Tentando…" before it fails again, on a busy machine too.
    await new Promise((done) => setTimeout(done, 500));
    return route.fulfill({ status: 500, json: { error: "indisponível" } });
  });
  await page.goto("/simular");
  await expect(page.getByText("Não consegui ler o teto em Ajustes")).toBeVisible();
  await page.keyboard.press("c");
  await page.keyboard.type("600");
  // Failing again keeps the row, and the keys stay on the button.
  const retry = page.getByRole("button", { name: /^(Tentar de novo|Tentando…)$/ });
  await retry.click();
  await expect(retry).toHaveText("Tentando…");
  await expect(retry).toHaveText("Tentar de novo");
  await expect(retry).toBeFocused();
  await expect(page.getByRole("textbox", { name: /Compra/ })).toHaveValue("600");
  // Read at last: the ceiling joins the paces, the row is still there, the keys on the answer.
  fail = false;
  await retry.click();
  await expect(page.locator("#sim-verdict")).toBeFocused();
  await expect(page.getByRole("radio", { name: "Teto" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Compra/ })).toHaveValue("600");
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

test("Mia's line on Hoje goes with its cross, the figure takes the focus and the Worker is told", async ({
  page,
}) => {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/mia/nota")) seen.push(r.postData() ?? "");
  });
  const errors = await open(page, "/");
  const line = page.getByRole("complementary", { name: "Mia" });
  await expect(line).toContainText("Cobrança repetida");
  await expect(line).toContainText("Cinema Estrela cobrou R$ 64,00 duas vezes no Cartão Azul");
  await line.getByRole("button", { name: "Dispensar" }).click();
  await expect(line).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Diário de outubro" })).toBeFocused();
  await expect.poll(() => seen.length).toBe(1);
  expect(JSON.parse(seen[0] ?? "{}").id).toMatch(/^vigia:repetida\|/);
  expect(errors).toEqual([]);
});

test("the evening notification opens Hoje at Para lançar, its title in focus", async ({ page }) => {
  const errors = await open(page, "/#para-lancar");
  const queue = page.getByRole("region", { name: "Para lançar" });
  await expect(queue.getByRole("heading", { name: "Para lançar" })).toBeFocused();
  await expect
    .poll(() => queue.evaluate((el) => Math.round(el.getBoundingClientRect().top)))
    .toBe(16);
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

test.describe("at a desk", () => {
  // A mouse, no on-screen keyboard: the pointer is fine, as on a laptop.
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test("Mia is a chat in the middle, beside the rail, the field under her intro and in focus", async ({
    page,
  }) => {
    const errors = await open(page, "/mia", projection, {
      ...API,
      "/api/mia": { ligada: true, usadoPct: 3, pausadaAte: null, versao: 2 },
    });
    await page.route("**/api/mia2", (route) =>
      route.fulfill({
        status: 200,
        headers: { "content-type": "application/x-ndjson" },
        body: [
          { t: "sessao", id: "sesn_teste" },
          { t: "mensagem", id: "m1", texto: "Cabem R$ 300,00 até o fim do mês.", valores: {} },
          { t: "fim" },
        ]
          .map((l) => `${JSON.stringify(l)}\n`)
          .join(""),
      }),
    );
    const field = page.getByRole("textbox", { name: "Pergunta para a Mia" });
    // The field is ready for the first words, as in every desktop chat, the keys named under it.
    await expect(field).toBeFocused();
    await expect(page.getByText("volta ao campo")).toBeVisible();
    // The tabs stay at hand as the rail, none of them current: her bar says where he is.
    const rail = page.getByRole("navigation", { name: "Telas" });
    await expect(rail.getByRole("link")).toHaveCount(4);
    await expect(rail.locator("[aria-current]")).toHaveCount(0);
    const side = await rail.boundingBox();
    const bar = await page.locator(".mia-bar").boundingBox();
    const form = await page.locator("form.mia-form").boundingBox();
    const title = await page.getByRole("heading", { name: /Pergunte/ }).boundingBox();
    // Her bar runs from the rail to the window's edge; one column of 48rem in the room left.
    expect(side && bar && bar.x >= side.x + side.width && bar.x + bar.width === 1440).toBe(true);
    expect(form && Math.round(form.width)).toBe(768);
    expect(form && bar && Math.abs(form.x + form.width / 2 - (bar.x + bar.width / 2))).toBeLessThan(
      2,
    );
    expect(form && title && form.y > title.y && form.y < 900 * 0.7).toBe(true);
    // Starting a question keeps the field where it was.
    await page.getByRole("button", { name: "Posso comprar…?" }).click();
    expect((await page.locator("form.mia-form").boundingBox())?.y).toBe(form?.y);
    // After her answer the field keeps the focus: the next question is typed right away.
    await field.fill("Quanto ainda cabe?");
    await field.press("Enter");
    await expect(page.getByText("Cabem R$ 300,00 até o fim do mês.")).toBeVisible();
    await expect(field).toBeFocused();
    await page.keyboard.type("E dezembro?");
    await expect(field).toHaveValue("E dezembro?");
    // Back from a tab of the rail, the field has the focus again, under the same conversation.
    await rail.getByRole("link", { name: "Faturas", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Faturas" })).toBeVisible();
    await page.goBack();
    await expect(page.getByText("Cabem R$ 300,00 até o fim do mês.")).toBeVisible();
    await expect(field).toBeFocused();
    // From anywhere on the page, "/" goes back to the field, and types nothing.
    await page.getByRole("button", { name: "Nova conversa" }).focus();
    await page.keyboard.press("/");
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("");
    // In the conversation the keys give their room to her answers.
    await expect(page.getByText("volta ao campo")).toBeHidden();
    expect(errors).toEqual([]);
  });
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
  await expect(usage).toContainText("BotõesSimularNunca");
  await expect(usage).toContainText(
    "Notificações tocadasContas e teto3 vezesLançar o dia8 vezesAvisosNunca",
  );
  await expect(usage).toContainText("Nenhum valor da planilha");
  expect(errors).toEqual([]);
});
