# Fase 3: Open Finance (só leitura)

## Objetivo

Ligar as contas e os cartões do dono ao Neko pelo Open Finance para três coisas que a planilha sozinha
não dá:

1. **Conferir:** mostrar onde a planilha e o banco não batem, como saldo do dia, fatura fechada ou
   uma saída que está no banco e não está na planilha.
2. **Copiar:** listar o que entrou ou saiu da conta e ainda não está na planilha, pronto para colar
   na nota do dia. As compras no cartão não entram aqui, porque a planilha registra o cartão pela
   fatura, não compra por compra: elas aparecem somadas na conferência das faturas (item 3).
3. **Parcelas:** saber, sem precisar mandar faturas, quanto de cada fatura futura já está comprometido
   com parcelas e avisar quando isso difere do que a planilha prevê.

Critério de aceite: com as contas ligadas, a tela Faturas mostra para cada cartão as parcelas futuras
vindas do banco, e o Hoje avisa quando há compras no cartão que a planilha ainda não tem. Os números
de saldo, fatura e projeção continuam vindo só da planilha.

## Regras que não mudam

- A planilha continua sendo a fonte da verdade e é preenchida à mão. O Neko nunca escreve nela, nem
  com dados do banco.
- O banco não altera saldo, fatura ou projeção. Ele aparece só como **divergência** ou **sugestão**,
  e o dono decide o que copiar. Não há previsão feita pelo Neko.
- Regras de finanças (casar lançamentos, somar parcelas por fatura) ficam em `packages/engine`, puras
  e com testes. O Worker só busca, valida e guarda. A web e o Android só mostram.
- Repositório público: nenhum dado bancário real em código, testes ou capturas. Fixtures inventadas.

## Decisões

- **Fonte: Meu Pluggy.** É o único caminho gratuito para uso pessoal encontrado em 2026: o dono
  conecta os bancos pelo Open Finance regulado no Meu Pluggy e a aplicação dele no Dashboard da
  Pluggy lê esses dados pelo conector "MeuPluggy". O limite é de 5 conexões, sem uso comercial. Belvo
  não atende pessoa física e os planos pagos começam em R$ 1.500 (Belvo) e R$ 2.500 (Pluggy) por mês.
  Fontes: docs.pluggy.ai (guia "Meu Pluggy personal use"), pluggy.ai/precos, github.com/pluggyai/meu-pluggy.
- **Credenciais:** `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` como secrets do Worker. A chave de API
  da Pluggy dura 2 horas e o Worker a pede de novo quando expira. Os `itemId` de cada banco ficam no
  D1 (Ajustes › Bancos), porque o Meu Pluggy não lista itens pela API.
- **Sincronização:** dupla, como recomenda a Pluggy. O webhook `item/updated` e `transactions/*`
  chega em `POST /api/pluggy/webhook`, que responde 2XX na hora e processa depois (`waitUntil`).
  Um cron diário às 06:00 de São Paulo refaz a leitura dos últimos 40 dias, porque a Pluggy só tenta
  o webhook 3 vezes. O payload do webhook nunca é confiado: ele só diz "olhe o item X", e o Worker
  busca os dados na API da Pluggy. O Meu Pluggy atualiza uma vez por dia e não permite forçar.
- **Armazenamento (D1, migração nova):**
  - `bank_item`: item, banco e último sync.
  - `bank_account`: conta ou cartão, tipo, últimos dígitos e o cartão adicional pelo próprio número.
  - `bank_txn`: id do provedor, conta, data da compra, valor em centavos, descrição, parcela n de N,
    fatura e data prevista da fatura, e situação pendente ou lançada.
  - `bank_bill`: faturas fechadas.

  O upsert é idempotente pelo id do provedor. A Pluggy pode apagar uma transação e recriá-la com
  outro id, então o sync remove o que o banco já não devolve na janela lida. Do payload só se guarda
  o que alguma tela usa.
- **Casamento banco × planilha (engine, `bank.ts`):** um movimento da conta casa com uma linha da
  planilha quando o valor e a direção são iguais e a data fica a até 7 dias, como no Actual Budget.
  Cada linha da planilha responde por um movimento só, o mais próximo primeiro. O que sobra vira
  "não está na planilha" (`unmatchedMovements`).
- **Faturas (engine, `billChecks`):** para cada fatura futura de um cartão que a planilha conhece,
  soma o que o banco já pôs nela (compras e parcelas, com estornos descontados e sem o pagamento da
  fatura anterior) e compara com a linha da planilha no vencimento. Cada cartão do banco é ligado ao
  nome dele na planilha em Ajustes, inclusive o adicional, que vem no mesmo cartão com outro número.
  Fatura já fechada usa o total que o banco informa, porque o Open Finance às vezes não lista
  algumas linhas uma a uma; ela é comparada com a soma das linhas da planilha de todos os cartões
  daquela conta (titular e adicional juntos), e aparece com o nome em comum deles ("Bradesco").
- **Parcelas futuras (engine):** a soma por cartão e por fatura usa `installmentNumber`,
  `totalInstallments` e `billForecastDate`. O Open Finance não liga as parcelas de uma mesma compra,
  então a compra é reconhecida por descrição, valor da parcela e total de parcelas. O
  `billForecastDate` traz o mês em que a fatura fecha, não o do vencimento (cartão que fecha dia 29
  e vence dia 12 diz setembro para a fatura de outubro); o Neko usa o vencimento da fatura fechada e,
  na aberta, converte pelo dia de fechamento e de vencimento do cartão. Nada disso
  entra no saldo. A tela mostra "já comprometido" ao lado do que a planilha prevê e avisa a diferença.
- **Telas (web e Android 1:1, mesma API):**
  - Faturas: por cartão, "Parcelas já compradas" por mês vindas do banco, e a diferença para a
    planilha quando houver.
  - Hoje: um aviso "N compras no cartão não estão na planilha", que abre a lista em texto pronto
    para copiar.
  - Ajustes › Bancos: os bancos ligados, o último sync e o campo de `itemId`.
- **Mia (depois):** quando existir, só lê as mesmas visões. Não faz conta sozinha.

## Fora do escopo

- Escrever na planilha ou preencher linhas automaticamente.
- Categorizar gastos ou fazer orçamento por categoria.
- Iniciar pagamentos (Pix por Open Finance).
- Ler notificações do celular.

## Fatias

1. Ingestão: secrets, migração, cliente da Pluggy, webhook e cron, Ajustes › Bancos. Testes do
   cliente com respostas inventadas.
2. Engine: `unmatchedMovements` e `billChecks` (`bank.ts`), com TDD.
3. Telas: Faturas e Hoje na web e no Android, capturas regravadas e `PIPELINE_VERSION` incrementada.

## Passos do dono (uma vez)

1. Criar conta em meu.pluggy.ai e conectar cada banco, autorizando no app do banco.
2. Criar conta em dashboard.pluggy.ai **com o mesmo e-mail**. O teste de 15 dias começa aqui.
3. Em Customization › Connectors, habilitar o conector **MeuPluggy**, do grupo Personal.
4. Criar uma aplicação e guardar o Client ID e o Client Secret.
5. Em Applications › aplicação › Demo › Connect Account, escolher **MeuPluggy**, não o banco, e
   autorizar. Repetir uma vez para cada banco e copiar cada `itemId` em Connected Items.
