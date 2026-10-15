# RM — app de gestão

App da RM Confeitaria do dia a dia (pedidos, Pix, tarefas, custos, DRE, estoque e Clube da Raquel), instalável na tela de início do celular.

## Como funciona

| Camada | Onde fica | O que faz |
|---|---|---|
| App | Este repositório, publicado no GitHub Pages | Telas. Abre na hora com os últimos dados guardados no aparelho |
| Servidor | Apps Script ligado à planilha (Api.gs + Code.gs, Gestao.gs, Ajuda.gs, Painel.gs) | Login, regras de negócio, recálculo, e-mails e gatilhos |
| Dados | Planilha "RM — Controle Operacional" | Uma aba por assunto. Nada de cliente fica neste repositório |

- Login: pessoa (Raquel ou Bruno) + PIN da aba Config. 5 erros bloqueiam 15 minutos. A sessão vale 60 dias (Config › dias_sessao).
- Na planilha (aba Sessoes) fica só o hash do token. Celular perdido ou PIN trocado: rodar `encerrarTodasSessoes` no editor do Apps Script.
- O app chama a API com POST e JSON em `text/plain`. A lista de funções permitidas fica em `Api.gs`.

## Arquivos

| Arquivo | Para quê |
|---|---|
| `index.html` | Gerado por `build.py` a partir do `Index.html` do Apps Script (fonte única das telas). Não editar à mão |
| `build.py` | Converte o Index.html: chamadas por fetch, login com token, cache local, manifest e service worker |
| `extras/` | Partes só do app novo, incluídas pelo `build.py`: fila de pedidos (`fila.js`) e controle de produção (`producao.js`) |
| `config.js` | Endereço /exec da API |
| `sw.js` | Guarda o app no aparelho. Trocar `VERSAO` a cada publicação |
| `manifest.webmanifest`, `icones/` | Nome, cores e ícone (selo RM) do app instalado |

## Publicar uma mudança de tela

1. Alterar o `Index.html` do Apps Script.
2. `python3 build.py caminho/do/Index.html`
3. Trocar `VERSAO` em `sw.js` e enviar ao GitHub. O Pages publica em cerca de 1 minuto e o app se atualiza sozinho.

## Servidor (Apps Script)

A pasta `servidor/` guarda os arquivos do Apps Script que o app novo usa e que não existiam no app antigo:

| Arquivo | Para quê |
|---|---|
| `servidor/Api.gs` | Porta de entrada do app (login, sessões, funções permitidas, rotas dos avisos) |
| `servidor/Push.gs` | Avisos no celular pelo Firebase Cloud Messaging e o gatilho de hora em hora `verificarAvisos` |
| `servidor/Producao.gs` | Controle de produção: aba Producao, `getProducao` e `salvarProducao` |

Para copiar pelo celular: abrir o arquivo em `raw.githubusercontent.com/brunomathias8-droid/rm-app/main/servidor/<arquivo>` no Safari, tocar e segurar › Selecionar tudo › Copiar.

## Gestão › Gráficos

Calculado no aparelho a partir dos pedidos (abertos + entregues) e dos indicadores do mês: receita, pedidos e ticket por semana (metas do plano), clientes novos e recorrentes, itens mais vendidos, receita por tipo, canal de origem, dia da retirada e principais clientes. Limite atual: o servidor devolve os 400 pedidos entregues mais recentes.

## Pedido novo em segundo plano

Ao tocar Salvar, o pedido fica guardado no aparelho e a tela "Pedido salvo" abre na hora. O envio continua sozinho e tenta de novo quando falha, com o aviso "Enviando 1 pedido…" no topo. Cada pedido leva um código (`_rid`); o `Api.gs` devolve o resultado do primeiro envio em vez de gravar de novo (por 6 horas). Sem confirmação em 5 horas, ou com erro do servidor, o aviso fica vermelho e a pessoa decide: enviar de novo ou descartar.

## Controle de produção

Tela Hoje › Produção (ou + › Produção). A Raquel lança o que ficou pronto ou congelado ("Produzi") e, quando quiser, conta o estoque ("Contei o estoque": o app grava a diferença). O resto vem dos pedidos:

- em pedidos = itens dos pedidos em aberto
- no estoque = produzido − itens dos pedidos retirados desde o início do controle
- livres = no estoque − em pedidos

Caixas e kits contam pelos sabores escolhidos no pedido (seção "O que vai nas caixas"), gravados na Observação numa linha `Sabores: 3x Cookie de Nutella; 3x Cookie de Kinder Bueno`. Os lançamentos ficam na aba Producao da planilha.
