# Ficha da Play Store

Imagens prontas para a ficha do app (Play Console › Presença na loja › Ficha principal).
Todas usam dados inventados das capturas do Roborazzi; nenhuma tem números reais.

| Arquivo | Uso | Tamanho |
|---|---|---|
| `icon-512.png` | Ícone do app | 512×512 |
| `feature-graphic.png` | Gráfico de recursos | 1024×500 |
| `phone-1-hoje.png` … `phone-5-sequencia.png` | Capturas de tela do telefone | 1080×1920 |

## Textos

- **Nome:** Neko
- **Descrição curta:** Quanto cabe hoje no cartão, lido da sua planilha.
- **Descrição completa:** O Neko lê a sua planilha de finanças do Google e mostra, todo dia,
  quanto ainda cabe no cartão, as faturas antes de chegarem e como o mês está andando. Ele só
  lê: a planilha continua sendo a fonte da verdade, e você segue lançando nela.

## Marca

O ícone é uma linha de saldo do mês que vira gato: começa embaixo, sobe em duas orelhas (os
picos do mês), segura um platô e termina mais alta (o mês fecha com sobra). As pupilas em fenda
fazem dele um gato, não um "M". A linha passa das bordas, o mês anterior e o próximo, então
qualquer máscara do launcher só a encurta. O desenho mora em
`app/src/main/res/drawable/ic_launcher_foreground.xml` (e `ic_launcher_monochrome.xml` para o
ícone temático) e em `apps/neko/src/web/BrandMark.tsx`; os PNGs do site e desta ficha saem dele.
