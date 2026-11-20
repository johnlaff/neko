# Fase 8: Parcelas

## Objetivo

As parcelas estão espalhadas: cada fatura mostra as suas ("4 de 10 · acaba em jun/27"), mas para
saber quanto sai por mês só em parcelas, quanto isso pesa na renda e no teto e quando o peso
diminui era preciso abrir cartão por cartão e somar de cabeça. Esta parte junta tudo numa tela,
sem previsão: só o que já foi comprado.

Critério de aceite: Faturas tem um painel Parcelas (quando há parcelas do dono) com o total nas
faturas do mês, o peso na renda e as colunas dos meses à frente, e um toque abre a tela Parcelas,
com o mês, o mês a mês, quando cada compra acaba e o detalhe de cada uma; as parcelas de outra
pessoa ficam num filtro à parte; a fatura de cada cartão, no filtro Parcelas, diz o total delas e
abre a tela. Web e Android com os mesmos números.

## Regras que não mudam

- Sem previsão: os meses à frente têm só as parcelas de compras já feitas, por isso as colunas só
  descem. Uma compra nova entra quando aparece no banco, com o chip "Nova".
- Os números vêm do banco (Open Finance e a fatura em PDF), que manda cada parcela como "n de N".
  A parcela n numa fatura é a n + 1 na seguinte e a n − 1 na anterior; uma fatura que o banco ainda
  não listou leva a parcela mais próxima que ele listou. Nada é estimado além disso.
- Nada é gravado: nem na planilha, nem no banco de dados. A planilha continua sendo a fonte; a tela
  só mostra a conferência que já existe (as faturas da planilha têm as parcelas, ou "Corrigir em
  Para lançar").
- Regras no motor (`installmentPlans` em `packages/engine/src/installments.ts`, com testes) e uma só
  visão para site e Android (`parcels` em `invoicesView`, `apps/neko/src/shared/screens.ts`).

## Decisões

- **Uma compra, de fatura em fatura.** O banco escreve as parcelas futuras com um texto mais curto
  e põe o arredondamento na primeira (`samePurchase`), então cada compra é seguida fatura a fatura,
  e não pelo texto. Um plano que o banco pôs inteiro numa fatura só, compras à vista e estornos
  ficam de fora.
- **O mês** é o das próximas faturas a pagar (`invoiceMonth`). O painel em Faturas segue o mês
  escolhido nas colunas, enquanto ele tiver parcelas.
- **Peso.** A renda é a mesma do Mês: as Entradas da planilha sem reembolsos (`ownIncome`); um mês
  sem Entrada mostra só o valor, sem %. O teto é o de Ajustes (006), que já conta as parcelas; a
  tela só mostra quanto dele elas ocupam. Sem linha de "30% da renda": com as parcelas em 23% o
  dono leria "tudo bem" num mês que fecha no vermelho, e a régua dele é o teto.
- **Comparação.** Com as faturas do mês anterior listadas pelo banco, a tela diz a diferença para
  ele; sem elas, não diz nada. As compras novas e as que acabaram já aparecem na lista.
- **Conferência no topo.** A linha "as faturas da planilha já têm essas parcelas" fica junto do
  valor; quando falta algo, ela diz quanto falta e em que fatura, com "Corrigir em Para lançar".
- **Mês a mês:** as colunas abrem sem quadro embaixo, porque o topo já diz o mês das próximas
  faturas; um toque numa coluna mostra o peso daquele mês e o que acaba nele. Com todos os meses
  iguais (uma compra só), o painel some: as colunas não diriam nada além do topo.
- **Quando acabam:** as compras agrupadas pelo mês da última parcela, com quanto o grupo libera por
  mês depois dele quando tem mais de uma (com uma só, o valor dela já diz), e no fim as que
  acabaram no mês anterior. Cada linha tem uma bolinha por parcela, cheia até a deste mês, e o
  "n de N"; o nome do cartão só aparece quando há mais de um, e o "falta" some na última parcela.
  Os meses com ano seguem o formato das faturas ("jun/27").
- **De quem é.** A marca de Faturas › De quem é (006) vale para o plano inteiro: tocar numa compra
  abre o cronograma e o mesmo formulário. Uma compra de outra pessoa sai da renda e do teto e vai
  para o filtro dela; uma dividida aparece dos dois lados, cada um com a sua parte; as compras do
  cartão de outra pessoa (o adicional) são todas dela e não têm o que marcar.
- **Cartões sem detalhe do banco** (uma fatura que só chega pelo e-mail de fatura fechada, por
  exemplo) não mostram parcelas; a tela diz quais ficaram de fora.

## Fatias

1. Motor e visão (`installmentPlans`, `parcels` e `parcelsUntil` no contrato da API), com testes.
2. Site: painel em Faturas, tela `?parcelas=true` (com `cartao=` quando aberta da fatura de um
   cartão), filtro por pessoa, detalhe com "De quem é?" e o resumo no filtro Parcelas do cartão.
3. Android: as mesmas telas (`ui/Parcels.kt`), com os prints do Roborazzi.

## Fora do escopo

- Compras futuras ou "e se" no gráfico: isso é o Simular (007).
- Antecipar parcelas: o app de cada banco já faz, e o Neko não move dinheiro.
- Filtro por cartão ou loja: com uns 10 parcelamentos a lista por mês basta, e cada linha diz o
  cartão quando há mais de um.
- Carnês e financiamentos, que ficam na planilha como contas fixas, fora dos cartões.
- Para depois: a Mia responder sobre parcelas e o resumo de domingo avisar quando uma acaba.
