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
  "não está na planilha" (`unmatchedMovements`). Antes disso saem as transferências entre contas
  do próprio dono (mesmo valor saindo de uma e entrando noutra em até 2 dias) e os pagamentos de
  fatura de cartão, que as faturas já conferem. Um Pix pode pagar duas linhas do mesmo dia da
  planilha somadas. A tela mostra só os últimos 40 dias.
- **Faturas (engine, `billChecks`):** para cada fatura futura de um cartão que a planilha conhece,
  soma o que o banco já pôs nela (compras e parcelas, com estornos descontados e sem o pagamento da
  fatura anterior) e compara com a linha da planilha no vencimento. Fatura já vencida fica com as
  linhas do cartão mais perto do vencimento dela do que do anterior ou do seguinte (paga com
  atraso, adiantada ou antes de o cartão mudar o dia de vencimento; no empate, a fatura mais
  antiga); fatura por vencer só no dia, porque é lá que uma linha nova é escrita. Cada cartão do
  banco é ligado ao nome dele na planilha em Ajustes, inclusive o adicional, que vem no mesmo
  cartão com outro número.
- **Parcelas futuras (engine):** a soma por cartão e por fatura usa `installmentNumber`,
  `totalInstallments` e `billForecastDate`. O Open Finance não liga as parcelas de uma mesma compra,
  então a compra é reconhecida por descrição, valor da parcela e total de parcelas. O
  `billForecastDate` muda de sentido de banco para banco (mês de fechamento num, mês da compra
  noutro), então não é usado: a compra cai na fatura fechada que o banco indica (`billId`) ou, sem
  ela, no ciclo do cartão pela data. Fatura já fechada vale pelo total do banco quando a conta é um
  cartão só na planilha (titular e adicional seguem pela soma das linhas). Parcela futura que o banco
  já lista com texto encurtado ou centavo de arredondamento diferente conta uma vez só. Nada disso
  entra no saldo. A tela mostra "já comprometido" ao lado do que a planilha prevê e avisa a diferença.
- **Fatura fechada de titular e adicionais (engine, `billChecks`, 2026-11):** o total do banco vale.
  Se a divisão da planilha soma o total, ela fica; se as linhas do banco somam, elas valem; senão
  cada cartão fica com as linhas dele e o cartão do titular (o que está ligado à conta inteira em
  Ajustes › Bancos) fica com a diferença, como o ajuste de conciliação do YNAB. Sem titular conhecido,
  a fatura não diz nada. Nem quando o feed começou no meio do ciclo (nenhuma compra dos cartões
  datada até o fechamento anterior): as poucas linhas não dizem a divisão, e o titular ficaria com
  quase a fatura inteira.
- **Ignorar numa fatura aberta (engine, `ignoredGaps`, 2026-11):** a chave do item guarda, por
  fatura, o valor da planilha e o proposto (`card:<cartão>:<vencimento>=<planilha>><proposto>`).
  Ignorar diz que essa diferença não é real (um crédito que o feed não mandou, uma compra que o banco
  vai cancelar): enquanto a fatura está aberta, ela sai do total do banco e só o que o banco somar
  depois volta a Para lançar. Fechada, vale o total do banco. O item ignorado fica em "Ignorados"
  enquanto a fatura não vence, para voltar com um toque.
- **Fatura do banco em PDF (2026-11, opcional):** o Open Finance do Bradesco deixa linhas de fora
  (créditos provisórios de contestação, a segunda de duas compras iguais no mesmo dia, corridas do
  dia do fechamento). A fatura que o banco gera tem todas. O Claude (Opus 5.5, saída estruturada)
  copia cada linha; o Neko só guarda a leitura quando, em cada cartão, saldo anterior + linhas −
  pagamentos dá o valor impresso, e os cartões somam o total (`checkStatement`); senão lê de novo
  com mais esforço, dizendo quais somas não fecharam, e, falhando, não guarda nada. A conta é a que tem os números dos cartões. O
  extrato em aberto não imprime vencimento: vale o da fatura que o cartão titular da conta tem
  aberta no dia em que o PDF chega (o dono manda logo que baixa). As linhas
  ficam no D1 (`statement`, `statement_line`, migração 0011); uma leitura nova da mesma fatura
  substitui a anterior. `withStatements` junta cada linha do PDF com a do feed do mesmo cartão e
  valor (a parcela, com o centavo de arredondamento), e só acrescenta o que o feed não tem, marcado
  `fromStatement`; quando o feed manda a linha, a cópia do PDF sai. Entra pelo botão em Faturas
  (web e Android) ou por e-mail: o endereço `fatura@` do domínio do Neko (Cloudflare Email Routing)
  entrega ao Worker, que aceita só o dono (encaminhamento do Gmail, inclusive o do filtro, que chega
  com o remetente marcado `+caf_`) e os domínios do banco, no envelope e no cabeçalho From: o
  Cloudflare recusa o e-mail que falha no DMARC do domínio do From (os bancos publicam p=reject),
  e o envelope sozinho não é protegido. A fatura que o banco manda por e-mail vem
  trancada com senha feita dos dados do dono: o Worker a abre com as senhas do secret
  `STATEMENT_PDF_PASSWORDS` (nunca no repositório) e copia as páginas para um PDF aberto antes da
  leitura; sem senha que sirva, não lê. Gasta do mesmo teto mensal da Mia. Nunca escreve na planilha.
- **Cartão fora do Open Finance, pelo e-mail de fechamento (2026-11):** o Meu Pluggy liga só cinco
  bancos, e o Nubank ficou de fora. O e-mail "Sua fatura fechou" dele traz no texto o cartão, o dia
  do vencimento e o total ("A fatura do seu cartão de crédito Nubank com vencimento no dia 2 de
  dezembro fechou no valor de R$ 1.234,56"). Chegando ao `fatura@` (o domínio do banco também é
  aceito), o Worker lê essa frase, sem Claude e sem abrir o PDF, e guarda só o total por cartão e
  vencimento no D1 (`mailed_bill`, migração 0012; um e-mail novo da mesma fatura substitui). O total
  entra como fatura fechada daquele cartão sozinho, casado com o cartão da planilha pelo nome: a
  fatura aparece em Faturas e, se a planilha difere e ainda não venceu, vai para Para lançar.
- **Contas de luz e celular pelo e-mail da empresa (2026-11):** a conta chega por e-mail semanas
  antes do vencimento, com o valor e o dia no texto ("Data de vencimento: 01/12/2026", "Valor a
  pagar: R$ 62,50"). Os domínios dessas empresas ficam no secret `BILL_SENDERS` (onde o dono paga
  luz diz onde ele mora, então nunca no repositório); o filtro do Gmail encaminha ao `fatura@`, e
  o encaminhamento à mão também vale (o Worker acha a empresa no cabeçalho citado). O Worker lê o
  texto, sem Claude e sem abrir o PDF, e guarda valor e vencimento por empresa (`mailed_conta`,
  migração 0013; um aviso de atraso, sem vencimento, não é conta). Em Para lançar, a linha que a
  planilha planeja para ela (Saída fora de cartão, a até 7 dias do vencimento, com o nome da
  empresa ou o nome que a planilha deu aos pagamentos feitos a ela) recebe o valor da conta; sem
  linha planejada, entra uma Conta nova no vencimento. Depois que o banco mostra o pagamento (a
  partir do dia em que o e-mail chegou) ou o vencimento passa, quem diz o que aconteceu é o banco.
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
