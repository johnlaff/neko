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
2. **Primeiro lançamento real.** Rota no Worker atrás de um Durable Object que grava um
   lançamento por vez. Tela de lançamento na web e no Android, Entrada, Diário, Conta,
   Desfazer (restaura a célula se ela ainda estiver como o Neko deixou) e fila offline no Android.
   Interruptor para desligar a escrita sem deploy.
3. **Cartões.** Fatura certa, parcelas, cartão adicional e reembolso, estorno, fatura fechou (o
   valor real substitui a linha) e "o que compõe" cada fatura.
4. **Completo.** Editar, mover e apagar, repetir todo mês, fechar o dia, aba Economia, widget e
   bloco de configurações rápidas.
5. **Atalhos.** Mia transforma uma frase em proposta de lançamento; Open Finance sugere o que falta
   lançar; ambos esperam o toque do dono.

## Proteções da gravação (Fases 1+)

- A API do Google Sheets não tem trava nem "grave só se não mudou", e não restaura versões de
  planilha. Por isso a segurança fica no Neko: diário próprio, releitura antes, conferência depois e
  desfazer guardando a célula como estava.
- Intervalos protegidos na planilha (Data, Saldo, cabeçalhos, Economia) sem permissão para a conta
  do Neko.
- A chave do Neko que escreve nunca é a de leitura nem qualquer chave usada fora do Neko.
