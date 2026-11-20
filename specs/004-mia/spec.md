# Fase 4: Mia, a assistente que lê o Neko

## Objetivo

Responder em português, por texto, perguntas sobre as finanças do dono, como "quanto gastei com
mercado em setembro?", "outubro está melhor que setembro?" ou "posso comprar um fone de R$ 600 em
3x?", só com o que o Neko já calculou. O estudo da API e a pesquisa de mercado que embasaram as
escolhas ficam fora do repositório.

Critério de aceite: com a chave configurada, a marca da Mia (o traço do Neko de olhos âmbar) no
topo de Hoje, Faturas e Mês, no site e no Android, abre a conversa. Todo valor em dinheiro da
resposta tem origem numa ferramenta do Neko ou numa conta feita sobre esses números, e o que não
tem origem nunca chega à tela como conferido.

Há duas versões. A **Mia 2** (agente gerenciado da Anthropic, desde 2026-11-12) responde quando a
chave da API, o token do MCP e o endereço do site estão configurados; senão responde a **Mia 1**
(Messages API). A Mia 1 também preenche o "Numa frase" de Lançar (005, Fase 4).

## Regras que não mudam

- **O modelo nunca inventa dinheiro.** Os números vêm das ferramentas do Neko, que leem o motor. A
  Mia 1 nem escreve valores: aponta referências. A Mia 2 escreve, e o Worker confere cada um.
- **"Não sei" é uma resposta.** Quando nenhuma ferramenta cobre a pergunta, a Mia diz o que não
  consegue ver em vez de chutar.
- **Sem previsão própria.** A Mia fala do que a planilha e o banco têm e do que o método autoriza.
  Para "e se" e para como os próximos meses podem ficar, a Mia 2 usa Simular (007) e diz que é uma
  simulação, sem nada salvo. Ela não chuta salário, reajuste nem renda não confirmada.
- **Nenhuma escrita.** A Mia não muda a planilha nem os ajustes. O máximo que faz é deixar um
  lançamento em Para lançar, que só entra na planilha quando o dono toca em Lançar.
- **Teto de gasto:** US$ 80 por mês na API, somando as duas Mias e a leitura de faturas em PDF
  (003), medido no D1 (`mia_usage`) a cada chamada, com o mesmo limite no workspace do Console. Ao
  atingir o teto, a Mia pausa até o mês seguinte e o resto do Neko segue normal.
- Repositório público: nenhum dado real em código, testes ou prompts. Os testes usam dados
  inventados.

## Mia 2

### Como funciona

- **Agente gerenciado** (Claude Managed Agents), modelo Claude Sonnet 5.5 (`mia2.ts`). Na primeira
  pergunta o Worker cria o ambiente (nuvem, rede limitada aos servidores MCP), o depósito de memória,
  o cofre com o token do MCP e o agente, e guarda os ids no D1 (`mia2_setup`, migração 0018). Mudar
  a definição cria uma versão nova do agente; conversas abertas seguem na delas.
- **Uma sessão por conversa** ("Nova conversa"), em `mia2_session`. O sandbox do agente roda bash
  (python3) para somas, médias e diferenças; busca e leitura na web ficam desligadas.
- **Rotas** (com sessão): `POST /api/mia2` recebe `{pergunta, sessao?}` e devolve linhas NDJSON
  enquanto ela trabalha (`sessao`, `status`, `parcial`, `mensagem`, `grafico`, `numeros`,
  `veredito`, `refazendo`, `fim`, `erro`); `POST /api/mia2/parar` interrompe; `GET /api/mia2/rotina`
  traz o resumo que ela deixou (abaixo). A volta continua até o fim mesmo se o celular sair, para
  o custo ser contado.
- **Limites:** US$ 2 por conversa, dentro do teto do mês; uma pergunta que passa de 4 minutos é
  parada e dada como falha.

### Ferramentas do Neko (MCP)

O endpoint `/api/mcp` (`mcp.ts`) serve as ferramentas pelo Model Context Protocol, com o token
`MIA_MCP_TOKEN` (bearer). Os valores saem em reais, para ela poder fazer contas e gráficos.

| Ferramenta | O que devolve |
|---|---|
| `hoje` | A data, o saldo de hoje, quanto ainda cabe, o diário previsto e o que vence em 7 dias |
| `periodo` | "mês passado", "últimos 3 meses" e afins em meses `AAAA-MM` |
| `mes`, `dias_do_mes` | Um mês: entradas, saídas, diário, resultado, guardado, custo de vida, maiores saídas; e dia a dia |
| `comparar_meses`, `resumo_meses` | Dois meses lado a lado; vários meses em série |
| `gasto_com` | Por mês, as saídas cujo nome contém o termo, e o total |
| `semana` | A semana que passou: cartões e Pix contra a anterior e dias lançados |
| `faturas` | Cada cartão: fatura aberta, fechamento, vencimento, se é o principal ou de outra pessoa |
| `reserva` | A reserva em degraus (006): os alcançados, o próximo e quanto falta |
| `simular` | Simular (007) sob um ritmo e com "e se", sem salvar nada |
| `posso_comprar` | O veredito de uma compra (abaixo) |
| `para_lancar` | O que espera em Para lançar |
| `vigia` | O que a vigia diária achou (abaixo) e as assinaturas novas ou mais caras |
| `propor_lancamento` | A única que não só lê: deixa um lançamento em Para lançar |

Além delas, duas ferramentas da tela: `mostrar_numeros` (um quadro de 2 a 4 números) e
`mostrar_grafico` (linha ou barras, em reais). No máximo uma de cada por resposta.

### Conferência dos números (`grounding.ts`)

Todo R$ no texto, no quadro, no gráfico e nos rótulos e notas deles precisa ter aparecido na saída
de uma ferramenta do Neko, numa conta que ela rodou sobre esses números ou na pergunta do dono.
Cada valor conferido leva à tela de onde veio. Um valor do texto sem origem faz a resposta ser
refeita uma vez (`refazendo`); se continuar sem origem, ele aparece marcado, nunca como conferido.

### Como ela responde

O dono lê no celular, de relance: uma frase com o número principal em negrito, até 3 itens de uma
linha, no máximo 60 palavras. Números para comparar vão no quadro e séries no gráfico, sem repetir
no texto. As palavras aparecem no ritmo de leitura (`miaPace.ts`, `Mia2Pace.kt`). O texto do
prompt fica em `SYSTEM`, em `mia2.ts`.

### Posso comprar?

`posso_comprar` roda `checkPurchase` (`packages/engine/src/purchase.ts`), que lê Simular com e sem a
compra, no teto quando há um. O veredito é do Neko, nunca dela, e aparece acima da resposta com o
que foi suposto (valor, parcelas, cartão ou Pix, quanto o bem dura):

- **Não cabe:** passa do teto deste mês (`teto`) ou deixa o saldo negativo (`negativo`).
- **Aperta:** uma das faturas das parcelas passa do teto (`meses`), as parcelas duram mais que o
  bem (`duracao`: o método só parcela bem durável, e não além da vida dele) ou o saldo já está
  negativo (`ja_negativo`).
- **Cabe:** nada disso.

Compra parcelada exige `dura_meses` (o que foi dito ou a estimativa dela; 0 para o que se consome
logo). Sem meio dito, vale o cartão principal; sem parcelas, à vista.

### Propor um lançamento

Quando o dono pede para lançar algo que contou, `propor_lancamento` grava um `EntryInput` em
`mia_proposal` (migração 0019), conferido de novo na saída. Ele aparece em Para lançar como os itens
do banco (chave `mia:<id>`) e entra na planilha por `/api/entries`, como qualquer outro, quando o
dono toca em Lançar. Lançar ou Ignorar fica em `queue_decision`.

### Rotinas (`routines.ts`)

Depois da leitura dos bancos das 06:00, aos domingos ela resume a semana e no dia 1º fecha o mês que
acabou (o dia 1º toma o lugar do domingo). A resposta fica 7 dias (`setting` `mia_rotina`) e abre
como o começo de uma conversa na tela da Mia, com sugestões de continuação; a conversa anterior
pode voltar com Desfazer. A primeira frase dela aparece na linha da Mia em Hoje (abaixo). O celular
recebe um aviso (canal "Resumos da Mia"). O pedido não tem
algarismos, porque os números da pergunta contam como conferidos. A rotina nunca propõe lançamento.

### A vigia diária (`packages/engine/src/watch.ts`)

Depois da leitura dos bancos das 06:00, regras simples olham os cartões do dono (nunca os de outra
pessoa) nos últimos 7 dias. Sem custo de IA: a frase sai dos números das regras.

- **Cobrança repetida:** a mesma loja, o mesmo valor (R$ 20 ou mais), no mesmo cartão, em dias
  seguidos ou no mesmo dia, sem ser parcela. Sai uma notificação no canal Avisos, uma vez por
  cobrança (`setting` `watch_said`, tipo `vigia` em `notice`), sugerindo contestar se foi uma compra
  só.
- **Estorno e contestação:** dinheiro que um cartão devolveu (crédito que não é pagamento de
  fatura nem de tarifa) e o crédito de uma contestação. Só aparece na linha de Hoje, sem notificação.

Ficam de fora, por darem alarme falso demais nos dados reais: loja nunca vista, cartão parado,
compra negada e reembolso que não veio. Assinatura nova ou mais cara continua em
`subscriptions.ts`, com a notificação dela.

### A linha da Mia em Hoje (`shared/note.ts`, `worker/note.ts`)

No topo de Hoje, uma linha com a marca da Mia, um título curto e uma frase: a cobrança repetida
mais nova primeiro, depois a assinatura fora do padrão, o estorno e, por fim, a rotina dela enquanto
é novidade. Uma linha por vez. A frase é montada dos números das regras (`miaNote`), então não
custa nada e nunca erra um valor.

- **Tocar** pergunta à Mia sobre o achado numa conversa nova (a aberta vai para Desfazer); a rotina
  abre como ela deixou. Com a Mia 2 desligada, o toque abre Faturas.
- **O ×** dispensa. Tocada ou dispensada, a linha não volta em nenhum aparelho:
  `POST /api/mia/nota` guarda o id (`vigia:<chave>` ou `rotina:<id>`) em `setting` `mia_note_seen`.
  A rotina lida na tela da Mia também sai da linha.
- Vai pronta em `GET /api/projection` e `GET /api/today` (campo `nota`). Um erro ao montá-la só
  esconde a linha; Hoje nunca falha por ela.

### Memória

Ela guarda só fatos duráveis que o dono contar (quem é quem, preferências, combinados), nunca
valores que mudam nem senhas.

## Mia 1

- **Modelos:** Claude Haiku 5.5 com effort `low` responde primeiro. O Worker refaz no Claude Sonnet
  5.5 com effort `medium` quando o Haiku pede (`precisa_escalar`), recusa ou falha duas vezes na
  validação. A 70% do teto, deixa de escalar.
- **Referências em vez de valores:** as ferramentas (`packages/engine/src/mia.ts`: `periodo`, `hoje`,
  `mes`, `comparar_meses`, `gasto_com`, `faturas`, `reserva`) devolvem cada valor como
  `{"ref": "v3", "cents": 12345, "tipo": "diferenca"}`, e o texto traz `{{v3}}`. A tela troca pela
  quantia com o mesmo `money()` de sempre. Diferenças, direção e percentuais vêm prontos do motor.
- **Validação** (`checkAnswer`) recusa `R$` ou centavos no texto, `{{ref}}` que nenhuma ferramenta
  devolveu, verbos de conta ("somando") e comparação ("subiu") sem referência de diferença.
- **Chamada:** Messages API por `fetch`, sem SDK, com Zod na resposta; até 4 voltas de ferramentas;
  histórico de até 6 trocas, guardado pelo cliente. Resposta final pela ferramenta `responder`.
  Ferramentas e system fixos byte a byte, com `cache_control`. A data de hoje vai na mensagem do
  usuário, nunca no prefixo.
- **Rotas:** `GET /api/mia` diz se está ligada, pausada, quanto do mês foi usado e qual versão
  responde; `POST /api/mia` recebe `{pergunta, historico}` e devolve `{texto, valores}`;
  `POST /api/mia/lancamento` preenche Lançar a partir de uma frase.

## Telas (web e Android 1:1)

A tela própria da Mia (`/mia` no site) abre em tela cheia, sem a barra de abas, com o campo preso
acima do teclado e sugestões de pergunta sobre a tela de onde ela foi aberta (`?de=faturas`,
`?de=mes`; atalho M no site). Voltar retorna à tela anterior e a conversa continua até "Nova
conversa". No computador, a Mia vira um chat de tela larga, com o campo já focado e o atalho "/".
Sem a chave, a marca não aparece.

## Fora do escopo

- Voz, busca na web e análise profunda com Opus ou Fable.
- Escrever na planilha ou mudar ajustes.
- Avaliação automática das respostas: o conjunto de perguntas planejado para a Mia 1
  (`apps/neko/evals/`) não foi feito. Os testes cobrem ferramentas, validação, conferência e o
  contrato das linhas com uma API falsa.

## Passos do dono

1. Criar no Console da Anthropic um workspace `mia` com limite de US$ 80 por mês e uma chave só
   dela, no secret `ANTHROPIC_API_KEY` do Worker.
2. Gerar um token aleatório para o MCP, no secret `MIA_MCP_TOKEN` (nunca derivado de outro secret).
