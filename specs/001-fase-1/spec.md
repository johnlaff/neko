# Fase 1: motor, leitura da planilha e web no celular

## Objetivo

Ler a planilha e mostrar, no celular, o que ela não mostra sozinha: quanto ainda cabe no cartão, a
fatura prevista de cada cartão, a saúde da planilha e o fim do mês com o diário previsto caindo nas
faturas. Nesta fase o Neko só lia; a gravação, sempre com o toque do dono, veio na 005.

Critério de aceite: o saldo recalculado bate com a coluna Saldo da planilha real (divergências
viram itens de saúde), e o "ainda cabem" faz sentido para o ciclo atual dos cartões.

## Regras do método implementadas

- Saldo = saldo do dia anterior + entrada − (saída + diário). Divergência é reportada uma vez e o
  cálculo se reancora no valor da planilha.
- Fatura de cartão = linha da nota de Saída sob `CARTÕES`/`FATURAS` na data de vencimento.
  Fechamento no mesmo mês se o dia de fechamento < dia de vencimento; senão, no mês anterior.
  Compra no dia do fechamento entra nessa fatura. Fechamento desconhecido = vencimento − 7 dias
  (marcado como estimado, ajustável).
- Sem previsão própria: o saldo de cada dia é o da planilha. Um mês à frente sem diário e sem
  fatura do dono vira aviso ("ainda sem gastos previstos"), e o "dá para guardar" não olha além
  dele, porque ali o saldo está alto demais.
- Aviso de saldo negativo também quando o saldo de hoje já está abaixo de zero: diz quando volta
  ao positivo e quanto falta no pior dia. O simulador de parcelas confere cada dia a partir da
  primeira parcela, não só o fim do mês.
- Diário previsto: ajuste do usuário; senão o maior entre a nota "previsão do diário" da planilha
  e a média real (cartões + diário) dos últimos 3 meses completos, arredondada para cima. O método
  manda usar a média real e não baixar a previsão para a planilha ficar verde.
- Ainda cabem (Hoje) = orçamento − o que já foi gasto, nunca dividido pelos dias que faltam: o
  diário do método é média, e gastar mais num dia não baixa os seguintes. Três modos
  (`CanSpend.mode`): `cycle`, a fatura aberta do cartão principal contra o plano do ciclo
  (padrão = diário previsto × dias do ciclo); `month`, com o Diário previsto ligado, o gasto do mês
  contra o Diário (005, Fase 3); `cards`, com o teto do mês em Ajustes, as faturas do dono do mês
  que vem mais o Pix contra o teto (006).
- Reembolso: linha de cartão com `#reembolso` ou com Entrada de mesmo valor em até 15 dias não
  conta como gasto seu; cartões marcados como "de outra pessoa" também ficam fora do ritmo.
- Saúde: data vazia, nota que não soma com a célula, saldo que não bate, linha de nota ilegível e
  fatura vencida sem linha na nota de Saída (só a última de cada cartão com fatura nos dois meses
  anteriores; vale até 3 dias de folga em torno do vencimento, e R$ 0,00 conta como lançada).
- Guardado do mês = soma das linhas da nota de Saída sob um cabeçalho que começa com `Invest`
  (`Investimento:`, `INVESTIMENTOS`). Taxa de economia = guardado ÷ entradas, em % inteiro (sem
  entradas, não há taxa), mostrada no Mês ao lado da meta de 20% a 30% das entradas. Custo de vida
  = saídas + diário − guardado. Diário médio = diário até hoje ÷ dias passados + faturas do dono no
  mês ÷ dias do mês, só no mês atual e nos que passaram. Nada é previsto: meses futuros só mostram
  o que já está na planilha.
- Sequência (`habit.ts`): um dia conta quando a planilha mudou nele, ou quando o dono conferiu Para
  lançar e não havia nada a lançar (005). Uma falta isolada é perdoada quando o dia seguinte é
  lançado; duas seguidas quebram a sequência.
- "Dia passado sem diário" não vira item de saúde: no modo crédito o diário fica vazio de
  propósito, porque o gasto vai para a fatura. O alerta marcaria todos os dias.

## Decisões

- Um Worker serve API e web (Workers Static Assets). D1 guarda cache de projeções, histórico do
  fim do mês e ajustes. SQL direto, sem ORM: as consultas são poucas e simples, e cada tabela tem
  a sua migração comentada em `apps/neko/migrations/`.
- Login: começou com Google Identity Services e lista de e-mails. Hoje é passkey criada por um
  convite de uso único (002), com sessões no D1; o botão do Google só aparece com
  `GOOGLE_CLIENT_ID` configurado.
- Plano Workers Paid desde 2026-10-19: a leitura completa passou do limite de CPU do plano gratuito.
- Fora da Fase 1, e entregues depois: Android e lembretes (002), Mia (004), Simular (007).
