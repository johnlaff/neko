# Fase 7: Simular

## Objetivo

O "e se" do próprio método: na aula de análises e cenários, o aluno digita na planilha uma compra,
um freela ou um empréstimo, vê os saldos mudarem e desfaz com Ctrl+Z. No Neko isso acontece numa
tela à parte, sem tocar na planilha, e responde também como os próximos meses ficam com o gasto do
dia a dia que a planilha ainda não tem.

Critério de aceite: Simular, aberto pelo botão no Hoje (e pelo atalho no ícone do Android), mostra
os saldos dos meses à frente sob um ritmo e com até 8 "e se", na web e no Android com os mesmos
números, e nada do que se faz ali fica salvo.

## Regras que não mudam

- Nada é salvo e a planilha nunca é tocada: os saldos dela ficam como estão, e o cenário só mexe em
  cópias. Sair da tela esquece tudo.
- Sem previsão própria além do ritmo escolhido pelo dono: nenhum gasto mínimo é inventado. Num mês
  em que as faturas já levam o ritmo inteiro, o cenário supõe que nada mais é gasto, a resposta diz
  que é o melhor caso e não oferece "dá para guardar".
- Regras no motor (`packages/engine/src/scenario.ts`, `simulate`) e uma só visão para site, Android
  e Mia (`scenarioView` em `apps/neko/src/shared/screens.ts`).

## Decisões

- **Ritmos** (`Pace`), como os meses à frente levam o dia a dia que a planilha ainda não tem:
  - `planilha`: só o que já está na planilha.
  - `teto`: o teto do mês de Ajustes (cartões e Pix, 006). É o padrão quando há teto, porque é o
    plano do próprio dono.
  - `media`: a média dos últimos 3 meses completos.

  Parcelas que caem dentro do ritmo saem do dia a dia, não somam a ele, como o método ensina.
- **"E se"** (`Change`), até 8 (`MAX_CHANGES`):
  - `compra`: hoje, no cartão principal, em N parcelas a partir da próxima fatura;
  - `entrada` e `saida`: um valor num dia, repetido no mesmo dia por até 24 meses (`MAX_REPEAT`).
- **Rotas** (com sessão, só leitura): `POST /api/scenario` responde um ritmo; `POST /api/scenarios`
  responde todos de uma vez, e o Android usa esta para a troca de ritmo nunca esperar a rede. O corpo
  pode vir vazio (`{}`): sem ritmo vale o padrão, sem "e se" fica a planilha sob o ritmo.
- **Tela:** a frase de cima diz só a mudança, o gráfico e os números trocam de ritmo com movimento
  (`useMorph.ts` no site), remover uma linha pode ser desfeito, e "Como calculei" explica em frases
  curtas. Atalhos C, E e S no site.
- **Posso comprar?** (004) lê o mesmo cenário com e sem a compra.

## Fora do escopo

- Guardar cenários, comparar vários lado a lado ou mandar um cenário para a planilha.
- Prever renda, reajuste ou gastos que o dono não escolheu.
