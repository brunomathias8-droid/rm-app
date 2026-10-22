/**
 * Mural.gs — recados dos agentes, tarefas de Instagram e pedidos ao assistente, dentro do app (18/10/2026).
 *
 * Aba Mural: cada linha é um cartão. Os agentes (Marketing, Gestão, Fechamento, Assistente) entregam os cartões como
 * arquivos .json na pasta do Drive "RM · Mural (entrada)" (Config › mural_pasta_id); este script importa a pasta de 5 em
 * 5 minutos (e sempre que o app abre o Mural) e manda o arquivo para a lixeira. Também dá para escrever uma linha
 * direto na aba. O app mostra, a Raquel marca como feito, adia ou arquiva. Cartão novo e prazo com hora avisam no celular.
 * Aba PedidosAssistente: o que a Raquel ou o Bruno pedem ao assistente pelo app. O servidor aciona a rotina do
 * assistente (Claude, gatilho por API) e ela responde com um cartão no Mural.
 *
 * Configuração (uma vez):
 *   Config › assistente_url    endereço /fire da rotina "RM · Assistente do app" (claude.ai/code/routines › Editar › API)
 *   Config › assistente_token  token gerado no mesmo lugar. No primeiro uso vai para as Propriedades do script e a célula é limpa.
 *   Config › mural_pasta_id    pasta do Drive onde os agentes deixam os cartões (ativarMural cria se estiver vazia).
 * Depois rodar ativarMural() uma vez: cria as abas, o gatilho de 5 em 5 minutos e desliga os e-mails diário e de terça
 * (o de domingo continua). Para voltar com os e-mails: rodar setup() de novo.
 */
var MURAL_CAB = ['ID', 'CriadoEm', 'Origem', 'Para', 'Tipo', 'Titulo', 'Resumo', 'Corpo', 'Passos', 'Legenda', 'Anexos', 'Cardapio',
  'Prazo', 'Hora', 'Status', 'Vistos', 'FeitoPor', 'FeitoEm', 'AdiadoAte', 'PedidoID', 'Avisado', 'Lembrado', 'Chave'];
var PEDAS_CAB = ['ID', 'CriadoEm', 'Pessoa', 'Texto', 'CartaoID', 'Status', 'Tentativas', 'UltimaTentativa', 'RespondidoEm', 'MuralID', 'Sessao', 'Erro'];
var MURAL_TIPOS = ['tarefa', 'post', 'cardapio', 'relatorio', 'aviso', 'resposta'];
var MURAL_LIMITE_DIA = 25;   // pedidos ao assistente por dia (os dois juntos)

/* Funções que o app pode chamar (o Api.gs junta estas à lista permitida) */
function apiExtras_() {
  return { getMural: getMural, muralAcao: muralAcao, salvarCardapio: salvarCardapio, pedirAssistente: pedirAssistente, responderPedido: responderPedido };
}

/* ------------------------------ abas ------------------------------ */

function muralAba_(nome, cab) {
  var sh = sh_(nome);
  if (!sh) {
    sh = ss_().insertSheet(nome);
    sh.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), cab.length).setNumberFormat('@');
  }
  return sh;
}
function muralLer_(nome, cab) {
  var sh = muralAba_(nome, cab), n = sh.getLastRow() - 1;
  if (n <= 0) return { sh: sh, linhas: [] };
  var lc = Math.max(sh.getLastColumn(), cab.length);
  var topo = sh.getRange(1, 1, 1, lc).getValues()[0].map(function (c) { return String(c).trim(); });
  var linhas = sh.getRange(2, 1, n, lc).getValues().map(function (r, i) {
    var o = { _linha: i + 2 };
    cab.forEach(function (c) { var k = topo.indexOf(c); var v = k >= 0 ? r[k] : ''; o[c] = isDate_(v) ? fmtIsoData_(v, c) : String(v === null || v === undefined ? '' : v).trim(); });
    return o;
  }).filter(function (o) { return o.ID || o.Titulo || o.Texto; });
  return { sh: sh, linhas: linhas, topo: topo };
}
/* Linha gravada à mão ou por agente sem ID: recebe ID e data agora, para o app conseguir marcar feito/adiar */
function muralGarantirIds_(t) {
  var faltam = t.linhas.filter(function (c) { return !c.ID || !c.CriadoEm || !c.Status; });
  if (!faltam.length) return;
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    faltam.forEach(function (c, i) {
      if (!c.ID) c.ID = 'M' + Date.now() + String(i).padStart(3, '0');
      if (!c.CriadoEm) c.CriadoEm = new Date().toISOString();
      if (!c.Status) c.Status = 'novo';
      muralGravar_(t, c, ['ID', 'CriadoEm', 'Status']);
    });
  } finally { lock.releaseLock(); }
}
function fmtIsoData_(v, campo) { return campo === 'Hora' ? fmt_(v, 'HH:mm') : (campo === 'Prazo' || campo === 'AdiadoAte') ? fmt_(v) : v.toISOString(); }
function muralGravar_(t, o, campos) {
  campos.forEach(function (c) { var k = t.topo.indexOf(c); if (k >= 0) t.sh.getRange(o._linha, k + 1).setValue(o[c] === undefined ? '' : o[c]); });
}
/* Normaliza datas e horas que o agente pode ter escrito em outro formato */
function muralData_(s) {
  s = String(s || '').trim(); var m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + '-' + m[2] + '-' + m[3];
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}
function muralHora_(s) { var m = String(s || '').match(/^(\d{1,2})[:h](\d{2})?/); return m && +m[1] < 24 ? ('0' + m[1]).slice(-2) + ':' + (m[2] || '00') : ''; }
function muralPara_(p) { p = String(p || '').trim(); return /raquel/i.test(p) ? 'Raquel' : /bruno/i.test(p) ? 'Bruno' : 'Ambos'; }
function muralParaMim_(c, pessoa) { return c.Para === 'Ambos' || c.Para === pessoa || !c.Para; }

/* ------------------------------ leitura pelo app ------------------------------ */

function getMural(pin, pessoa) {
  checkPin_(pin);
  try {   // resposta do assistente aparece assim que o app abre (no máximo uma leitura do Drive a cada 20 s)
    var cc = CacheService.getScriptCache();
    if (!cc.get('mural_imp')) { cc.put('mural_imp', '1', 20); muralImportar_(); }
  } catch (e) { Logger.log('importar no getMural: ' + e); }
  var hoje = today_(), lim = addDays_(hoje, -21), tm = muralLer_('Mural', MURAL_CAB);
  muralGarantirIds_(tm);
  var cards = tm.linhas.filter(function (c) {
    if (c.Status === 'arquivado') return false;
    if (c.Status === 'feito') return String(c.FeitoEm).slice(0, 10) >= lim;
    return true;
  }).map(function (c) { return muralPublico_(c, pessoa, hoje); });
  cards.sort(function (a, b) { return a.ordem - b.ordem || String(b.criadoEm).localeCompare(String(a.criadoEm)); });
  var peds = muralLer_('PedidosAssistente', PEDAS_CAB).linhas.filter(function (p) { return String(p.CriadoEm).slice(0, 10) >= addDays_(hoje, -14); })
    .map(function (p) { return { id: p.ID, criadoEm: p.CriadoEm, pessoa: p.Pessoa, texto: p.Texto, cartaoId: p.CartaoID, status: p.Status || 'aberto', muralId: p.MuralID, erro: p.Erro }; })
    .reverse().slice(0, 30);
  return { hoje: hoje, cartoes: cards, pedidos: peds, assistente: muralAssistenteLigado_(), ultimoCardapio: muralUltimoCardapio_() };
}

function muralPublico_(c, pessoa, hoje) {
  var cardapio = null;
  if (c.Cardapio) { try { cardapio = JSON.parse(c.Cardapio); } catch (e) { cardapio = null; } }
  var prazo = muralData_(c.Prazo), adiado = muralData_(c.AdiadoAte), ativo = c.Status !== 'feito';
  var quando = adiado && adiado > prazo ? adiado : prazo;
  // ordem: atrasados e de hoje primeiro, depois novos sem prazo, depois futuros, por último feitos
  var ordem = !ativo ? 9 : quando && quando < hoje ? 0 : quando === hoje ? 1 : !quando ? 2 : 3;
  var vistos = String(c.Vistos || '').split(',').map(function (s) { return s.trim(); });
  return {
    id: c.ID, criadoEm: c.CriadoEm, origem: c.Origem || 'Sistema', para: muralPara_(c.Para), tipo: MURAL_TIPOS.indexOf(c.Tipo) >= 0 ? c.Tipo : 'aviso',
    titulo: c.Titulo, resumo: c.Resumo, corpo: c.Corpo, passos: String(c.Passos || '').split(/\n+/).map(function (s) { return s.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim(); }).filter(Boolean),
    legenda: c.Legenda, anexos: String(c.Anexos || '').split(/[,;\n]+/).map(function (s) { return s.trim(); }).filter(Boolean), cardapio: cardapio,
    prazo: prazo, hora: muralHora_(c.Hora), adiadoAte: adiado, status: c.Status || 'novo', feitoPor: c.FeitoPor, feitoEm: c.FeitoEm,
    pedidoId: c.PedidoID, visto: vistos.indexOf(pessoa) >= 0, paraMim: muralParaMim_(c, pessoa), ordem: ordem
  };
}

/* ------------------------------ ações pelo app ------------------------------ */

function muralAcao(pin, id, acao, pessoa, valor) {
  checkPin_(pin);
  if (API_PESSOAS.indexOf(pessoa) < 0) throw new Error('Pessoa inválida.');
  var lock = LockService.getScriptLock(); lock.waitLock(15000);
  try {
    var t = muralLer_('Mural', MURAL_CAB), c = t.linhas.filter(function (x) { return x.ID === String(id); })[0];
    if (!c) throw new Error('Cartão não encontrado (pode ter sido apagado na planilha).');
    var agora = new Date().toISOString(), campos = [];
    var vistos = String(c.Vistos || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (vistos.indexOf(pessoa) < 0) { vistos.push(pessoa); c.Vistos = vistos.join(','); campos.push('Vistos'); }
    if (acao === 'feito') { c.Status = 'feito'; c.FeitoPor = pessoa; c.FeitoEm = agora; campos.push('Status', 'FeitoPor', 'FeitoEm'); }
    else if (acao === 'reabrir') { c.Status = 'novo'; c.FeitoPor = ''; c.FeitoEm = ''; campos.push('Status', 'FeitoPor', 'FeitoEm'); }
    else if (acao === 'adiar') {
      var d = muralData_(valor); if (!d || d < today_()) throw new Error('Escolha uma data a partir de hoje.');
      c.AdiadoAte = d; c.Status = 'adiado'; c.Lembrado = ''; campos.push('AdiadoAte', 'Status', 'Lembrado');
    }
    else if (acao === 'arquivar') { c.Status = 'arquivado'; campos.push('Status'); }
    else if (acao !== 'visto') throw new Error('Ação inválida.');
    muralGravar_(t, c, campos);
    return muralPublico_(c, pessoa, today_());
  } finally { lock.releaseLock(); }
}

/* Cardápio montado no app: guarda no cartão (se houver) e como último cardápio, para reaproveitar na semana seguinte */
function salvarCardapio(pin, id, cardapio, pessoa) {
  checkPin_(pin);
  var j = muralValidarCardapio_(cardapio), txt = JSON.stringify(j);
  PropertiesService.getScriptProperties().setProperty('CARDAPIO_ULTIMO', txt);
  if (id) {
    var t = muralLer_('Mural', MURAL_CAB), c = t.linhas.filter(function (x) { return x.ID === String(id); })[0];
    if (c) { c.Cardapio = txt; muralGravar_(t, c, ['Cardapio']); }
  }
  return { ok: true, cardapio: j };
}
function muralValidarCardapio_(c) {
  if (!c || typeof c !== 'object') throw new Error('Cardápio inválido.');
  var s = function (v, n) { return String(v === undefined || v === null ? '' : v).slice(0, n || 120); };
  var itens = (Array.isArray(c.itens) ? c.itens : []).slice(0, 8).map(function (i) {
    return { nome: s(i.nome, 60), desc: s(i.desc, 110), peso: s(i.peso, 30), preco: s(i.preco, 20), qtd: s(i.qtd, 30), destaque: !!i.destaque };
  }).filter(function (i) { return i.nome; });
  if (!itens.length) throw new Error('O cardápio precisa de pelo menos um item.');
  return { titulo: s(c.titulo, 60) || 'Cardápio da semana', periodo: s(c.periodo, 40), itens: itens, prazo: s(c.prazo, 80), retirada: s(c.retirada, 100), nota: s(c.nota, 140) };
}
function muralUltimoCardapio_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('CARDAPIO_ULTIMO') || 'null'); } catch (e) { return null; } }

/* ------------------------------ assistente ------------------------------ */

function muralAssistenteCfg_() {
  var c = config_(), props = PropertiesService.getScriptProperties(), tok = String(c.assistente_token || '').trim();
  if (tok && !/^\(guardad/.test(tok)) {   // move o token da planilha para as Propriedades do script
    props.setProperty('ASSISTENTE_TOKEN', tok);
    var sh = sh_('Config'), n = sh.getLastRow() - 1;
    sh.getRange(2, 1, n, 2).getValues().forEach(function (r, i) { if (String(r[0]).trim() === 'assistente_token') sh.getRange(i + 2, 2).setValue('(guardado nas Propriedades do script)'); });
  }
  var url = String(c.assistente_url || '').trim();
  // chave da API da Anthropic (console.anthropic.com): colada em Config › anthropic_api_key, vai para as Propriedades do script
  var chave = String(c.anthropic_api_key || '').trim();
  if (chave && !/^\(guardad/.test(chave)) { props.setProperty('ANTHROPIC_API_KEY', chave); muralConfig_('anthropic_api_key', '(guardada nas Propriedades do script)'); }
  return { url: /^https:\/\/api\.anthropic\.com\/v1\/claude_code\/routines\/[\w-]+\/fire$/.test(url) ? url : '', token: props.getProperty('ASSISTENTE_TOKEN') || '',
    chave: props.getProperty('ANTHROPIC_API_KEY') || '' };
}
/* Dois jeitos de responder: pela API da Anthropic (chave; responde em segundos, preferido) ou pela rotina do Claude (URL + token) */
function muralAssistenteLigado_() { var c = muralAssistenteCfg_(); return !!(c.chave || (c.url && c.token)); }

function pedirAssistente(pin, pessoa, texto, cartaoId) {
  checkPin_(pin);
  if (API_PESSOAS.indexOf(pessoa) < 0) throw new Error('Pessoa inválida.');
  texto = String(texto || '').trim();
  if (texto.length < 4) throw new Error('Escreva o que você precisa.');
  if (texto.length > 1500) throw new Error('Texto longo demais (máximo 1.500 caracteres).');
  var cfg = muralAssistenteCfg_();
  if (!cfg.chave && !(cfg.url && cfg.token)) throw new Error('O assistente ainda não foi ligado no servidor (falta a chave anthropic_api_key na Config).');
  var t = muralLer_('PedidosAssistente', PEDAS_CAB), hoje = today_();
  if (t.linhas.filter(function (p) { return String(p.CriadoEm).slice(0, 10) === hoje; }).length >= MURAL_LIMITE_DIA) throw new Error('Limite de ' + MURAL_LIMITE_DIA + ' pedidos por dia atingido. Tente amanhã.');
  var id = 'A' + Date.now(), agora = new Date().toISOString();
  t.sh.appendRow([id, agora, pessoa, texto, String(cartaoId || ''), 'aberto', '0', '', '', '', '', '']);
  if (cfg.chave) return { id: id, status: 'aberto', modo: 'api' };   // o app chama responderPedido logo em seguida (e o gatilho de 5 min garante)
  var r = muralDisparar_(id);
  return { id: id, status: r.ok ? 'enviado' : 'erro', erro: r.ok ? '' : r.erro };
}
/* Chamado pelo app logo depois de pedirAssistente: responde na hora pela API */
function responderPedido(pin, id) {
  checkPin_(pin);
  return muralResponderApi_(String(id || ''));
}

/* Aciona a rotina do assistente. O texto enviado leva só o código do pedido: a rotina lê o pedido na planilha. */
function muralDisparar_(id) {
  if (muralAssistenteCfg_().chave) return muralResponderApi_(id);
  var cfg = muralAssistenteCfg_(), t = muralLer_('PedidosAssistente', PEDAS_CAB), p = t.linhas.filter(function (x) { return x.ID === id; })[0];
  if (!p) return { ok: false, erro: 'pedido não encontrado' };
  var tent = (Number(p.Tentativas) || 0) + 1, res;
  try {
    var r = UrlFetchApp.fetch(cfg.url, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + cfg.token, 'anthropic-beta': 'experimental-cc-routine-2026-04-01', 'anthropic-version': '2023-06-01' },
      payload: JSON.stringify({ text: muralTextoPedido_(p) }) });
    var code = r.getResponseCode(), txt = r.getContentText();
    if (code >= 200 && code < 300) {
      var j = {}; try { j = JSON.parse(txt); } catch (e) {}
      res = { ok: true, sessao: j.claude_code_session_url || '' };
    } else res = { ok: false, erro: 'Claude respondeu ' + code + ': ' + txt.slice(0, 160) };
  } catch (e) { res = { ok: false, erro: String(e.message || e).slice(0, 160) }; }
  p.Tentativas = String(tent); p.UltimaTentativa = new Date().toISOString();
  p.Status = res.ok ? 'enviado' : (tent >= 3 ? 'erro' : 'aberto'); p.Erro = res.ok ? '' : res.erro; p.Sessao = res.sessao || p.Sessao;
  muralGravar_(t, p, ['Tentativas', 'UltimaTentativa', 'Status', 'Erro', 'Sessao']);
  return res;
}

/* ------------------------------ assistente pela API da Anthropic ------------------------------ */
var MURAL_IA_MODELO = 'claude-sonnet-5-5', MURAL_IA_RESERVA = 'claude-haiku-4-5-20251001';

function muralResponderApi_(id) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  var t, p, tent;
  try {   // reserva o pedido: o app e o gatilho de 5 min nunca respondem o mesmo pedido duas vezes
    t = muralLer_('PedidosAssistente', PEDAS_CAB); p = t.linhas.filter(function (x) { return x.ID === id; })[0];
    if (!p) return { ok: false, erro: 'Pedido não encontrado.' };
    if (p.Status !== 'aberto') return { ok: p.Status === 'respondido', status: p.Status, muralId: p.MuralID || '' };
    tent = (Number(p.Tentativas) || 0) + 1;
    p.Tentativas = String(tent); p.UltimaTentativa = new Date().toISOString(); p.Status = 'enviado'; p.Sessao = 'api'; p.Erro = '';
    muralGravar_(t, p, ['Tentativas', 'UltimaTentativa', 'Status', 'Sessao', 'Erro']);
  } finally { lock.releaseLock(); }
  try {
    var cfg = muralAssistenteCfg_(), modelo = tent >= 2 ? MURAL_IA_RESERVA : String(config_().assistente_modelo || MURAL_IA_MODELO);
    var body = { model: modelo, max_tokens: 3000,
      system: [{ type: 'text', text: muralSistemaIA_(), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: muralContextoIA_() + '\n\n' + muralTextoPedido_(p) }] };
    var r = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-api-key': cfg.chave, 'anthropic-version': '2023-06-01' }, payload: JSON.stringify(body) });
    var code = r.getResponseCode(), js = {};
    try { js = JSON.parse(r.getContentText()); } catch (e) {}
    if (code !== 200) throw new Error(code === 401 ? 'Chave da API inválida (Config › anthropic_api_key).' : code === 400 && /credit/i.test(r.getContentText()) ? 'Sem crédito na conta da API (console.anthropic.com).' : 'A API respondeu ' + code + ': ' + r.getContentText().slice(0, 160));
    var texto = (js.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
    if (!texto) throw new Error('Resposta vazia.');
    var c = null, m = texto.match(/[\[{][\s\S]*[\]}]/);
    if (m) { try { var j = JSON.parse(m[0]); c = Array.isArray(j) ? j[0] : j && Array.isArray(j.cartoes) ? j.cartoes[0] : j; } catch (e) { c = null; } }
    if (!c || typeof c !== 'object' || !c.titulo) c = { titulo: 'Resposta do assistente', tipo: 'resposta', corpo: texto };   // veio fora do formato: entrega o texto mesmo assim
    c.pedidoId = p.ID; c.origem = 'Assistente'; c.para = p.Pessoa; delete c.chave;
    var lk = LockService.getScriptLock(); lk.waitLock(10000);
    try { if (!muralDoAgente_(c)) throw new Error('Resposta sem título.'); } finally { lk.releaseLock(); }
    var d = muralLer_('PedidosAssistente', PEDAS_CAB).linhas.filter(function (x) { return x.ID === id; })[0] || {};
    return { ok: true, status: 'respondido', muralId: d.MuralID || '' };
  } catch (e) {
    var msg = String(e.message || e).slice(0, 200);
    Logger.log('assistente API ' + id + ': ' + msg);
    var t2 = muralLer_('PedidosAssistente', PEDAS_CAB), p2 = t2.linhas.filter(function (x) { return x.ID === id; })[0];
    if (p2 && p2.Status === 'enviado') { p2.Status = tent >= 3 || /inválida|crédito/.test(msg) ? 'erro' : 'aberto'; p2.Erro = msg; muralGravar_(t2, p2, ['Status', 'Erro']); }
    return { ok: false, status: p2 ? p2.Status : 'erro', erro: msg };
  }
}

/* Regras fixas (ficam em cache na API: só a primeira chamada de cada 5 minutos paga o texto inteiro) */
function muralSistemaIA_() {
  return [
    'Você é o assistente da RM Confeitaria Artesanal (bolos caseirinhos, cookies e pudins de Raquel Miranda, Fortaleza). Quem pede é a Raquel ou o Bruno, pela aba Mural do app da empresa. Português do Brasil.',
    '',
    'O QUE VOCÊ FAZ: rascunhos e respostas — legendas, roteiros de reel, textos de story, cardápio da semana, respostas para clientes no WhatsApp (a Raquel copia e envia ela mesma), cálculo de preço e margem com os dados da ficha técnica, ideias de ação comercial, dúvidas sobre o plano ou o app. Use só os dados enviados abaixo; se faltar dado, diga qual e marque a estimativa como "premissa". Não invente números. Nada é publicado nem enviado por você.',
    '',
    'MARCA E TOM (obrigatório em todo texto para cliente): nome "RM Confeitaria Artesanal", assinatura "por Raquel Miranda". Instagram @rm_confeitari4 (nunca o antigo @rm_bolosartesanais; nunca o nome antigo "RM Confeitaria do dia a dia"). WhatsApp de pedidos (85) 98690-0420, link wa.me/5585986900420. Tom direto e específico: sabor, textura, peso, prazo, preço publicado. No máximo 1 emoji por texto, sem frases de efeito, nunca "feito com amor", nunca "fornada", nunca "caseiro rústico". "Artesanal" = feito à mão em pequenos lotes, com ingrediente de verdade: diga isso com fatos. Nunca ofereça bolo de festa, pasta americana ou encomenda personalizada. Pedido mínimo R$ 45; cookie só em caixa fechada; entrega por motoboy ou Uber paga pela cliente. Embalagem do cookie: sacola kraft com lacre da marca e cada cookie em saquinho com selo.',
    'MODELO (decisão 36, 22/10/2026): cookie é pronta-entrega. A Raquel faz a massa em lote, porciona em bolinhas cruas e congela (lança no app como produção); assa conforme a venda, de quarta a sábado ou em qualquer dia. Bolo caseirinho é sob encomenda, com pelo menos 2 dias de antecedência. Pudim está fora do cardápio por ora. Não existe prazo semanal de pedido: nunca escreva "pedidos até terça" nem janelas fixas de retirada; a retirada é combinada com cada cliente (data e hora). Pagamento: encomenda com Pix antecipado; pronta-entrega pode pagar o Pix até a retirada. O cookie é o produto mais vendido; o estoque de produção por produto vem nos dados abaixo. Não existe mais margem por hora nem registro de horas: para decidir o mix, use a margem de contribuição por produto (preço − custo da ficha).',
    'CLUBE DA RAQUEL: a cada 5º pedido, 2 cookies de mimo; frequente (3 ou mais pedidos em 60 dias) recebe o cardápio no sábado 18h e reserva até domingo 12h; assinatura R$ 250/mês com lugar garantido; indicação com código (R$ 10 para os dois lados) a partir de 16/01/2027. Não prometa desconto ou brinde fora disso.',
    'TEXTO INTERNO (para Raquel e Bruno): neutro e objetivo, frases curtas, ação primeiro; avalie com honestidade e aponte problema quando houver (preço abaixo do custo, demanda acima da capacidade, regra da marca quebrada).',
    'Se o pedido pedir algo fora dessas regras, explique no cartão o que não pode e entregue a parte possível.',
    '',
    'FORMATO DA RESPOSTA: responda SOMENTE com um objeto JSON válido, sem texto antes ou depois e sem bloco de código, com estes campos (inclua só os que fizerem sentido):',
    '{"tipo": "post" se houver texto para Instagram ou WhatsApp, "cardapio" se for cardápio, senão "resposta"; "titulo": até 80 caracteres, diz o que é; "resumo": uma linha, o que a pessoa faz com isto; "legenda": texto pronto para colar, até 2200 caracteres; "corpo": explicação, outras opções, cálculos (aceita **negrito**, listas "- " ou "1. " e tabelas com |, com linha |---|); "passos": lista de 2 a 6 ações concretas; "anexos": chaves de arquivos da marca, só destas: avatar, destaque-cardapio, destaque-como-pedir, destaque-retirada, destaque-clientes, destaque-portfolio, logotipo-horizontal, logotipo-horizontal-negativo, logotipo-vertical, logotipo-so-texto, selo-cor, selo-negativo, selo-pequeno, lacre-50mm, cartao-indicacao-90x50, clube-logotipo, clube-selo, adesivo-clube-50mm, cartao-clube-90x50; "cardapio": {"titulo": "Cardápio da semana", "periodo": "26 a 30/10", "itens": [{"nome": até 60 caracteres, "desc": até 110 caracteres (sabor e textura), "peso": "900 g", "preco": "R$ 70", "qtd": "10 unidades", "destaque": true só no mais vendido}], "prazo": "Pronta-entrega: cookies assados no dia", "retirada": "Retirada combinada pelo WhatsApp", "nota": "Bolo sob encomenda com 2 dias de antecedência · entrega por motoboy por conta da cliente"} — só em pedido de cardápio, 1 a 6 itens, preços iguais aos da ficha}.',
    'Com duas ou três opções de texto, ponha a recomendada em "legenda" e as outras no "corpo". Se o pedido trouxer "Recado de referência", entregue a versão ajustada completa e diga no resumo o que mudou. Seja conciso: o corpo com no máximo 250 palavras.'
  ].join('\n');
}

/* Dados do dia: produtos e preços, o que mais vendeu nas últimas 4 semanas e o último cardápio */
function muralContextoIA_() {
  var l = [], hoje = today_(), dSem = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][new Date(hoje + 'T12:00:00').getDay()];
  l.push('DADOS DE HOJE (' + dSem + ', ' + hoje.split('-').reverse().join('/') + ').');
  try {
    var sh = sh_('Fichas técnicas'), n = Math.min(Math.max(sh.getLastRow() - 1, 0), 60);
    if (n) {
      l.push('', 'PRODUTOS (aba Fichas técnicas: nome | preço | custo por unidade | margem de contribuição por unidade | status do preço):');
      sh.getRange(2, 1, n, 13).getValues().forEach(function (r) {
        if (!r[0]) return;
        var f = function (v) { return typeof v === 'number' ? 'R$ ' + v.toFixed(2).replace('.', ',') : '—'; };
        l.push('- ' + r[0] + ' | ' + f(r[1]) + ' | ' + f(r[12]) + ' | ' + (typeof r[1] === 'number' && typeof r[12] === 'number' ? f(r[1] - r[12]) : '—') + ' | ' + (r[11] || '—'));
      });
    }
  } catch (e) { l.push('(fichas técnicas indisponíveis agora)'); }
  try {
    var ps = sh_('Pedidos'), np = ps.getLastRow() - 1, lim = addDays_(hoje, -28), cont = {}, nPed = 0, rec = 0;
    if (np > 0) {
      var ini = Math.max(2, ps.getLastRow() - 399);
      ps.getRange(ini, 1, ps.getLastRow() - ini + 1, 15).getValues().forEach(function (r) {
        var d = r[0] instanceof Date ? fmt_(r[0], 'yyyy-MM-dd') : String(r[0]).slice(0, 10);
        if (!d || d < lim || String(r[10]) === 'Cancelado') return;
        nPed++; rec += (Number(r[3]) || 0) - (Number(r[14]) || 0);
        String(r[2] || '').split(';').forEach(function (s) { var m = s.trim().match(/^(\d+)\s*x\s*(.+)$/i); var q = m ? +m[1] : 1, nome = (m ? m[2] : s).trim(); if (nome) cont[nome] = (cont[nome] || 0) + q; });
      });
    }
    var top = Object.keys(cont).sort(function (a, b) { return cont[b] - cont[a]; }).slice(0, 10);
    l.push('', 'VENDAS DAS ÚLTIMAS 4 SEMANAS: ' + nPed + ' pedidos, receita R$ ' + rec.toFixed(2).replace('.', ',') + ' (sem taxa de entrega).' + (top.length ? ' Mais vendidos (unidades): ' + top.map(function (k) { return k + ' ' + cont[k]; }).join('; ') + '.' : ''));
  } catch (e) { l.push('(pedidos indisponíveis agora)'); }
  try {
    if (typeof estoqueProducao_ === 'function') {
      var em = estoqueProducao_(hoje);
      if (em.itens.length) l.push('', 'ESTOQUE DE PRODUÇÃO (cookie = bolinhas de massa congelada; mínimo ' + em.cfg.minimo + ' livres): ' + em.itens.map(function (x) { return x.produto + ' ' + x.estoque + ' no estoque, ' + x.reservado + ' em pedidos, ' + x.livre + ' livres'; }).join('; ') + '.');
    }
  } catch (e) { l.push('(estoque de produção indisponível agora)'); }
  try { var u = muralUltimoCardapio_(); if (u) l.push('', 'ÚLTIMO CARDÁPIO SALVO NO APP: ' + JSON.stringify(u).slice(0, 1500)); } catch (e) {}
  return l.join('\n');
}

/* Texto que a rotina recebe: o pedido completo, para o assistente não depender de ler a planilha.
   Quando o pedido nasce de "Pedir ajuste" num recado, vai junto o conteúdo desse recado. */
function muralTextoPedido_(p) {
  var l = ['Pedido do app RM', 'ID: ' + p.ID, 'De: ' + p.Pessoa, 'Em: ' + p.CriadoEm];
  if (p.CartaoID) {
    var c = muralLer_('Mural', MURAL_CAB).linhas.filter(function (x) { return x.ID === p.CartaoID; })[0];
    if (c) {
      l.push('', 'Recado de referência (ID ' + c.ID + ', de ' + c.Origem + '): ' + c.Titulo);
      if (c.Chave) l.push('Chave do recado: ' + c.Chave);
      if (c.Resumo) l.push('Resumo: ' + c.Resumo);
      if (c.Passos) l.push('Passos:\n' + String(c.Passos).slice(0, 1500));
      if (c.Legenda) l.push('Legenda atual:\n' + String(c.Legenda).slice(0, 2200));
      if (c.Cardapio) l.push('Cardápio atual (JSON): ' + String(c.Cardapio).slice(0, 3000));
      if (c.Corpo) l.push('Texto do recado:\n' + String(c.Corpo).slice(0, 4000));
    }
  }
  l.push('', '--- pedido ---', String(p.Texto));
  return l.join('\n');
}

/* ------------------------------ entrada dos agentes (pasta do Drive) ------------------------------ */
/* Formato do arquivo (.json, um cartão ou uma lista; também aceita { "cartoes": [...] }):
   { "chave": "marketing-2026-10-24-cardapio",   // opcional: mesma chave atualiza o cartão em vez de duplicar
     "origem": "Marketing" | "Gestão" | "Fechamento" | "Assistente" | "Plano",
     "para": "Raquel" | "Bruno" | "Ambos", "tipo": "tarefa" | "post" | "cardapio" | "relatorio" | "aviso" | "resposta",
     "titulo": "…", "resumo": "uma linha", "corpo": "texto com **negrito**, listas e tabelas |", "passos": ["…", "…"],
     "legenda": "texto pronto para colar no Instagram", "anexos": ["avatar", "destaque-cardapio"],
     "cardapio": { "titulo", "periodo", "itens": [{ "nome", "desc", "peso", "preco", "qtd", "destaque" }], "prazo", "retirada", "nota" },
     "prazo": "2026-10-25", "hora": "17:00", "pedidoId": "A1760…" }   // pedidoId: resposta a um pedido feito pelo app */
function muralPasta_(criar) {
  var id = String(config_().mural_pasta_id || '').trim();
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { if (!criar) throw new Error('Pasta do Mural (mural_pasta_id) não encontrada no Drive.'); } }
  if (!criar) return null;
  var pai = null; try { var ps = DriveApp.getFileById(SHEET_ID).getParents(); if (ps.hasNext()) pai = ps.next(); } catch (e) {}
  var pasta = pai ? pai.createFolder('RM · Mural (entrada)') : DriveApp.createFolder('RM · Mural (entrada)');
  muralConfig_('mural_pasta_id', pasta.getId(), 'Pasta do Drive onde os agentes deixam os cartões do Mural (.json). O script importa e manda para a lixeira.');
  return pasta;
}
function muralConfig_(chave, valor, uso) {
  var sh = sh_('Config'), n = sh.getLastRow() - 1, v = n > 0 ? sh.getRange(2, 1, n, 1).getValues() : [];
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === chave) { sh.getRange(i + 2, 2).setValue(valor); return; }
  sh.appendRow([chave, valor, uso || '']);
}
function muralLerArquivo_(f) {
  var mt = f.getMimeType();
  if (mt === MimeType.GOOGLE_DOCS) {   // o agente esqueceu de desligar a conversão: exporta como texto
    var r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + f.getId() + '/export?mimeType=text/plain', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
    return r.getResponseCode() === 200 ? r.getContentText('UTF-8') : '';
  }
  return f.getBlob().getDataAsString('UTF-8');
}
function muralImportar_() {
  var pasta = muralPasta_(false); if (!pasta) return 0;
  var lock = LockService.getScriptLock(); if (!lock.tryLock(8000)) return 0;
  var n = 0;
  try {
    var it = pasta.getFiles(), arquivos = [];
    while (it.hasNext() && arquivos.length < 20) arquivos.push(it.next());
    arquivos.sort(function (a, b) { return a.getDateCreated() - b.getDateCreated(); });
    arquivos.forEach(function (f) {
      var txt = muralLerArquivo_(f).replace(/^﻿/, '').trim(), j = null;
      var m = txt.match(/[\[{][\s\S]*[\]}]/); if (m) txt = m[0];   // tolera texto antes ou depois do JSON
      try { j = JSON.parse(txt); } catch (e) {
        muralNovo_({ Origem: 'Sistema', Para: 'Bruno', Tipo: 'aviso', Titulo: 'Recado de agente com formato inválido', Resumo: f.getName(), Corpo: 'O arquivo **' + f.getName() + '** chegou na pasta do Mural, mas não é um JSON válido (' + e.message + '). Ele foi para a lixeira do Drive.\n\nInício do conteúdo:\n\n' + txt.slice(0, 600) });
        f.setTrashed(true); return;
      }
      var lista = Array.isArray(j) ? j : (j && Array.isArray(j.cartoes) ? j.cartoes : [j]);
      lista.slice(0, 15).forEach(function (c) { try { if (muralDoAgente_(c)) n++; } catch (e) { Logger.log('cartão inválido em ' + f.getName() + ': ' + e.message); } });
      f.setTrashed(true);
    });
  } finally { lock.releaseLock(); }
  return n;
}
function muralTexto_(v, max) { if (v === undefined || v === null) return ''; if (typeof v === 'object') v = JSON.stringify(v); return String(v).replace(/\r/g, '').trim().slice(0, max || 500); }
/* Valida um cartão vindo de agente e grava (ou atualiza, se a chave já existe e o cartão não foi arquivado) */
function muralDoAgente_(c) {
  if (!c || typeof c !== 'object') return false;
  var titulo = muralTexto_(c.titulo, 120); if (!titulo) return false;
  var origem = muralTexto_(c.origem, 20), origens = ['Marketing', 'Gestão', 'Fechamento', 'Assistente', 'Plano', 'Sistema'];
  if (origens.indexOf(origem) < 0) origem = /gest/i.test(origem) ? 'Gestão' : origens.filter(function (o) { return o.toLowerCase() === origem.toLowerCase(); })[0] || 'Assistente';
  var passos = Array.isArray(c.passos) ? c.passos.map(function (s) { return muralTexto_(s, 300); }).filter(Boolean).slice(0, 12).join('\n') : muralTexto_(c.passos, 3000);
  var anexos = (Array.isArray(c.anexos) ? c.anexos : String(c.anexos || '').split(/[,;\s]+/)).map(function (s) { return String(s).trim(); }).filter(function (s) { return /^[a-z0-9-]{2,40}$/.test(s); }).slice(0, 8).join(',');
  var cardapio = '';
  if (c.cardapio && typeof c.cardapio === 'object') { try { cardapio = JSON.stringify(muralValidarCardapio_(c.cardapio)); } catch (e) { cardapio = ''; } }
  var pedido = muralTexto_(c.pedidoId, 40), ped = null, peds = null;
  if (pedido) { peds = muralLer_('PedidosAssistente', PEDAS_CAB); ped = peds.linhas.filter(function (p) { return p.ID === pedido; })[0] || null; }
  var tipo = muralTexto_(c.tipo, 20); if (MURAL_TIPOS.indexOf(tipo) < 0) tipo = cardapio ? 'cardapio' : c.legenda ? 'post' : pedido ? 'resposta' : 'aviso';
  var o = { Origem: pedido ? 'Assistente' : origem, Para: c.para ? muralPara_(c.para) : ped ? muralPara_(ped.Pessoa) : 'Ambos', Tipo: tipo, Titulo: titulo,
    Resumo: muralTexto_(c.resumo, 200), Corpo: muralTexto_(c.corpo, 20000), Passos: passos, Legenda: muralTexto_(c.legenda, 2200), Anexos: anexos, Cardapio: cardapio,
    Prazo: muralData_(c.prazo), Hora: muralHora_(c.hora), PedidoID: ped ? ped.ID : '', Chave: muralTexto_(c.chave, 80) };
  var t = muralLer_('Mural', MURAL_CAB), id = '';
  var ja = o.Chave ? t.linhas.filter(function (x) { return x.Chave === o.Chave && x.Status !== 'arquivado'; })[0] : null;
  if (ja) {   // agente rodou de novo: atualiza o conteúdo e volta a avisar só se ainda não foi feito
    ['Origem', 'Para', 'Tipo', 'Titulo', 'Resumo', 'Corpo', 'Passos', 'Legenda', 'Anexos', 'Cardapio', 'Prazo', 'Hora'].forEach(function (k) { ja[k] = o[k]; });
    muralGravar_(t, ja, ['Origem', 'Para', 'Tipo', 'Titulo', 'Resumo', 'Corpo', 'Passos', 'Legenda', 'Anexos', 'Cardapio', 'Prazo', 'Hora']);
    id = ja.ID;
  } else id = muralNovo_(o);
  if (ped) { ped.Status = 'respondido'; ped.RespondidoEm = new Date().toISOString(); ped.MuralID = id; ped.Erro = ''; muralGravar_(peds, ped, ['Status', 'RespondidoEm', 'MuralID', 'Erro']); }
  return true;
}

/* ------------------------------ avisos (gatilho de 5 em 5 minutos) ------------------------------ */

function verificarMural() {
  try { muralImportar_(); } catch (e) { Logger.log('importar: ' + (e.stack || e)); }
  var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return;
  try {
    var agora = new Date(), hoje = today_(), hm = fmt_(agora, 'HH:mm'), hora = Number(hm.slice(0, 2)), silencio = hora >= 22 || hora < 7;
    var t = muralLer_('Mural', MURAL_CAB);
    muralGarantirIds_(t);
    t.linhas.forEach(function (c) {
      if (c.Status === 'arquivado' || c.Status === 'feito') return;
      var pub = muralPublico_(c, '', hoje), quem = pub.para === 'Ambos' ? API_PESSOAS : [pub.para];
      // 1) cartão novo: avisa uma vez (fora do horário de silêncio, 22h–7h)
      if (c.Avisado !== 'sim' && !silencio) {
        quem.forEach(function (pe) { muralPush_(pe, { titulo: (pub.origem === 'Assistente' ? 'Resposta do assistente' : 'Novo no Mural · ' + pub.origem), corpo: pub.titulo + (pub.resumo ? ' — ' + pub.resumo : ''), url: '#mural/' + c.ID, tag: 'mural-' + c.ID }); });
        c.Avisado = 'sim'; muralGravar_(t, c, ['Avisado']);
      }
      // 2) tarefa com hora marcada: avisa na hora (ex.: "Hora de postar o cardápio")
      var dia = pub.adiadoAte && pub.adiadoAte > pub.prazo ? pub.adiadoAte : pub.prazo;
      if (dia === hoje && pub.hora && hm >= pub.hora && c.Lembrado !== 'sim' && !silencio) {
        quem.forEach(function (pe) { muralPush_(pe, { titulo: 'Agora: ' + pub.titulo, corpo: pub.tipo === 'post' || pub.tipo === 'cardapio' ? 'Imagem e legenda prontas no app. Toque para postar.' : (pub.resumo || 'Toque para ver o passo a passo.'), url: '#mural/' + c.ID, tag: 'hora-' + c.ID }); });
        c.Lembrado = 'sim'; muralGravar_(t, c, ['Lembrado']);
      }
    });
    // 3) pedidos ao assistente que não saíram: tenta de novo (até 3 vezes, com 10 min entre as tentativas);
    //    enviado e sem resposta em 40 minutos: marca como erro e avisa quem pediu
    var ps = muralLer_('PedidosAssistente', PEDAS_CAB);
    ps.linhas.forEach(function (p) {
      var ult = p.UltimaTentativa ? Date.parse(p.UltimaTentativa) : 0;
      if (p.Status === 'aberto' && Date.now() - ult > 10 * 60 * 1000 && (Number(p.Tentativas) || 0) < 3) muralDisparar_(p.ID);
      else if (p.Status === 'enviado' && p.Sessao === 'api' && ult && Date.now() - ult > 8 * 60 * 1000) {   // a execução caiu no meio: tenta de novo
        p.Status = (Number(p.Tentativas) || 0) < 3 ? 'aberto' : 'erro'; p.Erro = p.Status === 'erro' ? 'O assistente não conseguiu responder. Peça de novo ou fale com o Bruno.' : '';
        muralGravar_(ps, p, ['Status', 'Erro']);
      }
      else if (p.Status === 'enviado' && ult && Date.now() - ult > 40 * 60 * 1000) {
        p.Status = 'erro'; p.Erro = 'O assistente não respondeu em 40 minutos. Peça de novo ou fale com o Bruno.';
        muralGravar_(ps, p, ['Status', 'Erro']);
        if (!silencio) muralPush_(muralPara_(p.Pessoa), { titulo: 'O assistente não respondeu', corpo: String(p.Texto).slice(0, 80) + ' — peça de novo no Mural.', url: '#mural', tag: 'ped-' + p.ID });
      }
    });
    // (versão 10) o cartão da lista de produção de terça saiu: a sugestão de produção sai pelo Massa.gs (verificarMassa)
  } catch (e) { Logger.log('verificarMural: ' + (e.stack || e)); }
  finally { lock.releaseLock(); }
}

/* Envia para todos os aparelhos ativos da pessoa (o Mural é o canal principal; não depende dos tipos escolhidos no sino) */
function muralPush_(pessoa, msg) {
  if (typeof pushEnviar_ !== 'function' || typeof pushAba_ !== 'function') return 0;
  var sh = pushAba_(), n = sh.getLastRow() - 1, k = 0;
  if (n <= 0) return 0;
  sh.getRange(2, 1, n, 7).getValues().forEach(function (r) {
    if (String(r[6]) === 'sim' && String(r[1]) === pessoa && pushEnviar_(String(r[0]), msg).ok) k++;
  });
  return k;
}

/** Cria um cartão pelo próprio servidor (sugestão de produção, avisos do sistema). */
function muralNovo_(o) {
  var sh = muralAba_('Mural', MURAL_CAB), id = 'M' + Date.now() + Math.floor(Math.random() * 1000);
  sh.appendRow(MURAL_CAB.map(function (c) { return c === 'ID' ? id : c === 'CriadoEm' ? new Date().toISOString() : c === 'Status' ? 'novo' : (o[c] === undefined ? '' : String(o[c])); }));
  return id;
}

/** Rodar uma vez no editor: abas, gatilho de 5 em 5 minutos, e-mails diário e de terça desligados (o de domingo fica). */
function ativarMural() {
  muralAba_('Mural', MURAL_CAB); muralAba_('PedidosAssistente', PEDAS_CAB);
  var pasta = muralPasta_(true);
  var desligar = ['verificarMural', 'emailDiario', 'emailFechamento'], removidos = [];
  ScriptApp.getProjectTriggers().forEach(function (t) { var f = t.getHandlerFunction(); if (desligar.indexOf(f) >= 0) { ScriptApp.deleteTrigger(t); if (f !== 'verificarMural') removidos.push(f); } });
  ScriptApp.newTrigger('verificarMural').timeBased().everyMinutes(5).create();
  var cfg = muralAssistenteCfg_();
  if (!muralLer_('Mural', MURAL_CAB).linhas.length) muralNovo_({ Origem: 'Sistema', Para: 'Ambos', Tipo: 'aviso', Titulo: 'O Mural está no ar', Resumo: 'Recados dos agentes, tarefas de Instagram e o assistente, num lugar só',
    Corpo: 'Aqui chegam os recados dos agentes de Marketing, Gestão e Fechamento, as tarefas de Instagram com imagem e legenda prontas, e as respostas do assistente.\n\n- Toque num cartão para ver o passo a passo\n- **Feito** tira da lista; **Adiar** devolve na data escolhida\n- Em **Pedir**, escreva o que precisa: a resposta volta aqui em alguns minutos',
    Passos: 'Abrir a aba Arquivos e conferir o avatar novo\nFazer um pedido de teste ao assistente', Anexos: 'avatar' });
  var msg = 'Mural ativado. Gatilho de 5 em 5 minutos criado. Pasta de entrada dos agentes: ' + pasta.getName() + '.' + (removidos.length ? ' E-mails desligados: ' + removidos.join(', ') + ' (o de domingo continua).' : '') +
    (cfg.url && cfg.token ? ' Assistente configurado.' : ' Falta configurar o assistente (assistente_url e assistente_token na Config).');
  Logger.log(msg);
  return msg;
}
