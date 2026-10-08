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
