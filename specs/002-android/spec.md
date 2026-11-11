# Fase 2: app Android

## Objetivo

Levar o Neko para um app nativo no celular do dono, com o que o site não faz bem: um widget na
tela inicial com "hoje cabem", lembretes que chegam mesmo com o navegador fechado e instalação
pela Play Store (teste interno).

Critério de aceite: o app entra com a mesma passkey do site, mostra os mesmos números do site
para o mesmo dia e o widget se atualiza sozinho ao longo do dia.

## Decisões

- Kotlin, Jetpack Compose e Glance (widget), como cliente fino do mesmo Worker. Nenhuma regra de
  finanças no app: tudo o que ele mostra vem pronto da API. Quando uma tela precisa de um valor
  derivado (agrupar, somar, filtrar), a API passa a entregá-lo, com teste do lado TypeScript.
- Login com passkey pelo Credential Manager. A passkey é a mesma do site (mesmo `rpID`, sincronizada
  pelo Gerenciador de Senhas do Google). O Worker publica `/.well-known/assetlinks.json` com o
  certificado do app e aceita a origem `android:apk-key-hash:…` desse certificado.
- Sessão: o mesmo cookie `__Host-` do site, guardado no armazenamento privado do app e fora do
  backup do Android, cifrado com AES-GCM por uma chave do Android Keystore (o cache do Hoje também).
- Bloqueio opcional (Ajustes › Neste celular): digital forte ou a senha do celular ao abrir o app e
  ao voltar depois de 5 minutos fora. Ligado, a prévia em Recentes some. Os lembretes mostram só o
  título na tela bloqueada.
- Integração com o Android: tela de abertura do sistema até a sessão ser conhecida; atalhos no ícone
  (Simular, Faturas, Mês e "Lançar", que abre a linha de hoje e muda todo dia); prévia gerada do
  widget no seletor (Android 15+, com números inventados); toques hápticos do sistema no dock, nos
  interruptores e ao puxar para atualizar.
- Movimento igual ao do site (`styles.css`, "Motion"): o arco e as colunas desenham uma vez, o número
  grande roda como odômetro, avisos aparecem, "Como calculei" e o extrato abrem pela altura, a troca
  de aba desliza para o lado da aba, e o carregamento é um esqueleto com brilho. "Remover animações"
  do Android zera tudo.
- Acessibilidade (WCAG 2.2 AA): títulos marcados como cabeçalho, figuras e linhas lidas como uma
  frase só pelo TalkBack, interruptores na linha inteira, "Salvo" anunciado, escolhas do simulador
  como grupo de opções; com texto grande o número vai para baixo do arco; prints a 200% de texto;
  `ContrastTest` cobra 4,5:1 de todas as cores de texto nos dois temas.
- Desempenho: toda tela guarda a última leitura (cifrada) e abre com ela na hora, inclusive sem
  rede; Faturas e Mês são lidos em segundo plano depois do primeiro Hoje; nada de disco, Keystore ou
  rede na thread principal ao abrir (StrictMode nas builds de debug); o código do app é compilado
  na instalação por um baseline profile.
- Widget responsivo em três formas, como a tela inicial o dimensiona: só o número; o número com a
  fatura aberta e o plano ao lado; e, mais alto, os próximos dias com algo na planilha. A prévia do
  seletor usa números inventados.
- `GET /api/today`: o que o Hoje e o widget mostram, já calculado (pode gastar hoje, próximos dias
  agrupados com o saldo de cada dia, pontos de conferência abertos, avisos, link da linha de hoje).
- `GET /api/invoices`, `GET /api/months` e `GET /api/ajustes` (`apps/neko/src/shared/screens.ts`):
  Faturas, Mês e Ajustes prontos para desenhar, com as mesmas regras das telas do site. Ajustes
  salva pelo mesmo `PUT /api/settings` do site, inteiro, sem perder os pontos já conferidos.
- Chave de assinatura (upload key) fora do Git: um repositório público com a chave permitiria
  assinar outro app que o `assetlinks.json` aceitaria, e esse app poderia pedir a passkey do dono.
  O CI só compila e testa; o APK assinado é gerado com a chave guardada nos arquivos do projeto.
- `minSdk` 28 (Credential Manager com passkeys), `compileSdk`/`targetSdk` na versão estável mais nova.
- Build do Android em workflow próprio, só quando `apps/android/` ou a API mudam.

## Fatias

1. Fundação: `assetlinks`, origem Android nas passkeys, `/api/today`, projeto Android com login,
   Hoje e widget, workflow de CI.
2. Faturas, Mês e Ajustes no app.
3. Lembretes locais (manhã e noite) com WorkManager.
4. Assinatura de release e envio ao teste interno da Play (depende da verificação da conta do dono).

## Fora da fase 2

Mia, leitura de notificações do banco, qualquer escrita na planilha.
- Aprender sem manual: uma dica curta por tela (Hoje, Faturas, Mês) na primeira vez que ela tem
  dados, no máximo uma por visita, que some de vez com "Entendi". Ajustes › Como funciona guarda as
  ideias do método nas palavras do Neko, uma por toque, e "Rever dicas" traz as dicas de volta. Site
  e app dizem o mesmo (web/learn.ts e ui/Learn.kt).
- Tela larga (a partir de 840dp: tablet, celular dobrável aberto): a barra de abas vira um trilho
  à esquerda. Colunas do Mês: a faixa inteira de cada mês é o alvo, sem vãos, e dá para deslizar o
  dedo de um mês ao outro. Gráficos desenham uma vez por lugar, e o puxar para atualizar termina com
  uma vibração de confirmação ou de erro.

## Notificações (revisão de 11/11/2026)

Pesquisa e veredito com o dono em 11/11: no máximo duas por dia, quase sempre uma, cada uma com uma
ação clara, só com números da planilha e do banco (nada de previsão, nada de bronca). Código em
`worker/push.ts` (textos) e `worker/notices.ts` (entrega).

- **Manhã (08:00), só quando há o que fazer**, o mais urgente no título: todas as contas da planilha
  que vencem hoje, cartões ou não, com o que falta na conta quando o saldo do dia fica negativo;
  saldo negativo agora ou em até 2 dias; dia de guardar; aos domingos, a semana que fechou (Cartões
  e Pix contra a anterior, `lastWeekSpend`, e dias lançados). Sem nada disso, silêncio: "Ainda
  cabem" fica no widget e no Hoje.
- **Teto na hora da compra**: depois de cada leitura dos bancos (06:00, a da noite, o webhook da
  Pluggy, Atualizar), se Cartões e Pix passaram de 75% ou de 100% do teto, sai um aviso (uma vez no
  mês cada marca, guardado em `setting.ceiling_said`; tabela `notice`, `teto-75`/`teto-100`). O
  navegador recebe por push na hora; o celular, na próxima busca, no canal Contas e teto.
- **Avisos de compra** (só no app, Ajustes › Neste celular): com a permissão de ler notificações do
  Android, o app olha só os avisos dos apps do Bradesco, Itaú, Inter e Mercado Pago (bancos ligados
  por Open Finance; um cartão fora dele contaria duas vezes ao lado da fatura por e-mail). De uma
  compra aprovada à vista e em reais que não fale de débito nem de Pix (`PurchaseText`), manda o valor, a loja e o final
  do cartão a `POST /api/purchases` (tabela `phone_purchase`, 15 dias). O mesmo aviso dos dois apps
  do banco conta uma vez (`onePerPurchase`).
  - **Por enquanto, só aprende** (modo sombra, por banco): o Open Finance confere cada leitura
    (mesmo cartão e valor, até 3 dias de diferença; sem a cobrança com o banco lido 5 dias depois, a
    leitura não bateu), e Ajustes mostra, por banco, "N de M bateram com o banco". O teto não muda
    com os avisos. Um app só passa a mover o teto quando for liberado à mão, numa mudança revisada
    (`PHONE_RELEASED` em `worker/phone.ts`), depois de conferir os textos reais e as conferências
    do banco; liberado, conta enquanto o banco confirmou as 3 últimas leituras seguidas
    (`phoneReads`), e a cópia do celular sai quando o banco traz a mesma cobrança.
  - **Texto real dos avisos**: dos avisos desses apps com valor em reais que falam de compra ou de
    cartão, e nunca de Pix (`PurchaseText.keep`), o app manda também o texto, lido ou não, a
    `POST /api/purchases/notice` (tabela `bank_notice`, 15 dias), para a leitura ser conferida com o
    jeito real de cada banco escrever.
  - Nunca vira linha da planilha nem item de Para lançar: o lançamento vem só do banco. Antes de
    abrir a permissão, o app diz em claro o que lê, o que manda e quanto tempo guarda.
- **Fatura debitada de uma conta só**: o banco tira a fatura do cartão da conta dele, não do Saldo
  inteiro. A conta que pagou uma fatura nos últimos 100 dias (débito "gastos cartão" ou "pagamento de
  fatura") paga os cartões do mesmo banco (`billPayers`). De 2 dias antes do vencimento até o dia, se
  a fatura inteira (titular e adicional) passa do saldo lido hoje ou ontem, a manhã diz quanto
  transferir para essa conta (`transfersDue`). Uma fatura paga por Pix de outro banco fica com o Saldo.
- **Noite, na hora escolhida em Ajustes** (19h a 23h, padrão 21h, uma para a conta): "N para lançar"
  com os nomes dos itens, e o toque abre direto em Para lançar (`/#para-lancar` no site, a ação
  `PARA_LANCAR` no app). Fila vazia: "Lançou o dia?" até a planilha mudar no dia. Os bancos são
  lidos meia hora antes, para a fila estar fresca.
- **Avisos do servidor** (Meu Pluggy vencido, planilha ilegível): tabela `notice`, um por tipo por
  dia. O navegador recebe por push; o app, que não usa FCM, busca em `GET /api/reminders` (08:00 e
  noite) e `GET /api/notices` (a cada 3 horas, junto do widget). Resolvido o problema, o aviso sai
  da tabela e o app tira a notificação.
- **Android**: um canal por tipo (Contas e teto, Lançar o dia, Avisos), categoria de lembrete ou de
  erro, a da manhã some na hora da noite e a da noite na manhã seguinte, tela bloqueada só com o
  tipo.
- **Uso do Neko** conta os toques em cada canal (Contas e teto, Lançar o dia, Avisos:
  `notificacao_manha`, `_noite`, `_aviso`), só a contagem.
