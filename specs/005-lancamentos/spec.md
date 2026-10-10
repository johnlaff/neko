# Fase 5: Lançar pelo Neko

## Objetivo

Tudo o que o dono faz à mão na planilha passa a poder ser feito no Neko, em menos toques: lançar uma
entrada, uma saída, um gasto do dia ou uma compra no cartão, com parcelas, e depois editar, mover ou
desfazer. A planilha continua sendo a fonte da verdade. O Neko escreve nela exatamente como o dono
escreveria: na mesma célula, com a mesma nota e a mesma soma.

Critério de aceite: um lançamento comum (valor, como pagou, Lançar) leva até 3 toques, mostra antes
de gravar onde vai cair e quanto a célula muda, e pode ser desfeito. Depois de gravar, os saldos da
planilha mudam exatamente o valor lançado, e nenhuma outra célula muda.

## Regras que não mudam

- O Neko só escreve quando o dono toca em Lançar (ou Desfazer, Editar, Mover). Nada é gravado sozinho,
  nem com dados do banco ou da Mia: esses só sugerem lançamentos.
- Só as células Entrada, Saída e Diário de datas reais das abas de ano. Nunca Data, Saldo,
  cabeçalhos, outras abas ou dias que não existem (30 de fevereiro).
- Uma célula que o leitor não entende por inteiro não é tocada (ver "Célula limpa"). O Neko mostra o
  endereço e o dono arruma na planilha.
- Sem previsão feita pelo Neko. O Diário do dia recebe só o que foi gasto.
- Regras de finanças no `packages/engine`, formato da planilha no `packages/sheet-reader`, os dois
  puros e com testes. O Worker orquestra e grava; a web e o Android só mostram.

## Onde cada lançamento vai (o método)

| Tipo (`EntryKind`) | Coluna e dia | Seção da nota |
|---|---|---|
| `entrada` (salário, rendimento, reembolso) | Entrada, no dia em que cai | nenhuma |
| `diario` (Pix, débito, dinheiro) | Diário, no dia | nenhuma |
| `conta` (conta fixa) | Saída, no dia do pagamento | `CONTAS` |
| `investimento` (previdência, curso) | Saída, no dia | `Investimento:` |
| `reserva` (reserva de emergência) | Saída, no dia | `Reserva:` |
| `cartao` (compra no cartão) | Saída, no vencimento da fatura em que a compra cai | `CARTÕES`, na linha do cartão |

- Compra no cartão nunca vai no Diário: soma na fatura. Compra até o dia de fechamento (inclusive)
  entra na fatura que fecha nesse dia; depois dele, na seguinte (`cycleContaining`).
- Parcelado: uma parcela em cada fatura seguinte; os centavos que não dividem vão na primeira
  (`splitInstallments`). Até 24 parcelas.
- Uma linha por cartão na fatura (decisão do dono, 2026-10-09): a compra soma na linha
  `R$ x - <cartão>` e no termo correspondente da fórmula. A lista de compras que forma a fatura fica no
  Neko, não na nota. Se a fatura ainda não tem linha desse cartão, ela é criada em `CARTÕES`. Uma
  linha `R$ 0,00` (fatura vazia) é substituída pelo valor.
- Cartão com dia de fechamento só estimado não aceita lançamento: o dono configura o fechamento antes.
- Pix e débito vão no Diário (decisão do dono, 2026-10-09), como o método ensina.
- Transferência entre contas do próprio dono não é lançada: o método trata todas as contas correntes
  como um saldo só.

## Célula limpa (`checkCell`)

O escritor só edita uma célula que esteja num destes estados:

- vazia, ou com o `0` literal de um Diário sem gasto;
- um número, com uma nota de uma linha desse valor;
- `=SUM(a+b+…)` só de números, em que os termos são exatamente as linhas não zero da nota (a ordem
  pode variar), o valor mostrado é a soma e a nota não tem linha `R$` ilegível.

Qualquer outra coisa é recusada com o motivo: texto, outra fórmula, valor sem nota, nota e fórmula
com valores diferentes, valor negativo.

## A edição (`planCellEdit`)

- Fórmula no dialeto da planilha, como o dono digita: vírgula decimal, sem separador de milhar, sem
  zero à direita (`42,4`, `20`, `0,01`). O novo termo entra depois do último, preservando espaços e
  quebras de linha (`=SUM(6012,73+1\n)`). Um número solto vira `=SUM(a+b)`. Testado na planilha real
  em 2026-10-09: a API, com `USER_ENTERED`, entende `=SUM(405,51+20)` como 425,51.
- Nota no formato do dono: `R$ 1.234,56 - Descrição`. Linha sem seção entra acima do primeiro
  cabeçalho; linha com seção entra no fim da seção; seção que não existe é criada no fim da nota. O
  resto do texto fica idêntico, byte a byte.
- A descrição vira uma linha só e não pode começar com `R$`.
- **Trocar, mover e apagar** (Fase 2): com `was`, a edição muda uma linha que já existe em vez de
  somar uma nova. A linha `descrição` que vale `was`, na mesma seção, passa a valer o novo valor, e
  o termo igual da fórmula muda junto; com valor 0, a linha e o termo saem, o cabeçalho que fica
  sem linhas sai também, e a célula sem nenhuma linha fica vazia. Numa linha de cartão, `was` é o
  que a linha vale agora (0 sem linha) e o valor é o novo total da fatura. Se a linha não está mais
  lá com aquele valor, a edição é recusada e o item é refeito. Mover é apagar num dia e somar no
  outro, no mesmo lançamento, que grava inteiro ou nada.
- O plano relê a própria saída com as mesmas regras e só é devolvido se for uma célula limpa que
  vale `antes + valor`. Senão é erro de programação, não gravação.

## Fases

0. **Fundação, sem gravar (feita).** `placeEntry` no engine, `checkCell` e `planCellEdit` no
   leitor, com testes de exemplo e de propriedade, e o ensaio na cópia real
   (`apps/neko/test/real-sheet-edit.test.ts`, com `NEKO_REAL_SHEET`): planeja um lançamento em cada
   célula e exige que toda célula a partir do ano anterior ao atual seja limpa.
1. **Planilha de teste (esta entrega).** Conta de serviço `neko-writer` (Editor, separada da
   `neko-reader`), escopo `spreadsheets`, chave no secret `NEKO_WRITER_SERVICE_ACCOUNT_JSON`.
   Diário de operações no D1 (`entry_op`, migração 0008): chave de idempotência, célula, valor e
   nota antes e depois, estado. O gravador (`apps/neko/src/worker/writer.ts`):
   - `previewEntry` lê as células e devolve o que muda, com a impressão digital de cada célula;
   - `commitEntry` relê, recusa se a célula mudou desde a prévia, grava o diário, grava valor e
     nota num único `updateCells`, relê e confere a célula e o Saldo do dia. Se algo não bate, a
     célula volta ao que era; se uma parcela falha, as já gravadas são desfeitas;
   - `undoEntry` devolve cada célula ao que era, só se ela ainda estiver como o Neko deixou.
   Os testes de contrato (`apps/neko/test/sheet-writer.contract.test.ts`) rodam no CI contra a
   planilha "Neko Teste" (pt-BR, dados inventados, mesmas proteções), um de cada vez, e desfazem o
   que gravam. Nenhuma rota do Worker grava ainda.
2. **Conferência e Economia (plano v27, aprovado em 2026-10-09).** O gravador troca, move e apaga
   uma linha. A fila **Para lançar** na tela Hoje (no lugar de "Fora da planilha") compara o banco
   com a planilha todo dia e propõe, já do jeito do método (`buildQueue`, `packages/engine/src/queue.ts`):
   - Entrada nova, ou a linha planejada corrigida (valor e dia). O salário cai líquido: o banco é
     comparado com o salário menos as Saídas do dia, e o dono escolhe se mudou o salário ou um
     desconto.
   - Pix, débito e saque no Diário; conta planejada parecida (até 25% e 7 dias) é corrigida. Dois
     candidatos iguais: o dono escolhe.
   - A linha de cada cartão vai ao total do banco em cada fatura futura, num item por cartão, com as
     parcelas até a última. Sobe sempre; baixa só com a fatura fechada ou por arredondamento (até
     R$ 0,10). No cartão de outra pessoa, o dono diz se o reembolso planejado acompanha.
   - Dinheiro para uma conta sua: pergunta uma vez se ela é de guardar. Para ela, Saída em
     `Reserva:`; de volta dela, Entrada em `Reserva:`. O que acontece dentro dela não vira item.
     Um Pix lançado como guardado faz a próxima vez da mesma origem vir como guardado.
   - Só o confirmado (pendente espera), só os últimos 40 dias. Ignorado e lançado não voltam
     (`queue_decision`, migração 0009); desfazer traz o item de volta.
   - "Saldo bate": o Saldo de ontem contra a soma das contas correntes (sem as de guardar), com o
     banco que não atualizou hoje nomeado. A diferença pode ser lançada como Entrada ou Saída.
   O app manda um rascunho (`Draft`), nunca células: o Worker transforma em lançamentos
   (`placeDraft`), mostra a prévia e grava (`/api/entries`, um por vez, trava no D1), com Desfazer
   e o interruptor em Ajustes. Lançar à mão no botão Lançar da tela Hoje. O aviso das 21h abre o
   Neko quando a gravação está ligada.
   - Aba Economia: guardar soma e resgatar subtrai na célula Economia do mês, do jeito do método
     (`=500+500-300`), no mesmo envio da linha em `Reserva:` (`withEconomia`). Ou as duas gravam,
     ou nenhuma. O gravador acha o mês pelo bloco do ano na linha 4 (`ano | Entradas | Economia`)
     e para se a aba mudou ou o ano não tem bloco. A fila mostra a mudança ("Economia de out:
     +R$ 500,00"), porque o Neko não lê essa aba.
3. **Diário previsto.** Para quem paga quase tudo no cartão, o método põe no Diário dos dias
   futuros o que um dia costuma custar, para o Saldo à frente não parecer folgado
   (`packages/engine/src/forecast.ts`).
   - **Valor sugerido:** os últimos 90 dias do banco (ou desde que há dados de cartão e de conta,
     com pelo menos 28 dias): compras nos cartões do dono pelo valor cheio (a parcelada conta
     inteira no dia da compra; parcelas seguintes, pagamentos e o cartão de outra pessoa ficam de
     fora) mais Pix e débito que a planilha não planejou (sem contas de guardar). Dividido pelos
     dias e arredondado para cima em reais (`suggestDaily`). O dono aprova ou troca o valor.
   - **Preencher:** em Ajustes › Planilha, cada dia de hoje até dezembro da última aba de ano
     recebe uma linha `R$ X - Previsto` no Diário (`=SUM(X)`), só onde o Diário está vazio ou só
     com a previsão. Uma gravação por aba (`writeForecast`): lê a aba, grava tudo num
     `batchUpdate`, relê e confere cada célula e o Saldo; se algo não bate, a aba volta como era.
     O valor fica salvo (`dailyForecast`, `previstoSince`) só depois que a planilha tem.
   - **Fechar o dia:** um dia que passou com previsão vira um item da fila ("Fechar o dia"), que
     troca a previsão pelo que foi gasto: 0 quando tudo foi no cartão. Um Pix lançado no Diário
     tira a previsão do dia na mesma edição (`dropForecast`). Dias vazios à frente (uma aba de ano
     nova) voltam como item para preencher. Nenhum banco casa com uma linha Previsto.
   - **Bem ou mal:** com a previsão ligada, "Hoje cabem" é o mês: o Diário × dias do mês menos o
     que o banco mostra gasto antes de hoje, dividido pelos dias que faltam, e "R$ X acima do
     previsto, uns N dias sem gastar" quando o mês passou do ritmo. Hoje, o widget, o aviso das 8h
     e a Mia mudam juntos.
   - **A cada 3 meses:** Hoje mostra o gasto real por dia ao lado do valor, com "Trocar para" e
     "Manter" (que conta mais 3 meses).
   - **Desligar:** apaga só as linhas Previsto dos dias que vêm; o que o dono escreveu fica.
4. **Mia.** Uma frase vira um item da fila, com o mesmo toque para aprovar. Em Lançar, com a Mia
   ligada, "Numa frase" ("farmácia 120 no azul em 3x ontem") preenche valor, como pagou, parcelas,
   nome e dia; o dono confere e toca em Lançar, como sempre. Uma chamada ao Haiku com a ferramenta
   `lancamento` obrigatória (`fillEntry`, rota `/api/mia/lancamento`), contada no limite do mês da
   Mia. O motor (`entryFromMia`) só aceita o que confere: cartão que o dono tem, valor positivo, dia
   a menos de um ano de hoje, até 24 parcelas; o resto fica em branco para o dono escolher. A Mia
   nunca grava.

## Proteções da gravação (Fases 1+)

- A API do Google Sheets não tem trava nem "grave só se não mudou", e não restaura versões de
  planilha. Por isso a segurança fica no Neko: diário próprio, releitura antes, conferência depois e
  desfazer guardando a célula como estava.
- Intervalos protegidos na planilha (Data, Saldo, cabeçalhos, totais e as outras abas) sem
  permissão para a conta do Neko. Na aba Economia, só as células Economia de cada mês ficam livres
  (script `proteger-planilha.gs`, fora do Git).
- A chave do Neko que escreve nunca é a de leitura nem qualquer chave usada fora do Neko.
