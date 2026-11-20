# Fase 6: Perceber antes de ficar negativo

## Objetivo

O dono vê, antes do mês começar, quando a renda dele não cobre o que já está comprometido, e acha
rápido o que dá para cortar. Tudo sai de fatos já na planilha ou no banco: o Neko não prevê nada além
do Diário estimado que o próprio método autoriza.

## O que entra

| Peça | Onde | Regra (`packages/engine`) |
|---|---|---|
| Mês no vermelho | Aviso em Hoje, abre o Mês | `monthsAhead`: o primeiro dos próximos 3 meses em que a sobra mais o guardado fica abaixo de zero (`month-negative`). Diz quanto falta e, quando a renda própria do mês é conhecida, quanto dela contas e faturas já levam. |
| Renda comprometida | Aviso em Hoje, abre o Mês | `monthsAhead`: no próximo mês, contas e faturas já na planilha levam 80% ou mais da renda própria (`income-committed`). Diz quanto sobra para o dia a dia. |
| Assinaturas | Painel em Faturas (meia tela), a folha de cada uma e "Revisar uma a uma" | `subscriptions`: cobrança de mesmo valor, no mesmo cartão do dono, de 26 a 35 dias depois da anterior, ao menos 2 vezes, a última nos últimos 40 dias. Fora: parcelas, IOF, multa, juros e cartões de outra pessoa. `subscriptionList` junta as marcas do dono: "Vou cancelar", "Manter" e "Não é assinatura" (sai da lista e do total; volta com um toque). O painel mostra quatro linhas, primeiro o que pede atenção (cobrou depois de marcada para cancelar, subiu ou é nova), depois as maiores, e o resto num toque ("Ver mais"); embaixo, em palavras, a que cobrou de novo depois de marcada, quanto as marcadas para cancelar tiram por mês e "Você já cortou" (marcada e sem cobrar há 40 dias: fato, não estimativa). Um toque abre a folha: valor por mês e em um ano, as últimas cobranças, Manter ou Vou cancelar, Dividir com alguém e Não é assinatura. "Revisar uma a uma" passa pelas sem decisão, uma por vez (botão, seta no teclado ou deslizar o cartão: esquerda cancela, direita mantém, e os botões na mesma ordem; "Pular" deixa sem decisão), como a revisão do Monarch, e termina com o total que sai por mês e o nome de cada decisão que não salvou, para tentar de novo. Uma assinatura nova, que subiu ou que cobrou de novo depois de marcada vira um aviso, uma vez (`subscriptionNews`), sem modelo de IA. |
| Teto do mês | Hoje ("Teto de outubro", com os chips Cartões e Pix), lembrete da manhã e Ajustes | `cardsBillSpend` mais o Pix do mês: tudo que o banco já põe nas faturas do mês que vem dos cartões do dono (compras, parcelas e assinaturas; sem pagamentos, sem os cartões de outra pessoa e sem as compras marcadas como de outra pessoa) somado ao Pix, débito e dinheiro do mês que a planilha não planejou (`variableSpend(...).pix`: sem contas da planilha, sem o que vai para a reserva, sem transferências entre as contas do dono), contra o teto (`cycleBudget`). Um teto só para o gasto variável inteiro, porque o Pix fora do teto deixava o mês negativo sem aviso. Mostra quanto ainda cabe, não um valor por dia: o diário do método é média, não teto por dia, e gastar o máximo todo dia não deixa sobra. Avisa em 50%, 75% e 100% (`ceilingMark`). É o "teto de fatura" citado na comunidade do método, e bate com o que o app do banco mostra. Sem banco, fica o ciclo do cartão principal. |
| Dá para guardar com o teto | Mês (termômetro) e lembrete do dia do salário | `ceilingHeld`: com o teto ligado, cada mês a partir do próximo cujas faturas do dono na planilha ainda estão abaixo do teto vai levar o resto, em fatura ou em Pix. O saldo de cada dia desse mês em diante conta com isso antes de dizer quanto dá para guardar, para o "guardar primeiro" do dia do salário não levar o dinheiro que as faturas ainda vão usar. Para quem gasta no cartão, o diário do método são as faturas, e o teto é o plano do próprio dono para elas. |
| Compras de outras pessoas | Faturas: a página de cada cartão, "De quem é?" em cada compra, o "A receber" e a página de cada pessoa | O dono marca uma compra no próprio cartão como de outra pessoa (`ownerKey`, `owedOnBills`), inteira ou só uma parte ("Dividir o valor": metade, um terço ou outro valor, a `share` de cada cobrança): uma parcela leva o parcelamento inteiro, uma assinatura todo mês do mesmo valor (`monthlyKey`), outra compra vale só para ela. Só a parte do dono conta no teto; a da pessoa aparece no "A receber" do mês, com as parcelas que ainda vêm. A página do cartão mostra a fatura com a barra "Seu" e cada pessoa, as compras do banco por dia (parcelas no fim) e filtros por tipo e pessoa. A página da pessoa soma o mês dela (o cartão dela, quando tem, e as compras nos cartões do dono), diz até quando vão as parcelas e monta a mensagem para ela, que o dono pode ler antes ("Ver a mensagem") e manda pelo compartilhar do celular: o Neko não manda nada sozinho. Nada é adivinhado. Padrão de mercado: dono por transação do Monarch, o "Dividir valor" do Nubank e o saldo por amigo do Splitwise. |
| Reserva em degraus | Mês (cartão Reserva), o cartão do dia do salário em Hoje e a Mia | `reserveSteps` e `savingStep` (`reserve.ts`): primeiro R$ 3.000 (pulado quando um mês de custo de vida já passa disso), depois 1, 3, 6 e 12 meses de custo de vida (a média dos 3 últimos meses fechados, sem desconto). A tela mostra só o próximo degrau e quanto falta; o resto fica em "Como funciona". Com 6 meses guardados o método está cumprido, e 12 é escolha do dono. Um degrau perto anima mais que uma meta longe (Colby e Chapman, 2013). |
| Custo de vida | Reserva | `livingCost` deixa de fora o que outra pessoa paga de volta, o cartão de outra pessoa e o dinheiro que só passa pela conta (sai e volta no mesmo dia com o mesmo nome e valor). |

`ownIncome` é a Entrada sem reembolsos, sem repasses e sem o que vem da reserva; `committed` é a
Saída sem esses mesmos itens. As marcas ficam em `UserSettings` (D1), por loja e valor: `cancel` (e
`cancelOn`, o dia da marca, para saber se cobrou depois), `kept`, `notSubs` e `owners` (de quem é,
com a `share` quando dividida); `onArrival` guarda quem só entra na planilha quando o Pix cai. Uma
marca de cancelar que parou de cobrar vira "Você já cortou". As rotas são `PUT /api/banks/subscription`,
`/api/banks/owner` e `/api/banks/person`; nenhuma grava na planilha.

## Fora

- Cancelar pelo app e alertas de gasto "fora do normal" por IA.
- Qualquer escrita na planilha: nada aqui grava.
