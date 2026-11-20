# Especificações

Cada pasta descreve uma parte do Neko: o objetivo, as regras do método que ela segue e as decisões,
com o porquê. São specs vivos: um PR que muda o comportamento muda o spec no mesmo PR, e uma parte
nova ganha uma pasta com o próximo número. As seções "Fatias" e "Fora do escopo" guardam como a
parte foi entregue; o resto descreve o Neko de hoje.

| Spec | O que cobre | Estado |
|---|---|---|
| `001-fase-1` | Motor, leitura da planilha, saldo, cartões, saúde, "ainda cabem", guardado e sequência | Entregue |
| `002-android` | App Android, widget, login com passkey, notificações e Avisos de compra | Entregue; Avisos de compra só aprendem |
| `003-open-finance` | Bancos pelo Meu Pluggy, conferência com a planilha, faturas em PDF e por e-mail, contas por e-mail | Entregue |
| `004-mia` | Mia 1 e Mia 2, ferramentas do Neko por MCP, conferência dos números, Posso comprar e rotinas | Entregue; a Mia 2 é a que responde |
| `005-lancamentos` | Lançar na planilha, Para lançar, aba Economia, Diário previsto e Lançar com a Mia | Entregue (Fases 0 a 4) |
| `006-sobrar` | Teto do mês, mês no vermelho, assinaturas, compras de outras pessoas e reserva em degraus | Entregue |
| `007-simular` | Os meses à frente sob um ritmo e com "e se", sem salvar nada | Entregue |
| `008-parcelas` | Todas as parcelas: peso na renda e no teto, mês a mês, quando acabam, de quem é | Entregue |

Um spec novo segue o mesmo formato: **Objetivo** (com o critério de aceite), **Regras que não
mudam**, **Decisões** e **Fora do escopo**. Como o código e o resto da arquitetura se encaixam está
em `ARCHITECTURE.md`, na raiz.
