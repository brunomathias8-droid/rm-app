# RM — app de gestão

App da RM Confeitaria Artesanal (pedidos, Pix, tarefas, custos, DRE, estoque e Clube da Raquel), instalável na tela de início do celular.

## Como funciona

| Camada | Onde fica | O que faz |
|---|---|---|
| App | Este repositório, publicado no GitHub Pages | Telas. Abre na hora com os últimos dados guardados no aparelho |
| Servidor | Apps Script ligado à planilha (arquivos em `servidor/`) | Login, regras de negócio, recálculo, e-mails e gatilhos |
| Dados | Planilha "RM — Controle Operacional" | Uma aba por assunto. Nada de cliente fica neste repositório |

- Login: pessoa (Raquel ou Bruno) + PIN da aba Config. 5 erros bloqueiam 15 minutos. A sessão vale 60 dias (Config › dias_sessao).
- Na planilha (aba Sessoes) fica só o hash do token. Celular perdido ou PIN trocado: rodar `encerrarTodasSessoes` no editor do Apps Script.
- O app chama a API com POST e JSON em `text/plain`. A lista de funções permitidas fica em `Api.gs`.

## Arquivos

| Arquivo | Para quê |
|---|---|
| `index.html` | Gerado por `build.py` a partir do `Index.html` do Apps Script (fonte única das telas). Não editar à mão |
| `build.py` | Converte o Index.html: chamadas por fetch, login com token, cache local, manifest e service worker |
| `extras/` | Partes só do app novo, incluídas pelo `build.py`: fila de pedidos (`fila.js`) e Mural (`mural.js`, `mural.css`) |
| `config.js` | Endereço /exec da API |
| `sw.js` | Guarda o app no aparelho. Trocar `VERSAO` a cada publicação |
| `manifest.webmanifest`, `icones/` | Nome, cores e ícone (selo RM) do app instalado |

## Publicar uma mudança de tela

1. Alterar o `Index.html` do Apps Script.
2. `python3 build.py caminho/do/Index.html`
3. Trocar `VERSAO` em `sw.js` e enviar ao GitHub. O Pages publica em cerca de 1 minuto e o app se atualiza sozinho.

## Servidor (Apps Script)

A pasta `servidor/` guarda todos os arquivos `.gs` do Apps Script (a partir da versão 10). O que está aqui é o que deve estar no editor.

| Arquivo | Para quê |
|---|---|
| `servidor/Code.gs` | Base: planilha, pedidos (com o Tipo), semana, tarefas e rotina, e-mails, Clube |
| `servidor/Gestao.gs` | Custos, recálculo (Fichas, Semanal, DRE), indicadores, reuniões, ações, contagem do estoque (com a massa) |
| `servidor/Painel.gs` | Painel da semana (e-mail de domingo e Gestão › Semana), Plano |
| `servidor/Ajuda.gs` | Edição e histórico de pedidos, perguntas frequentes, IA da Ajuda, mensagens do WhatsApp |
| `servidor/Plano.gs` | PDF do plano |
| `servidor/Selo.gs` | Imagem do cabeçalho dos e-mails (`marca/selo-email-416x124.png` em base64) |
| `servidor/Massa.gs` | Massa congelada (versão 10): aba Massa, estoque por sabor, `atualizarV10`, avisos de massa (`verificarMassa`) e `testarV10` |
| `servidor/Api.gs` | Porta de entrada do app (login, sessões, funções permitidas, rotas dos avisos) |
| `servidor/Push.gs` | Avisos no celular pelo Firebase Cloud Messaging e o gatilho de hora em hora `verificarAvisos` |
| `servidor/Producao.gs` | Controle de produção antigo (sem uso desde a versão 10; a aba Producao fica) |
| `servidor/Mural.gs` | Aba Mural do app: recados dos agentes, pedidos ao assistente, cardápio da semana e o gatilho de 5 em 5 minutos `verificarMural` |

Para copiar pelo celular: abrir o arquivo em `raw.githubusercontent.com/brunomathias8-droid/rm-app/main/servidor/<arquivo>` no Safari, tocar e segurar › Selecionar tudo › Copiar.

## Mural

Substitui os e-mails dos agentes. Fluxo:

| Quem | Como entrega | Onde aparece |
|---|---|---|
| Agentes (Marketing sáb., Fechamento ter., Gestão sex.) | criam um `.json` na pasta do Drive "RM · Mural (entrada)" (`mural_pasta_id` na Config) | o `Mural.gs` importa em até 5 min (ou ao abrir o app), manda o arquivo para a lixeira e avisa no celular |
| Assistente (rotina acionada pelo app) | igual, com `pedidoId` | cartão "Resposta do assistente" para quem pediu |
| Sistema | massa baixa (segunda 7h) e lote perto de vencer (9h), pelo `Massa.gs` | cartão automático para a Raquel |

- Formato do cartão: comentário no topo da seção "entrada dos agentes" do `Mural.gs`. Mesma `chave` atualiza o cartão em vez de duplicar.
- Pedido ao assistente: grava na aba PedidosAssistente e responde pela API da Anthropic (chave em Config › `anthropic_api_key`, que vai para as Propriedades do script como `ANTHROPIC_API_KEY`; modelo `claude-sonnet-5-5`, reserva Haiku na 2ª tentativa; troca em Config › `assistente_modelo`). O app chama `responderPedido` logo depois de pedir; o gatilho de 5 min refaz o que ficou para trás (até 3 tentativas). O texto leva as fichas técnicas, as vendas das últimas 4 semanas e o último cardápio. Alternativa, se um dia houver gatilho de API na rotina: `assistente_url` + `assistente_token`.
- Arquivos da marca: `marca/` e `marca/biblioteca.json` (chaves usadas no campo `anexos`).
- Cardápio: editor no app gera o post 1080×1080 e o story 1080×1920 no padrão da marca; o texto fica guardado para a semana seguinte.
- Instalação: colar `Mural.gs`, rodar `ativarMural` (cria as abas, o gatilho e desliga os e-mails diário e de terça; o de domingo continua), Implantar › Gerenciar implantações › Nova versão.

## Gestão › Gráficos

Calculado no aparelho a partir dos pedidos (abertos + entregues) e dos indicadores do mês: receita, pedidos e ticket por semana (metas do plano), clientes novos e recorrentes, itens mais vendidos, receita por tipo, canal de origem, dia da retirada e principais clientes. Limite atual: o servidor devolve os 400 pedidos entregues mais recentes.

## Pedido novo em segundo plano

Ao tocar Salvar, o pedido fica guardado no aparelho e a tela "Pedido salvo" abre na hora. O envio continua sozinho e tenta de novo quando falha, com o aviso "Enviando 1 pedido…" no topo. Cada pedido leva um código (`_rid`); o `Api.gs` devolve o resultado do primeiro envio em vez de gravar de novo (por 6 horas). Sem confirmação em 5 horas, ou com erro do servidor, o aviso fica vermelho e a pessoa decide: enviar de novo ou descartar.

## Massa no congelador (versão 10, decisões 36 e 37 de 22/10/2026)

Cookie é pronta-entrega: a massa é feita em lote, porcionada em bolinhas cruas e congelada. Bolo é encomenda (antecedência mínima em Config › `antecedencia_bolo_dias`). Não existe mais prazo de terça nem margem por hora.

- Aba **Massa**: `ID | Data | Tipo | Produto | Unidades | Validade | Motivo | Observação | Registrado por | Registrado em`. Tipo = Produção, Descarte ou Ajuste.
- Nada fica gravado como saldo: `estoqueMassa_()` calcula na leitura. Vendido = quantidade × "Bolinhas por unidade vendida" (Fichas técnicas) nos pedidos não cancelados a partir do primeiro lote do sabor. A massa sai quando o pedido é registrado, do lote mais antigo.
- Caixas e kits baixam dos sabores escolhidos no pedido (linha `Sabores: 3x Cookie de Nutella; …` na Observação). Sem essa linha, entram no aviso "itens com massa sem sabor definido".
- Pedidos: coluna **Tipo** (Pronta-entrega ou Encomenda; vazio = Encomenda). As etapas gravadas continuam Confirmado → Produzido → Retirado; na pronta-entrega a tela mostra "Assado".
- Contagem do fim do mês: a seção "Massa no congelador" grava linhas de Tipo "Massa" no Estoque; a diferença vira Ajuste (motivo Contagem). Os insumos guardados na massa entram no estoque final (bolinhas × insumo da receita ÷ unidades por lote ÷ bolinhas por unidade).
- Config: `estoque_minimo_massa` (12), `validade_massa_dias` (90), `alerta_lote_dias` (75), `antecedencia_bolo_dias` (2).
- Testes: `testarV10` no editor (cálculo, migração duas vezes, cartão de lote sem duplicar, lista fechada da API).
