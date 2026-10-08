# Fase 1: motor, leitura da planilha e web no celular

## Objetivo

Ler a planilha (só leitura) e mostrar, no celular, o que ela não mostra sozinha: quanto dá para
gastar hoje no cartão, a fatura prevista de cada cartão, a saúde da planilha e o fim do mês com o
diário previsto caindo nas faturas.

Critério de aceite: o saldo recalculado bate com a coluna Saldo da planilha real (divergências
viram itens de saúde), e o "pode gastar hoje" faz sentido para o ciclo atual dos cartões.

## Regras do método implementadas

- Saldo = saldo do dia anterior + entrada − (saída + diário). Divergência é reportada uma vez e o
  cálculo se reancora no valor da planilha.
- Fatura de cartão = linha da nota de Saída sob `CARTÕES`/`FATURAS` na data de vencimento.
  Fechamento no mesmo mês se o dia de fechamento < dia de vencimento; senão, no mês anterior.
  Compra no dia do fechamento entra nessa fatura. Fechamento desconhecido = vencimento − 7 dias
  (marcado como estimado, ajustável).
- Modo crédito: cada dia futuro com diário vazio gasta o diário previsto no cartão principal, e o
  dinheiro sai no vencimento daquela fatura.
- Diário previsto: ajuste do usuário; senão o maior entre a nota "previsão do diário" da planilha
  e a média real (cartões + diário) dos últimos 3 meses completos, arredondada para cima. O método
  manda usar a média real e não baixar a previsão para a planilha ficar verde.
- Pode gastar hoje = (orçamento do ciclo − o que a fatura aberta já tem na planilha) ÷ dias até o
  fechamento, com hoje. Orçamento padrão = diário previsto × dias do ciclo.
- Reembolso: linha de cartão com `#reembolso` ou com Entrada de mesmo valor em até 15 dias não
  conta como gasto seu; cartões marcados como "de outra pessoa" também ficam fora do ritmo.
- Saúde: data vazia, nota que não soma com a célula, saldo que não bate, linha de nota ilegível e
  fatura vencida sem linha na nota de Saída (só a última de cada cartão com fatura nos dois meses
  anteriores; vale até 3 dias de folga em torno do vencimento, e R$ 0,00 conta como lançada).
- Guardado do mês = soma das linhas da nota de Saída sob um cabeçalho que começa com `Invest`
  (`Investimento:`, `INVESTIMENTOS`). Taxa de economia = guardado ÷ entradas, em % inteiro (sem
  entradas, não há taxa). Custo de vida = saídas + diário − guardado. Nada é previsto: meses
  futuros só mostram o que já está na planilha.
- "Dia passado sem diário" não vira item de saúde: no modo crédito o diário fica vazio de
  propósito, porque o gasto vai para a fatura. O alerta marcaria todos os dias.

## Decisões

- Um Worker serve API e web (Workers Static Assets). D1 guarda cache de projeções, histórico do
  fim do mês e ajustes. SQL direto em vez de Drizzle: duas tabelas não pagam o ORM.
- Login com Google Identity Services + lista de e-mails; sessão em cookie assinado HttpOnly.
- Plano gratuito do Workers por enquanto (leitura completa ~1,5 s de parede, CPU baixa).
- Fora da Fase 1: Android, lembrete, sequência, Mia, simulação de compra.
