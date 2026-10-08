# Fase 4: Mia, a assistente que lê o Neko

## Objetivo

Responder em português, por texto, perguntas sobre a planilha do dono, como "quanto gastei com
mercado em setembro?", "outubro está melhor que setembro?" ou "quanto cabe por dia até a fatura
fechar?". A Mia usa só o que o engine já calculou. O estudo da API e a pesquisa de mercado que embasam as
escolhas estão fora do repositório, em `/mnt/project-files/neko/notes/mia-estudo-api.md` e
`mia-pesquisa-mercado-2026-10-08.md`.

Critério de aceite: com a chave configurada, o botão "Perguntar à Mia" no Hoje (web e Android) abre
uma conversa. Cada valor em dinheiro da resposta vem de uma tool do engine, e uma resposta com
dinheiro escrito pelo modelo nunca chega à tela.

## Regras que não mudam

- **O modelo nunca escreve dinheiro nem faz conta.** As tools devolvem cada valor como uma
  referência tipada (`{"ref": "v3", "cents": 12345, "tipo": "diferenca"}`), e o texto da resposta
  traz `{{v3}}` no lugar. Quem troca a referência pelo valor formatado é a tela, com o mesmo
  `money()` de sempre. Cada referência guarda também um rótulo e a tela de origem, e tocar no
  valor leva até ela.
- **Diferenças, direção e percentuais vêm prontos do engine.** O modelo não soma, não subtrai e não
  divide. "Subiu" ou "a mais" só passam junto de uma referência do tipo `diferenca` ou
  `percentual`.
- **"Não sei" é uma resposta.** Quando nenhuma tool cobre a pergunta, a Mia diz o que não consegue
  ver em vez de chutar. Pontos a conferir na planilha voltam em cada tool, e a Mia os menciona.
- **Sem previsão.** A Mia só fala do que a planilha tem e do que o método autoriza (o diário
  estimado). Ela não chuta salário, reajuste nem renda não confirmada.
- **Nenhuma escrita.** A Mia não muda a planilha nem os ajustes.
- **Teto de gasto:** US$ 80 por mês na API, medido no D1 a cada chamada. Ao atingir o teto, a Mia
  pausa até o mês seguinte e o resto do Neko segue normal.
- Repositório público: nenhum dado real em código, testes ou prompts. Os testes usam a planilha
  inventada do e2e.

## Decisões

- **Modelos:** Claude Haiku 5.5 com effort `low` responde primeiro. O Worker refaz a pergunta no
  Claude Sonnet 5.5 com effort `medium` em três casos:
  - o Haiku pede (`precisa_escalar: true`);
  - a resposta falha duas vezes na validação (a primeira falha volta ao Haiku com o motivo);
  - o Haiku recusa.

  Opus e Fable ficam fora da v1. Advisor tool não, porque a medição oficial mostra custo maior e
  ganho zero em perguntas e respostas.
- **Chamada:** Messages API por `fetch` no Worker, sem SDK, com Zod na resposta. O loop de tools
  tem no máximo 4 voltas. O histórico tem no máximo 6 trocas, guardadas pelo cliente e reenviadas.
- **Resposta final:** a tool `responder` (`strict`), com `{texto, precisa_escalar}`.
- **Tools** (engine, `packages/engine/src/mia.ts`, puras, sobre a `Projection`):

  | Tool | Entrada | O que devolve |
  |---|---|---|
  | `periodo` | `{expressao}` | "mês passado", "últimos 3 meses" e afins em meses `AAAA-MM`, a partir do hoje da planilha |
  | `hoje` | — | saldo de hoje, quanto cabe por dia, fechamento e fatura aberta do cartão principal |
  | `mes` | `{mes: "AAAA-MM"}` | entradas, saídas, diário, resultado, guardado, custo de vida, saldo final e as maiores saídas |
  | `comparar_meses` | `{a, b}` | cada número dos dois meses, a diferença, a direção e o percentual |
  | `gasto_com` | `{termo, de, ate}` | por mês, as saídas cujo nome contém o termo, e o total |
  | `faturas` | — | cada cartão: fatura aberta, fechamento e vencimento |
  | `reserva` | — | a reserva de emergência como o Mês mostra |

- **Validação da resposta** (engine, `checkAnswer`), que recusa:
  - `R$` ou números com centavos no texto;
  - `{{ref}}` que nenhuma tool devolveu;
  - verbos de conta ("somando", "dá um total", "subtraindo");
  - comparação ("subiu", "a mais") sem uma referência de diferença ou percentual.
- **Datas relativas:** o Worker escreve "hoje é AAAA-MM-DD" na mensagem do usuário. O engine segue
  sem ler o relógio, e a data nunca entra no prefixo do prompt.
- **Cache:** tools e system ficam fixos, byte a byte, com `cache_control` no fim do system.
- **Gasto (D1, `mia_usage`):** cada chamada grava modelo, tokens e custo em micro-dólares, pelos
  preços oficiais.
  - A 70% do teto, o Worker deixa de escalar.
  - A 100%, `POST /api/mia` responde "pausada até dd/mm".
- **Rotas:**
  - `GET /api/mia`: se está ligada, se está pausada e quanto do mês foi usado.
  - `POST /api/mia`: `{pergunta, historico}` → `{texto, valores}`.

  Ambas exigem sessão.
- **Telas (web e Android 1:1):** "Perguntar à Mia" no Hoje abre a conversa, com a marca da Mia (o traço do Neko de olhos âmbar)
  no topo, sugestões de pergunta de um catálogo fixo e a resposta com os valores formatados.
  Enquanto as tools rodam, uma linha diz o que a Mia está lendo ("Lendo setembro…"). Sem a chave,
  o botão não aparece.
- **Avaliação desde o início:** `apps/neko/evals/mia.json` com 30 a 50 perguntas em pt-BR sobre a
  planilha inventada, corrigidas por código (tool chamada, referências usadas, "não sei" quando
  devido). Cada pergunta roda 3 vezes; só roda com a chave, fora do CI.

## Fora do escopo

- Memória entre conversas, agentes e voz. Notificações da Mia, resumo mensal narrado (batch) e análise profunda (Opus ou Fable).
- Dados do banco (Open Finance) nas tools. Ficam para quando as contas estiverem ligadas.

## Fatias

1. Engine: tools, referências e `checkAnswer`, com TDD.
2. Worker: cliente da API, loop, escalonamento, ledger e rotas, com testes usando uma API falsa.
3. Telas na web e no Android, com capturas.

## Passo do dono

Criar no Console da Anthropic um workspace `mia` com limite de US$ 80 por mês e uma chave só dela.
Colocar a chave como secret `ANTHROPIC_API_KEY` no Worker.
