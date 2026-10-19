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
| Assinaturas | Painel em Faturas | `subscriptions`: cobrança de mesmo valor, no mesmo cartão do dono, de 26 a 35 dias depois da anterior, ao menos 2 vezes, a última nos últimos 40 dias. Fora: parcelas, IOF, multa, juros e cartões de outra pessoa. O dono marca "Cancelar" e vê quanto deixa de sair por mês (o método junta tudo numa tag para cancelar de uma vez). |
| Teto dos cartões | Hoje ("Cartões em outubro") e Ajustes | `cardsMonthSpend`: compras do mês, pela data da compra, em todos os cartões do dono (sem os de outra pessoa), a compra parcelada pela parcela do mês e sem as assinaturas, contra o teto (`cycleBudget`). Mostra quanto cabe por dia até o fim do mês. Sem banco, fica o ciclo do cartão principal. Padrão de mercado: data da compra (YNAB, Monarch, Copilot), parcela do mês (Mobills, Dinzo, método), fixos à parte (Monarch Flex, Simplifi). |
| Custo de vida | Reserva | `livingCost` deixa de fora o que outra pessoa paga de volta, o cartão de outra pessoa e o dinheiro que só passa pela conta (sai e volta no mesmo dia com o mesmo nome e valor). |

`ownIncome` é a Entrada sem reembolsos, sem repasses e sem o que vem da reserva; `committed` é a
Saída sem esses mesmos itens. A marca "Cancelar" fica em `UserSettings.cancel` (D1), por loja e valor;
a marca de uma assinatura que parou de vir simplesmente some.

## Fora

- Cancelar pelo app e alertas de gasto "fora do normal" por IA.
- Qualquer escrita na planilha: nada aqui grava.
