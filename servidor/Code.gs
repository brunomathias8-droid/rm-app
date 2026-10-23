/**
 * RM — App de registro e notificações
 * Planilha: RM — Controle Operacional
 * Fuso: America/Fortaleza
 */
var SHEET_ID = '1Kt-ZopLPr2ITiy1u49iAdh48GNUCvgz0m5IpFGRPvFM';
var TZ = 'America/Fortaleza';
var WEEK1 = new Date(2026, 8, 28); // 28/09/2026
var CICLO_INICIO = '2026-10-19';
var PAUSA_INI = '2027-03-29', PAUSA_FIM = '2027-04-18';

var JANELAS = ['Qui 16-19h', 'Sex 8-11h', 'Motoboy', 'Horário combinado', 'Outro'];
var CANAIS = ['Base antiga', 'Indicação', 'Instagram', 'B2B', 'Assinatura', 'Outro'];

/* ---------------- Web app ----------------
 * 23/10/2026: o link /exec deixa de abrir o app antigo (que esperava o servidor a cada registro) e mostra um aviso com o
 * botão para o app novo, que salva no aparelho na hora. O app antigo continua em /exec?antigo=1, para emergência. */
var APP_NOVO_URL = 'https://brunomathias8-droid.github.io/rm-app/';
function linkApp_(url) { return !url || /script\.google(usercontent)?\.com/.test(String(url)) ? APP_NOVO_URL : String(url); }
function doGet(e) {
  if (!(e && e.parameter && e.parameter.antigo)) return paginaAppNovo_();
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('RM')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

/* Planilha, Config e Pedidos lidos uma vez por execução (antes cada leitura reabria a planilha: deixava o app lento).
   Quem grava em Pedidos chama pedidosAlterados_() para a próxima leitura vir da planilha. */
var SS_CACHE_ = null, CONFIG_CACHE_ = null, PEDIDOS_CACHE_ = null;
function paginaAppNovo_() {
  var u = APP_NOVO_URL;
  var html = '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>body{margin:0;background:#F4ECE2;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Nunito Sans",sans-serif;color:#231318;display:flex;min-height:100vh;align-items:center;justify-content:center}' +
    '.c{max-width:420px;margin:24px 16px;background:#FFFCF8;border-radius:20px;padding:28px 22px;box-shadow:0 2px 12px rgba(35,19,24,.08);text-align:center}' +
    'h1{font:28px/1.15 Georgia,serif;color:#4E1730;margin:0 0 10px}p{color:#6B5560;margin:0 0 14px}' +
    'a.b{display:block;background:#4E1730;color:#fff;text-decoration:none;font-weight:800;padding:15px;border-radius:14px;margin:18px 0 10px;font-size:17px}' +
    'ol{text-align:left;color:#6B5560;padding-left:20px;margin:6px 0 0;font-size:15px}small{display:block;color:#8C7A80;margin-top:14px;font-size:13px}</style></head><body><div class="c">' +
    '<h1>O app RM mudou de endereço</h1><p>Este link é do app antigo, que demorava para salvar. O app novo salva os pedidos na hora, mesmo sem internet.</p>' +
    '<a class="b" href="' + u + '" target="_top">Abrir o app novo</a>' +
    '<p style="margin:16px 0 4px;font-weight:700;color:#231318">No iPhone, para ficar na tela de início:</p><ol><li>Toque em "Abrir o app novo" (abre no Safari)</li><li>Compartilhar (quadrado com seta) › <b>Adicionar à Tela de Início</b></li><li>Apague o ícone antigo e use o novo</li></ol>' +
    '<small>Endereço: ' + u.replace(/^https:\/\//, '') + '</small></div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('RM: app novo').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function ss_() { return SS_CACHE_ || (SS_CACHE_ = SpreadsheetApp.openById(SHEET_ID)); }
function pedidosAlterados_() { PEDIDOS_CACHE_ = null; }
function sh_(name) { return ss_().getSheetByName(name); }
function fmt_(d, p) { return Utilities.formatDate(d, TZ, p || 'yyyy-MM-dd'); }
function today_() { return fmt_(new Date()); }
function parseD_(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v); }
function iso_(v) { return isDate_(v) ? fmt_(v) : (v ? String(v) : ''); }
function weekOf_(iso) { return Math.floor((parseD_(iso) - WEEK1) / 864e5 / 7) + 1; }
function weekStart_(iso) { var d = parseD_(iso); var w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return fmt_(d); }
function addDays_(iso, n) { var d = parseD_(iso); d.setDate(d.getDate() + n); return fmt_(d); }
function inPause_(iso) { return iso >= PAUSA_INI && iso <= PAUSA_FIM; }

function config_() {
  if (CONFIG_CACHE_) return CONFIG_CACHE_;
  var sh = sh_('Config'), out = {};
  if (!sh) return out;
  sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).getValues().forEach(function (r) {
    if (r[0]) out[String(r[0]).trim()] = r[1];
  });
  return (CONFIG_CACHE_ = out);
}

function checkPin_(pin) {
  var c = config_();
  if (!c.pin || String(pin) !== String(c.pin)) throw new Error('PIN inválido');
}

/* ---------------- Leitura para o app ---------------- */
function getBootstrap(pin) {
  checkPin_(pin);
  var fichas = sh_('Fichas técnicas').getRange(2, 1, 20, 2).getValues()
    .filter(function (r) { return r[0] && typeof r[1] === 'number' && String(r[0]).indexOf('Assinatura') !== 0; })
    .map(function (r) { return { nome: String(r[0]), preco: r[1] }; });
  var cli = sh_('Clientes');
  var clientes = cli.getLastRow() > 1 ? cli.getRange(2, 1, cli.getLastRow() - 1, 2).getValues()
    .filter(function (r) { return r[0]; }).map(function (r) { return { nome: String(r[0]), whats: String(r[1] || '') }; }) : [];
  var cfg = config_();
  return { produtos: fichas, clientes: clientes, janelas: JANELAS, canais: CANAIS, hoje: today_(), insumos: listaInsumos_(), categorias: CATEGORIAS, clube: clubeMapa_(), fornada: fornadaNum_(today_()),
    meses: MESES_FOCO, marcos: MARCOS, planoPdf: String(cfg.plano_pdf || PLANO_PDF_URL), ia: !!iaChave_(), msgs: mensagensMapa_(),
    pix: { chave: String(cfg.pix_chave || '').trim(), titular: String(cfg.pix_titular || '').trim() } };
}

/* Versão 10: lê também a coluna Tipo (Pronta-entrega ou Encomenda; vazio = pedido antigo = Encomenda), procurada pelo nome */
function colTipoPedido_(sh) {
  var lc = sh.getLastColumn(); if (lc < 16) return -1;
  return sh.getRange(1, 1, 1, lc).getValues()[0].map(function (c) { return String(c).trim(); }).indexOf('Tipo');
}
function readPedidos_() {
  if (PEDIDOS_CACHE_) return PEDIDOS_CACHE_.map(function (p) { return Object.assign({}, p); });   // cópia: quem lê pode mexer no objeto
  var sh = sh_('Pedidos'), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  var cT = colTipoPedido_(sh), nc = Math.max(15, cT + 1);
  var lista = sh.getRange(2, 1, n, nc).getValues().map(function (r, i) {
    var valor = Number(r[3]) || 0, repasse = Number(r[14]) || 0;
    return {
      row: i + 2, data: iso_(r[0]), cliente: String(r[1] || ''), itens: String(r[2] || ''), valor: valor,
      repasse: repasse, receita: Math.round((valor - repasse) * 100) / 100,   // valor = cobrado da cliente; receita = sem a taxa de entrega repassada
      canal: String(r[4] || ''), codigo: String(r[5] || ''), janela: String(r[6] || ''), retirada: iso_(r[7]),
      pix: String(r[8] || ''), assinatura: String(r[9] || ''), status: String(r[10] || ''), obs: String(r[11] || ''),
      id: String(r[12] || ''), tipo: tipoPedido_(cT >= 0 ? r[cT] : '')
    };
  }).filter(function (p) { return p.data || p.cliente; });
  PEDIDOS_CACHE_ = lista;
  return lista.map(function (p) { return Object.assign({}, p); });
}

function getPedidosAbertos(pin) {
  checkPin_(pin);
  // Em aberto + retirados com Pix pendente (o filtro "Pix pendente" de Pedidos mostra os dois)
  return readPedidos_().filter(function (p) {
    return p.status !== 'Cancelado' && (p.status !== 'Retirado' || p.pix !== 'Sim');
  }).sort(function (a, b) { return (a.retirada || '9999').localeCompare(b.retirada || '9999'); });
}

function getHoje(pin, pessoa) {
  checkPin_(pin);
  var hoje = today_();
  return { hoje: hoje, semana: weekOf_(hoje), fornada: fornadaNum_(hoje), clube: clubeDoDia_(hoje), tarefas: tarefasDe_(pessoa, hoje), resumo: resumoSemana_(hoje),
    retiradas: readPedidos_().filter(function (p) { return p.status !== 'Cancelado' && p.status !== 'Retirado' && p.retirada && p.retirada <= addDays_(hoje, 1); }),
    pixPendente: readPedidos_().filter(function (p) { return p.status !== 'Cancelado' && p.pix !== 'Sim'; }) };
}

function resumoSemana_(iso) {
  var ini = weekStart_(iso), fim = addDays_(ini, 6), w = weekOf_(iso);
  var ps = readPedidos_().filter(function (p) { return p.status !== 'Cancelado' && p.data >= ini && p.data <= fim; });
  var rec = ps.reduce(function (s, p) { return s + p.receita; }, 0);
  var meta = 0;
  if (w >= 1 && w <= 31) { meta = Number(sh_('Semanal').getRange(w + 1, 17).getValue()) || 0; }
  return { semana: w, inicio: ini, fim: fim, pedidos: ps.length, receita: rec, ticket: ps.length ? rec / ps.length : 0, meta: meta };
}

/* ---------------- Escrita ---------------- */
function salvarPedido(pin, p) {
  checkPin_(pin);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (!p.cliente) throw new Error('Informe o cliente');
    if (!p.itens) throw new Error('Escolha pelo menos um item');
    var tipo = validarTipoPedido_(p.tipo, 'Encomenda');   // o app antigo não manda Tipo: entra como Encomenda
    garantirCliente_(p.cliente, p.whats, p.canal);
    var sh = sh_('Pedidos');
    var id = 'P' + fmt_(new Date(), 'yyMMddHHmmss');
    var row = [parseD_(p.data || today_()), p.cliente, p.itens, Number(p.valor) || 0, p.canal || '', p.codigo || '',
      p.janela || '', p.retirada ? parseD_(p.retirada) : '', p.pix ? 'Sim' : 'Não', p.assinatura ? 'Sim' : 'Não',
      'Confirmado', p.obs || '', id, new Date(), Number(p.repasse) || ''];
    var clube = clubeNovoPedido_(p.cliente, p.data || today_());
    if (clube.mimo) row[11] = (row[11] ? row[11] + ' · ' : '') + CLUBE.nome + ': ' + clube.n + 'º pedido, incluir ' + CLUBE.mimo;
    var r = primeiraLinhaVazia_(sh);
    sh.getRange(r, 1, 1, row.length).setValues([row]);
    sh.getRange(r, 1).setNumberFormat('dd/mm/yyyy');
    sh.getRange(r, 8).setNumberFormat('dd/mm/yyyy');
    sh.getRange(r, 4).setNumberFormat('"R$" #,##0.00'); sh.getRange(r, 15).setNumberFormat('"R$" #,##0.00');
    var cT = colTipoPedido_(sh); if (cT >= 0) sh.getRange(r, cT + 1).setValue(tipo);
    pedidosAlterados_();
    return { ok: true, id: id, clube: clube };
  } finally { lock.releaseLock(); }
}

function primeiraLinhaVazia_(sh) {
  var n = Math.max(sh.getLastRow(), 1);
  var col = sh.getRange(1, 1, n + 1, 2).getValues();
  for (var i = 1; i < col.length; i++) if (!col[i][0] && !col[i][1]) return i + 1;
  return n + 1;
}

function garantirCliente_(nome, whats, canal) {
  var sh = sh_('Clientes');
  var n = sh.getLastRow();
  var nomes = n > 1 ? sh.getRange(2, 1, n - 1, 1).getValues().map(function (r) { return String(r[0]).trim().toLowerCase(); }) : [];
  var idx = nomes.indexOf(String(nome).trim().toLowerCase());
  if (idx >= 0) {
    if (whats && !sh.getRange(idx + 2, 2).getValue()) sh.getRange(idx + 2, 2).setValue(whats);
    return;
  }
  var r = primeiraLinhaVazia_(sh);
  var origem = canal === 'Base antiga' || canal === 'Indicação' || canal === 'Instagram' || canal === 'B2B' ? canal : 'Outro';
  sh.getRange(r, 1, 1, 7).setValues([[nome, whats || '', '', '', '', '', origem]]);
}

function atualizarPedido(pin, row, campo, valor) {
  checkPin_(pin);
  var col = { pix: 9, status: 11 }[campo];
  if (!col) throw new Error('Campo inválido');
  var ok = { pix: ['Sim', 'Não'], status: ['Confirmado', 'Produzido', 'Retirado', 'Cancelado'] }[campo];
  if (ok.indexOf(valor) < 0) throw new Error('Valor inválido: ' + valor);
  sh_('Pedidos').getRange(row, col).setValue(valor);
  pedidosAlterados_();
  return { ok: true };
}

function salvarSemana(pin, s) {
  checkPin_(pin);
  var w = Number(s.semana);
  if (!(w >= 1 && w <= 31)) throw new Error('Semana fora do plano (1 a 31)');
  var sh = sh_('Semanal');   // versão 10: a coluna de horas (E) fica sem uso
  sh.getRange(w + 1, 7, 1, 3).setValues([[num_(s.unidades), num_(s.sobra), num_(s.quebra)]]);
  if (s.notas) sh.getRange(w + 1, 18).setValue(s.notas);
  return { ok: true };
}
function num_(v) { return v === '' || v === null || v === undefined ? '' : Number(String(v).replace(',', '.')); }

function getSemana(pin, w) {
  checkPin_(pin);
  w = Number(w);
  var v = sh_('Semanal').getRange(w + 1, 1, 1, 18).getValues()[0];
  var ini = iso_(v[1]), fim = iso_(v[2]), producao = null;
  if (ini && fim && typeof producaoPeriodo_ === 'function') { try { producao = producaoPeriodo_(ini, fim); } catch (e) { Logger.log('produção na semana: ' + e.message); } }
  return { semana: w, inicio: ini, fim: fim, custo: v[5], unidades: v[6], sobra: v[7], quebra: v[8],
    receita: v[9], pedidos: v[10], meta: v[16], notas: v[17], producao: producao };
}

function marcarTarefa(pin, row, feita, acao) {
  checkPin_(pin);
  if (acao) return atualizarAcao(pin, row, feita ? 'Concluída' : 'Aberta');
  var sh = sh_('Tarefas');
  sh.getRange(row, 5, 1, 2).setValues([[feita ? 'Feita' : 'Pendente', feita ? new Date() : '']]);
  return { ok: true };
}

function novaTarefa(pin, t) {
  checkPin_(pin);
  var sh = sh_('Tarefas'), r = primeiraLinhaVazia_(sh);
  sh.getRange(r, 1, 1, 5).setValues([[parseD_(t.data || today_()), t.resp || 'Raquel', t.tarefa, weekOf_(t.data || today_()), 'Pendente']]);
  sh.getRange(r, 1).setNumberFormat('dd/mm/yyyy');
  if (t.porque) sh.getRange(r, 7).setValue(t.porque);
  return { ok: true };
}

/* ---------------- Tarefas ---------------- */
function tarefasDe_(pessoa, iso) {
  var sh = sh_('Tarefas'), n = sh.getLastRow() - 1, out = [];
  if (n > 0) {
    sh.getRange(2, 1, n, 7).getValues().forEach(function (r, i) {
      var d = iso_(r[0]); if (!d || !r[2]) return;
      var resp = String(r[1]);
      if (pessoa && resp !== pessoa && resp !== 'Ambos') return;
      var pend = String(r[4]) !== 'Feita';
      if (d === iso || (d < iso && pend)) out.push({ row: i + 2, data: d, resp: resp, tarefa: String(r[2]), feita: !pend, atrasada: d < iso, porque: porque_(r[2], r[6]) });
    });
  }
  acoesDe_(pessoa, iso).forEach(function (a) {
    out.push({ row: a.row, data: a.prazo, resp: a.resp, tarefa: 'Ação: ' + a.acao, feita: false, acao: true, atrasada: a.prazo < iso, problema: a.problema, indicador: a.indicador, impacto: a.impacto, origem: a.origem });
  });
  ciclo_(iso).forEach(function (c) {
    if (!pessoa || c.resp === pessoa || c.resp === 'Ambos') out.push({ row: 0, data: iso, resp: c.resp, tarefa: c.tarefa, feita: false, ciclo: true, porque: porqueRotina_(c.tarefa) });
  });
  return out.sort(function (a, b) { return (b.atrasada ? 1 : 0) - (a.atrasada ? 1 : 0); });
}

function ciclo_(iso) {
  if (iso < CICLO_INICIO || inPause_(iso)) {
    return iso < CICLO_INICIO ? [{ resp: 'Raquel', tarefa: 'Encomendas avulsas: registrar cada pedido no app assim que o Pix cair' }] : [];
  }
  var dow = parseD_(iso).getDay();
  var extra = addDays_(iso, 1).slice(8) === '01' ? [{ resp: 'Raquel', tarefa: 'Contar o estoque dos insumos marcados e a produção no congelador no app (+ › Contar o estoque)' }] : [];   // último dia do mês
  /* Versão 10 (22/10/2026): cookie de pronta-entrega com massa congelada; sem prazo de terça nem janelas fixas */
  var m = {
    1: [['Raquel', 'Conferir a produção (Hoje › Produção) e fazer a massa do que está abaixo do mínimo'], ['Raquel', 'Responder pedidos, confirmar Pix e registrar no app']],
    2: [['Raquel', 'Responder pedidos e registrar no app; bolo só com 2 dias de antecedência']],
    3: [['Raquel', 'Assar os cookies dos pedidos do dia e marcar como assado'], ['Raquel', 'Lembrete às clientes de encomenda que retiram amanhã']],
    4: [['Raquel', 'Assar os cookies dos pedidos do dia e marcar como assado'], ['Raquel', 'Lembrete às clientes de encomenda que retiram amanhã']],
    5: [['Raquel', 'Assar os cookies dos pedidos do dia; post de prova social'], ['Ambos', 'Reunião semanal de 15 min no app (Gestão → Reunião): números, massa, sobra, decisões e ações']],
    6: [['Raquel', 'Assar os cookies dos pedidos do dia'], ['Bruno', 'Aprovar as legendas do agente de Marketing'], ['Raquel', 'Mensagem pedindo foto às clientes da semana']]
  }[dow] || [];
  return m.map(function (x) { return { resp: x[0], tarefa: x[1] }; }).concat(extra);
}

/* ---------------- E-mails ---------------- */
function emailDiario() {
  var c = config_(), hoje = today_();
  if (hoje > '2027-05-02') return;
  var pessoas = [['Raquel', c.email_raquel], ['Bruno', c.email_bruno]];
  var peds = readPedidos_().filter(function (p) { return p.status !== 'Cancelado' && p.status !== 'Retirado'; });
  var retHoje = peds.filter(function (p) { return p.retirada === hoje; });
  var retAmanha = peds.filter(function (p) { return p.retirada === addDays_(hoje, 1) && p.tipo === 'Encomenda'; });   // pronta-entrega não leva lembrete
  var semPix = peds.filter(function (p) { return p.pix !== 'Sim'; });
  var res = resumoSemana_(hoje);
  pessoas.forEach(function (pp) {
    if (!pp[1]) return;
    var t = tarefasDe_(pp[0], hoje).filter(function (x) { return !x.feita; });
    var html = abreEmail_('Bom dia, ' + pp[0], fmt_(new Date(), "EEEE, dd/MM") + ' · semana ' + res.semana + ' do plano');
    html += secao_('Tarefas de hoje', t.map(function (x) { return (x.atrasada ? '<b style="color:#B00020">Atrasada (' + x.data.slice(8) + '/' + x.data.slice(5, 7) + ')</b> ' : '') + esc_(x.tarefa) + (x.resp === 'Ambos' ? ' <i>(os dois)</i>' : ''); }));
    html += secao_('Retiradas de hoje', retHoje.map(linhaPed_));
    html += secao_('Encomendas de amanhã (mandar lembrete)', retAmanha.map(linhaPed_));
    html += secao_('Pix pendente', semPix.map(linhaPed_));
    if (pp[0] === 'Bruno') {
      html += secao_('Semana até agora', ['Pedidos: ' + res.pedidos, 'Receita: ' + brl_(res.receita) + (res.meta ? ' de ' + brl_(res.meta) + ' (meta)' : ''), 'Ticket médio: ' + brl_(res.ticket)]);
    }
    var cl = clubeDoDia_(hoje);
    if (pp[0] === 'Raquel' && cl.frequentes.length) html += secao_(CLUBE.nome + ': reserva antecipada (mandar o cardápio às 18h)', cl.frequentes.map(function (f) { return esc_(f.nome) + ' — ' + f.n + ' pedidos'; }));
    html += fechaEmail_(linkApp_(c.app_url));
    enviarEmail_({ to: pp[1], subject: 'RM · Hoje: ' + t.length + ' tarefa(s), ' + retHoje.length + ' retirada(s)', htmlBody: html });
  });
}

/* Lista de produção de terça: saiu na versão 10 (a massa é congelada; a sugestão de produção vem do Massa.gs).
   A função fica para referência; atualizarV10 apaga o gatilho dela e o setup não o cria mais. */
function emailFechamento() {
  return;
  var c = config_(), hoje = today_();
  if (hoje < CICLO_INICIO || inPause_(hoje) || hoje > '2027-05-02') return;
  var ini = weekStart_(hoje);
  var ps = readPedidos_().filter(function (p) { return p.status !== 'Cancelado' && p.data >= ini; });
  var tot = {}, porJanela = {};
  ps.forEach(function (p) {
    p.itens.split(';').forEach(function (s) {
      var m = s.trim().match(/^(\d+)\s*x\s*(.+)$/i);
      var q = m ? +m[1] : 1, nome = (m ? m[2] : s).trim();
      if (!nome) return;
      tot[nome] = (tot[nome] || 0) + q;
      var j = p.janela || 'Sem janela';
      porJanela[j] = porJanela[j] || {}; porJanela[j][nome] = (porJanela[j][nome] || 0) + q;
    });
  });
  var html = abreEmail_('Lista de produção', 'Semana ' + weekOf_(hoje) + ' do plano · retirada quinta e sexta');
  var mimos = ps.filter(function (p) { return p.obs.indexOf(CLUBE.nome) >= 0; });
  html += secao_('Total a produzir', Object.keys(tot).map(function (k) { return tot[k] + ' × ' + esc_(k); }));
  Object.keys(porJanela).forEach(function (j) {
    html += secao_('Retirada: ' + esc_(j), Object.keys(porJanela[j]).map(function (k) { return porJanela[j][k] + ' × ' + esc_(k); }));
  });
  html += secao_('Sem Pix confirmado (não produzir)', ps.filter(function (p) { return p.pix !== 'Sim'; }).map(linhaPed_));
  var rec = ps.reduce(function (s, p) { return s + p.receita; }, 0);
  html += secao_(CLUBE.nome + ': mimos desta semana', mimos.map(function (p) { return esc_(p.cliente) + ' — ' + CLUBE.mimo; }));
  html += '<p style="font-size:15px">' + ps.length + ' pedidos · ' + brl_(rec) + ' · ticket médio ' + brl_(ps.length ? rec / ps.length : 0) + '</p>' + fechaEmail_(linkApp_(c.app_url));
  [c.email_raquel, c.email_bruno].filter(String).forEach(function (to) {
    enviarEmail_({ to: to, subject: 'RM · Lista de produção da semana ' + weekOf_(hoje), htmlBody: html });
  });
}

function secao_(t, itens) {
  if (!itens.length) return '';
  return '<h3 style="margin:20px 0 6px;font-family:Georgia,\'Times New Roman\',serif;font-weight:normal;font-size:20px;color:' + MARCA.vinho + '">' + t + '</h3><ul style="margin:0;padding-left:20px">' +
    itens.map(function (i) { return '<li style="margin:4px 0;line-height:1.4">' + i + '</li>'; }).join('') + '</ul>';
}
function linhaPed_(p) { return esc_(p.cliente) + ' — ' + esc_(p.itens) + ' — ' + brl_(p.valor) + (p.janela ? ' — ' + esc_(p.janela) : ''); }
function brl_(v) { return 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ','); }
function esc_(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

/* ---------------- Instalação (rodar uma vez) ---------------- */
function setup() {
  var ss = ss_();
  ss.setSpreadsheetTimeZone(TZ);
  var locOriginal = ss.getSpreadsheetLocale();
  if (locOriginal !== 'en_US') { ss.setSpreadsheetLocale('en_US'); SpreadsheetApp.flush(); }
  try { return setupInterno_(ss); }
  finally { if (locOriginal && locOriginal !== 'en_US') ss.setSpreadsheetLocale(locOriginal); }
}

function setupInterno_(ss) {
  // Config
  var cfg = ss.getSheetByName('Config') || ss.insertSheet('Config');
  if (cfg.getLastRow() < 2) {
    cfg.getRange(1, 1, 5, 3).setValues([
      ['Chave', 'Valor', 'Uso'],
      ['pin', '', 'PIN de 4 dígitos pedido no app. Troque aqui.'],
      ['email_raquel', '', 'E-mail que recebe as tarefas da Raquel (para dois endereços, separar por vírgula)'],
      ['email_bruno', Session.getEffectiveUser().getEmail(), 'E-mail que recebe as tarefas do Bruno'],
      ['app_url', '', 'Link do app (preencher após publicar)']
    ]);
    cfg.getRange(1, 1, 1, 3).setFontWeight('bold');
    cfg.setColumnWidth(1, 140); cfg.setColumnWidth(2, 320); cfg.setColumnWidth(3, 360);
  }
  garantirConfigPix_(cfg);
  // Pedidos: colunas ID e Registrado em + janela "Horário combinado"
  var ped = ss.getSheetByName('Pedidos');
  ped.getRange(1, 13, 1, 2).setValues([['ID', 'Registrado em']]).setFontWeight('bold').setBackground(MARCA.vinho).setFontColor('#FFFFFF');
  ped.getRange('G2:G801').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(JANELAS, true).setAllowInvalid(true).build());
  // Tarefas
  var tar = ss.getSheetByName('Tarefas');
  if (!tar) {
    tar = ss.insertSheet('Tarefas');
    tar.getRange(1, 1, 1, 6).setValues([['Data', 'Responsável', 'Tarefa', 'Semana', 'Status', 'Concluída em']])
      .setFontWeight('bold').setBackground(MARCA.vinho).setFontColor('#FFFFFF');
    var rows = TAREFAS_SEED.map(function (t) { return [parseD_(t[0]), t[1], t[2], weekOf_(t[0]), 'Pendente', '']; });
    tar.getRange(2, 1, rows.length, 6).setValues(rows);
    tar.getRange(2, 1, rows.length, 1).setNumberFormat('dd/mm/yyyy');
    tar.getRange('B2:B1000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Raquel', 'Bruno', 'Ambos'], true).build());
    tar.getRange('E2:E1000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Pendente', 'Feita'], true).build());
    tar.setColumnWidth(1, 90); tar.setColumnWidth(2, 100); tar.setColumnWidth(3, 520); tar.setFrozenRows(1);
  }
  // Meta de outubro (demanda avulsa já existe): registrar, sem meta de receita
  var men = ss.getSheetByName('Mensal');
  if (!men.getRange('U2').getValue()) men.getRange('U2').setValue('Out/26: vendas avulsas antes do ciclo. Meta do mês = 100% dos pedidos registrados.');
  // Leia-me
  var lm = ss.getSheetByName('Leia-me');
  lm.getRange('B4').setValue('Um registro por pedido, feito pelo app (botão Novo pedido). Não precisa abrir a planilha.');
  lm.getRange('B5').setValue('Sexta, na revisão de 15 min, pelo app (aba Semana): unidades, sobra e quebra.');
  lm.getRange('B7').setValue('Base de WhatsApp antiga + clientes novos. Cliente novo é criado automaticamente ao registrar pedido no app.');
  lm.getRange('A11:B11').setValues([['App', 'Link do app na aba Config. Tarefas na aba Tarefas; avisos no celular, Mural e painel da semana domingo 18h.']]);
  lm.getRange('A14:B17').setValues([['Custos', 'Insumos (preço de compra) + Receitas (quantidade por lote) calculam o custo em Fichas técnicas.'],
    ['Despesas', 'Toda compra e conta do negócio, lançada pelo app (+ → Nova despesa).'],
    ['DRE', 'Resultado mensal: receita, margem de contribuição, despesas fixas, pró-labore, ponto de equilíbrio, limite do MEI.'],
    ['Gestão', 'Reunioes (registro das reuniões) e Acoes (plano de ação), preenchidas pelo app na aba Gestão.']]);
  // Gatilhos
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('emailDiario').timeBased().everyDays(1).atHour(6).nearMinute(0).inTimezone(TZ).create();
  setupGestao_(ss);
  setupPainel_();
  atualizarPlano();
  return 'Instalação concluída';
}

function testeEmail() { emailDiario(); }

/* Chave Pix usada nas mensagens do WhatsApp (02/10/2026). Inclui as linhas na Config só se ainda não existirem. */
function garantirConfigPix_(cfg) {
  cfg = cfg || sh_('Config');
  var c = config_();
  if (!('pix_chave' in c)) cfg.appendRow(['pix_chave', '', 'Chave Pix que vai nas mensagens do WhatsApp quando o Pix está pendente. Trocar pela chave da conta PJ quando abrir.']);
  if (!('pix_titular' in c)) cfg.appendRow(['pix_titular', 'Raquel Miranda', 'Nome do titular da chave Pix, como aparece no app do banco de quem paga.']);
}

/* Tarefas datadas do plano (semanas 1 a 31). Ciclo semanal é gerado automaticamente a partir de 19/10. */
var TAREFAS_SEED = [
  ['2026-09-27', 'Bruno', 'Publicar o app, preencher e-mails na aba Config e instalar o atalho no iPhone da Raquel'],
  ['2026-09-28', 'Raquel', 'Cronometrar o próximo lote real (ou de teste) de bolo caseirinho médio, da compra à embalagem; anotar a quantidade de cada ingrediente e guardar notas de compra'],
  ['2026-09-28', 'Bruno', 'Agendar conversa com André sobre MEI (5 perguntas do plano)'],
  ['2026-09-29', 'Raquel', 'Cronometrar lote de cookies (caixa de 6); aproveitar pedido real se houver'],
  ['2026-09-29', 'Bruno', 'Levantar Maya Bolos (aba Concorrência): ticket, formato, entrega, posts, bio'],
  ['2026-09-30', 'Raquel', 'Cronometrar lote de pudim inteiro'],
  ['2026-09-30', 'Bruno', 'Levantar Brena Gourmand e Choko Brownie (aba Concorrência)'],
  ['2026-10-01', 'Raquel', 'Cronometrar bolo caseirinho pequeno'],
  ['2026-10-01', 'Bruno', 'Conversa com André: limite do MEI, licença sanitária, venda B2B'],
  ['2026-10-02', 'Ambos', 'Lançar tempos e custos na aba Fichas técnicas (30 min)'],
  ['2026-10-03', 'Bruno', 'Cadastrar preços na aba Insumos e as receitas dos 4 produtos na aba Receitas (custo e margem saem automáticos)'],
  ['2026-10-03', 'Ambos', 'Definir pró-labore mensal da Raquel e rateio de gás/energia (aba Config)'],
  ['2026-10-05', 'Ambos', 'Fechar a tabela de preços (custo real + concorrência)'],
  ['2026-10-06', 'Raquel', 'Definir cardápio-base (6 a 8 itens) e regra de rotação'],
  ['2026-10-07', 'Ambos', 'Abrir MEI e conta PJ'],
  ['2026-10-08', 'Ambos', 'Escolher embalagem; orçar rótulo e cartão de indicação com QR'],
  ['2026-10-09', 'Bruno', 'Encomendar embalagem, rótulo e cartão (entrega até 16/10)'],
  ['2026-10-09', 'Raquel', 'Fechar contato de motoboy parceiro'],
  ['2026-10-10', 'Ambos', 'Revisar rascunhos de bio, destaques, post de reabertura e mensagem de reativação'],
  ['2026-10-12', 'Bruno', 'Organizar a lista antiga de WhatsApp na aba Clientes'],
  ['2026-10-13', 'Raquel', 'Produzir os itens do cardápio-base para a sessão de fotos'],
  ['2026-10-14', 'Raquel', 'Sessão única de fotos e vídeos de processo'],
  ['2026-10-15', 'Bruno', 'Refazer perfil do Instagram (nome, bio, link, arquivar posts de festa, destaques); Raquel aprova'],
  ['2026-10-16', 'Ambos', 'Segmentar a base e escolher os 20 melhores clientes (lote 1)'],
  ['2026-10-16', 'Raquel', 'Avisar clientes com encomenda avulsa que, a partir de 19/10, pedidos seguem o cardápio da semana'],
  ['2026-10-17', 'Ambos', 'Checagem de prontidão: preço, embalagem, Pix PJ, cardápio e post prontos'],
  ['2026-10-18', 'Raquel', 'Publicar post de reabertura e o primeiro cardápio (até 18h)'],
  ['2026-10-19', 'Raquel', 'Mensagem individual aos 20 melhores clientes (lote 1)'],
  ['2026-10-24', 'Bruno', 'Registrar tudo da primeira semana do ciclo: tempo real, custo real, sobra e falta'],
  ['2026-10-26', 'Raquel', 'Semana 5: reativação lote 2; cartão de indicação em todo pedido'],
  ['2026-11-02', 'Raquel', 'Semana 6: reativação lote 3; caixa de cookies como item principal'],
  ['2026-11-06', 'Ambos', 'Revisão mensal de outubro (1h)'],
  ['2026-11-09', 'Ambos', 'Semana 7: concluir reativação; sessão de conteúdo de 4 semanas; decidir retirada de 20/11'],
  ['2026-11-16', 'Ambos', 'Semana 8: ajustar preço e porção; definir caixa de Natal; decidir pausa de réveillon'],
  ['2026-11-23', 'Ambos', 'Semana 9: lançar assinatura para clientes com 3+ pedidos; abrir encomendas de Natal'],
  ['2026-11-30', 'Bruno', 'Semana 10: abordar cafeteria 1 com amostra e pedido-teste'],
  ['2026-12-04', 'Ambos', 'Revisão mensal de novembro (1h)'],
  ['2026-12-07', 'Bruno', 'Semana 11: abordar cafeterias 2 e 3; avaliar sexta como dia de produção'],
  ['2026-12-14', 'Raquel', 'Semana 12: comprar insumo de Natal antecipado'],
  ['2026-12-21', 'Raquel', 'Semana de Natal: produção seg–qua, retiradas qua 23 e qui 24 de manhã'],
  ['2027-01-08', 'Ambos', 'Revisão mensal de dezembro (1h)'],
  ['2027-01-16', 'Ambos', 'Revisão trimestral (2h); ativar indicação rastreada (código + R$ 10)'],
  ['2027-01-18', 'Raquel', 'Aplicar cortes da revisão; pedido de foto após cada retirada'],
  ['2027-01-25', 'Raquel', 'Sessão de conteúdo para 4 semanas; convite de assinatura, 2ª onda'],
  ['2027-02-01', 'Bruno', 'Lista de 10 alvos B2B'],
  ['2027-02-05', 'Ambos', 'Revisão mensal de janeiro (1h)'],
  ['2027-02-08', 'Ambos', 'Carnaval: pedidos até segunda 08/02; definir caixa de Páscoa'],
  ['2027-02-15', 'Bruno', 'Fase 3: visitas B2B com amostra; orçar embalagem de Páscoa'],
  ['2027-02-22', 'Bruno', 'Decidir teste de mídia paga; teaser de Páscoa'],
  ['2027-03-01', 'Raquel', 'Abrir encomendas de Páscoa; comunicar pausa de 29/03 a 18/04'],
  ['2027-03-05', 'Ambos', 'Revisão mensal de fevereiro (1h)'],
  ['2027-03-08', 'Raquel', 'Comprar chocolate e embalagem de Páscoa'],
  ['2027-03-19', 'Ambos', 'Fechar encomendas de Páscoa; agendar posts da pausa'],
  ['2027-03-22', 'Raquel', 'Produção de Páscoa (22 a 25/03)'],
  ['2027-03-27', 'Ambos', 'Revisão trimestral (2h) e checagem da meta de 6 meses'],
  ['2027-04-18', 'Raquel', 'Cardápio de retomada (~50% do volume); abrir encomendas do Dia das Mães'],
  ['2027-05-01', 'Ambos', 'Plano de maio a setembro; revisão de março e abril']
];

/* ---------------- Identidade: RM Confeitaria Artesanal, por Raquel Miranda (nome trocado em 10/2026) ---------------- */
/* Marca final (03/10/2026): "RM Confeitaria do dia a dia", selo com o RM dentro do papel rendado, DM Serif Display + Nunito Sans,
   ameixa, rosa antigo, linho e ouro velho. Sem arco e sem carimbo numerado "Fornada nº". */
var MARCA = { nome: 'RM Confeitaria Artesanal', vinho: '#4E1730', rosa: '#E3B3BE', rosaAntigo: '#C98695', rosaClaro: '#F2E1E1', creme: '#F4ECE2', caramelo: '#7A5A1E', ouro: '#A57A2F', cacau: '#231318', sub: '#6B5560', linha: '#E3D6C8' };

/* Número da semana de produção desde 19/10 (uso interno; o carimbo "Fornada nº" saiu da marca em 03/10/2026). */
function fornadaNum_(iso) {
  if (!iso || iso < CICLO_INICIO || inPause_(iso)) return null;
  var n = Math.floor((parseD_(weekStart_(iso)) - parseD_(CICLO_INICIO)) / 864e5 / 7) + 1;
  if (iso > PAUSA_FIM) n -= 3;
  return n < 10 ? '0' + n : String(n);
}

/* Selo do cabeçalho dos e-mails: PNG embutido no próprio e-mail (o Gmail não mostra SVG nem fontes da web).
   A imagem (SELO_EMAIL_B64) fica no arquivo Selo.gs. */
function seloBlob_() { return Utilities.newBlob(Utilities.base64Decode(SELO_EMAIL_B64), 'image/png', 'rm-selo.png'); }
function marcaEmail_() { return '<img src="cid:rmselo" width="208" height="62" alt="RM Confeitaria Artesanal" style="display:block;border:0;width:208px;height:62px">'; }
/* Todo e-mail da RM passa por aqui: inclui o selo embutido e o nome do remetente. */
function enviarEmail_(opts) {
  opts.inlineImages = opts.inlineImages || {}; opts.inlineImages.rmselo = seloBlob_();
  opts.name = opts.name || MARCA.nome;
  MailApp.sendEmail(opts);
}

function abreEmail_(titulo, sub) {
  var M = MARCA;
  var h = '<div style="background:' + M.creme + ';padding:0;margin:0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:' + M.creme + ';font-family:Arial,Helvetica,sans-serif;color:' + M.cacau + '">';
  h += '<tr><td style="background:' + M.vinho + ';padding:20px 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td valign="middle">' + marcaEmail_() +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:25px;color:#fff;margin-top:16px">' + esc_(titulo) + '</div>' +
    '<div style="font-size:14px;color:' + M.rosa + ';margin-top:4px">' + esc_(sub) + '</div></td>' +
    '</tr></table></td></tr><tr><td style="padding:8px 22px 4px;font-size:15px;line-height:1.45">';
  return h;
}
function fechaEmail_(appUrl) {
  var M = MARCA;
  return (appUrl ? '<p style="margin:22px 0 6px"><a href="' + appUrl + '" style="background:' + M.vinho + ';color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold;display:inline-block">Abrir o app</a></p>' : '') +
    '</td></tr><tr><td style="padding:18px 22px 26px;font-size:12px;letter-spacing:2px;color:' + M.caramelo + ';font-weight:bold">RM CONFEITARIA ARTESANAL · POR RAQUEL MIRANDA</td></tr></table></div>';
}

/* ---------------- Clube da Raquel (aprovado em 26/09/2026) ----------------
 * Conta pedidos não cancelados desde 19/10/2026, por nome do cliente.
 * Mimo a cada 5º pedido; frequente = 3+ pedidos nos últimos 60 dias (reserva antecipada no sábado, a partir de 28/11). */
var CLUBE = { nome: 'Clube da Raquel', inicio: '2026-10-19', lancamento: '2026-11-23', mimoCada: 5, mimo: '2 cookies de mimo', freqN: 3, freqDias: 60 };

function clubeContagem_(ate) {
  var lim60 = addDays_(ate, -CLUBE.freqDias), out = {};
  readPedidos_().forEach(function (p) {
    if (p.status === 'Cancelado' || !p.cliente || !p.data || p.data < CLUBE.inicio || p.data > ate) return;
    var k = p.cliente.trim().toLowerCase();
    var o = out[k] = out[k] || { nome: p.cliente.trim(), n: 0, n60: 0, ultimo: '' };
    o.n++; if (p.data > lim60) o.n60++; if (p.data > o.ultimo) o.ultimo = p.data;
  });
  return out;
}
function clubeMapa_() {
  var c = clubeContagem_(today_()), m = {};
  Object.keys(c).forEach(function (k) { m[k] = { n: c[k].n, n60: c[k].n60 }; });
  return m;
}
/* Chamado ao salvar: n já inclui o pedido novo */
function clubeNovoPedido_(cliente, data) {
  if (!data || data < CLUBE.inicio) return { n: 0, mimo: false, frequente: false };
  var c = clubeContagem_(data)[String(cliente).trim().toLowerCase()] || { n: 0, n60: 0 };
  var n = c.n + 1, n60 = c.n60 + 1;
  return { n: n, mimo: n % CLUBE.mimoCada === 0, frequente: n60 >= CLUBE.freqN, convite: n60 === CLUBE.freqN };
}
/* Sábado, a partir do lançamento: lista de frequentes para a reserva antecipada */
function clubeDoDia_(hoje) {
  var out = { nome: CLUBE.nome, frequentes: [] };
  if (hoje < CLUBE.lancamento || parseD_(hoje).getDay() !== 6 || inPause_(hoje)) return out;
  var c = clubeContagem_(hoje), cli = {};
  var sh = sh_('Clientes');
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0]) cli[String(r[0]).trim().toLowerCase()] = String(r[1] || ''); });
  Object.keys(c).forEach(function (k) { if (c[k].n60 >= CLUBE.freqN) out.frequentes.push({ nome: c[k].nome, n: c[k].n, whats: cli[k] || '' }); });
  out.frequentes.sort(function (a, b) { return b.n - a.n; });
  out.fornada = fornadaNum_(addDays_(hoje, 2));
  return out;
}

/* Tarefas novas (marca e Clube) — incluídas uma vez, sem duplicar. Roda no setup e em atualizarPlano(). */
var TAREFAS_EXTRA = [
  ['2026-10-06', 'Bruno', 'Conferir "RM Confeitaria do dia a dia" no INPI e no Instagram (nome de exibição e @); arquivos finais da marca'],
  ['2026-10-08', 'Ambos', 'Orçar carimbo do selo RM (versão em uma cor) para caixa, nota e fita'],
  ['2026-10-10', 'Ambos', 'Aprovar as regras do Clube da Raquel (mimo a cada 5º pedido, reserva antecipada, convite de assinatura)'],
  ['2026-10-15', 'Bruno', 'Trocar avatar, nome e destaques do Instagram para a marca RM Confeitaria do dia a dia'],
  ['2026-11-23', 'Raquel', 'Lançar o Clube da Raquel junto com a assinatura: mensagem individual aos clientes com 3 ou mais pedidos'],
  ['2026-11-28', 'Raquel', 'Primeira reserva antecipada do Clube: mandar o cardápio aos frequentes às 18h (lista no app)'],
  ['2027-01-16', 'Ambos', 'Avaliar o Clube da Raquel na revisão trimestral: recompra, pedidos por cliente e custo dos mimos']
];
function atualizarPlano() {
  var sh = sh_('Tarefas'), n = sh.getLastRow() - 1;
  var ja = {};
  if (n > 0) sh.getRange(2, 3, n, 1).getValues().forEach(function (r) { ja[String(r[0]).trim()] = 1; });
  sh.getRange(1, 7).setValue('Por que é importante').setFontWeight('bold').setBackground(MARCA.vinho).setFontColor('#FFFFFF');
  var novas = TAREFAS_EXTRA.filter(function (t) { return !ja[t[2]]; });
  novas.forEach(function (t) {
    var r = primeiraLinhaVazia_(sh);
    sh.getRange(r, 1, 1, 5).setValues([[parseD_(t[0]), t[1], t[2], weekOf_(t[0]), 'Pendente']]);
    sh.getRange(r, 1).setNumberFormat('dd/mm/yyyy');
  });
  // preenche o "por que" das tarefas do plano que ainda não têm
  var n2 = sh.getLastRow() - 1, preench = 0;
  if (n2 > 0) {
    var v = sh.getRange(2, 3, n2, 5).getValues(), g = [];
    v.forEach(function (r) { var atual = String(r[4] || ''); var novo = atual || CONTEXTO[String(r[0]).trim()] || ''; if (novo && !atual) preench++; g.push([novo]); });
    sh.getRange(2, 7, n2, 1).setValues(g).setWrap(true);
    sh.setColumnWidth(7, 420);
  }
  return novas.length + ' tarefa(s) incluída(s) no plano; contexto preenchido em ' + preench + ' tarefa(s)';
}

/* ---------------- Contexto: por que cada tarefa do plano é importante (26/09/2026) ----------------
 * Gravado na coluna G da aba Tarefas por atualizarPlano(); pode ser editado pelo app ou na planilha.
 * Tarefa nova sem contexto: o app mostra o foco e a meta do mês e o próximo marco. */
var PLANO_PDF_URL = '';
var CONTEXTO = {
  'Publicar o app, preencher e-mails na aba Config e instalar o atalho no iPhone da Raquel': 'Sem o app no ar, as encomendas desta semana não entram nos números e os e-mails de tarefas não saem. É a base de todo o resto do plano.',
  'Cronometrar o próximo lote real (ou de teste) de bolo caseirinho médio, da compra à embalagem; anotar a quantidade de cada ingrediente e guardar notas de compra': 'O plano estima 1,9 bolo médio por hora, mas isso é premissa. O tempo real define a margem por hora, o número que decide preço e cardápio.',
  'Agendar conversa com André sobre MEI (5 perguntas do plano)': 'O limite do MEI e o imposto mudam quanto sobra por mês e quando a RM precisa virar ME. Precisa estar claro antes de abrir o MEI em 07/10.',
  'Cronometrar lote de cookies (caixa de 6); aproveitar pedido real se houver': 'O plano supõe que cookie rende o dobro por hora do bolo (cerca de R$ 126/h). Se for verdade, a caixa de cookies vira o motor de margem; se não, o cardápio muda.',
  'Levantar Maya Bolos (aba Concorrência): ticket, formato, entrega, posts, bio': 'Sem saber preço, formato e entrega das concorrentes, o preço da RM é chute. Esse levantamento calibra a tabela de preços de 05/10.',
  'Cronometrar lote de pudim inteiro': 'O pudim tem preço proposto de R$ 85 sem custo real medido. Tempo e custo dizem se ele entra fixo no cardápio.',
  'Levantar Brena Gourmand e Choko Brownie (aba Concorrência)': 'Completa o retrato do mercado local. Com três referências, dá para posicionar o preço 15% a 25% acima do bolo caseiro comum com segurança.',
  'Cronometrar bolo caseirinho pequeno': 'O pequeno é produto de entrada. Se a margem por hora for baixa (o plano estima cerca de R$ 50/h), ele fica no cardápio sem ser promovido.',
  'Conversa com André: limite do MEI, licença sanitária, venda B2B': 'Define o que pode ser vendido para cafeterias e com qual nota, e se a cozinha de casa precisa de licença. Evita problema quando o B2B começar em fevereiro.',
  'Lançar tempos e custos na aba Fichas técnicas (30 min)': 'Transforma a cronometragem em margem por hora de cada produto. Sem isso, a tabela de preços de 05/10 não tem base.',
  'Cadastrar preços na aba Insumos e as receitas dos 4 produtos na aba Receitas (custo e margem saem automáticos)': 'Com insumos e receitas cadastrados, o custo de cada produto sai sozinho e se atualiza a cada compra lançada. É a base do preço e do resultado do mês.',
  'Definir pró-labore mensal da Raquel e rateio de gás/energia (aba Config)': 'Sem pró-labore, o negócio parece dar mais lucro do que dá. Esse valor entra no resultado do mês e no ponto de equilíbrio.',
  'Fechar a tabela de preços (custo real + concorrência)': 'Preço errado não se corrige com volume. O plano pede preço 15% a 25% acima do bolo caseiro comum, sustentado pelo acabamento, e todo preço publicado.',
  'Definir cardápio-base (6 a 8 itens) e regra de rotação': 'Cardápio curto é o que permite produzir em lote na quarta e na quinta. A rotação (1 fixo, 2 que giram, 1 teste) traz novidade sem aumentar as horas.',
  'Abrir MEI e conta PJ': 'A conta PJ separa o dinheiro do negócio do da casa: é o único jeito de saber se a RM dá lucro. Todo Pix de cliente passa a cair nela.',
  'Escolher embalagem; orçar rótulo e cartão de indicação com QR': 'Embalagem padronizada faz parte do posicionamento de confeitaria. O cartão com QR é o mecanismo de indicação que começa a rodar em novembro.',
  'Encomendar embalagem, rótulo e cartão (entrega até 16/10)': 'Sem embalagem em mãos, a reabertura de 18/10 passa para 25/10: é um dos critérios da checagem de prontidão.',
  'Fechar contato de motoboy parceiro': 'A cliente contrata e paga o motoboy. Ter um contato de confiança para indicar tira essa dúvida do atendimento sem custar hora da Raquel.',
  'Revisar rascunhos de bio, destaques, post de reabertura e mensagem de reativação': 'São os primeiros textos que a base antiga vai ler. Com a marca nova, eles explicam a mudança antes de a cliente estranhar.',
  'Organizar a lista antiga de WhatsApp na aba Clientes': 'A base antiga é o ativo mais barato do negócio: gente que já comprou e já confia. A fase 1 inteira (25 a 40 clientes reativados) depende dessa lista.',
  'Produzir os itens do cardápio-base para a sessão de fotos': 'Foto própria e padronizada sustenta o preço acima da média. Uma sessão única rende conteúdo para semanas.',
  'Sessão única de fotos e vídeos de processo': 'Rende as fotos do cardápio e os vídeos do reel de quarta por várias semanas, sem parar a produção toda semana para fotografar.',
  'Refazer perfil do Instagram (nome, bio, link, arquivar posts de festa, destaques); Raquel aprova': 'Hoje o perfil promete bolo de festa, que a RM não faz mais. O perfil novo alinha a promessa ao cardápio da semana e à marca nova.',
  'Segmentar a base e escolher os 20 melhores clientes (lote 1)': 'Começar pelos 20 melhores traz as primeiras vendas com a menor chance de recusa e testa a mensagem antes de mandar para todos.',
  'Avisar clientes com encomenda avulsa que, a partir de 19/10, pedidos seguem o cardápio da semana': 'Evita que a cliente de sempre seja pega de surpresa pelo formato novo. Ela é a primeira a receber o cardápio.',
  'Checagem de prontidão: preço, embalagem, Pix PJ, cardápio e post prontos': 'Critério do plano: só reabre com preço fechado, embalagem em mãos e Pix PJ funcionando. Reabrir sem isso gera retrabalho e prejuízo.',
  'Publicar post de reabertura e o primeiro cardápio (até 18h)': 'É o marco que inicia o ciclo semanal e a contagem dos 30, 60 e 90 dias. Publicado até 18h, dá tempo de os pedidos entrarem até terça.',
  'Mensagem individual aos 20 melhores clientes (lote 1)': 'Mensagem individual converte muito mais que lista de transmissão, porque parece uma pessoa avisando outra. Meta da fase 1: 25 a 40 clientes reativados.',
  'Registrar tudo da primeira semana do ciclo: tempo real, custo real, sobra e falta': 'A primeira semana real confirma ou derruba as premissas de tempo e custo. É com esses dados que preço e porção são ajustados na semana 8.',
  'Semana 5: reativação lote 2; cartão de indicação em todo pedido': 'Continua a fase 1 com o próximo grupo da base. O cartão em todo pedido prepara a indicação rastreada de janeiro.',
  'Semana 6: reativação lote 3; caixa de cookies como item principal': 'Testa se a caixa de cookies vende como item principal, já que ela rende mais por hora que o bolo.',
  'Revisão mensal de outubro (1h)': 'Primeiro olhar de um mês inteiro: preço, produto que sai e produto que entra. As decisões viram ações com dono e prazo.',
  'Semana 7: concluir reativação; sessão de conteúdo de 4 semanas; decidir retirada de 20/11': 'Fecha a fase 1 com toda a base antiga contatada. O conteúdo pronto libera a Raquel para produzir no pico de dezembro.',
  'Semana 8: ajustar preço e porção; definir caixa de Natal; decidir pausa de réveillon': 'Com 4 semanas de dados reais, o ajuste de preço deixa de ser chute. Natal e réveillon pedem decisão cedo para comprar insumo e avisar as clientes.',
  'Semana 9: lançar assinatura para clientes com 3+ pedidos; abrir encomendas de Natal': 'A assinatura dá receita previsível e financia o insumo: 20 assinantes equivalem a R$ 5.000/mês. Abrir o Natal cedo organiza o pico do ano.',
  'Semana 10: abordar cafeteria 1 com amostra e pedido-teste': 'Um pedido fixo de cafeteria enche o lote sem esforço de venda toda semana. Duas ou três parcerias valem R$ 1.500 a 2.500/mês previsíveis.',
  'Revisão mensal de novembro (1h)': 'Confere o marco do dia 30 (R$ 1.500/mês, 15 clientes ativos) e decide o que muda para dezembro.',
  'Semana 11: abordar cafeterias 2 e 3; avaliar sexta como dia de produção': 'Mais parcerias B2B. Precisar da sexta para produzir é o primeiro sinal de que as 16h por semana estão chegando ao limite.',
  'Semana 12: comprar insumo de Natal antecipado': 'O preço do insumo sobe perto do Natal e falta produto. Comprar antes protege a margem da maior semana do ano.',
  'Semana de Natal: produção seg–qua, retiradas qua 23 e qui 24 de manhã': 'Semana de maior volume do ano. Produzir de segunda a quarta e entregar até quinta de manhã evita conflito com a véspera.',
  'Revisão mensal de dezembro (1h)': 'Fecha o melhor mês do ano e prepara a revisão de 90 dias.',
  'Revisão trimestral (2h); ativar indicação rastreada (código + R$ 10)': 'Revisão de 90 dias: o que vende mais, o que sai do cardápio, se as metas estão no caminho. A indicação vira mecanismo da fase 2 (meta: 30% dos pedidos por indicação).',
  'Aplicar cortes da revisão; pedido de foto após cada retirada': 'Tirar o que não vende libera horas para o que dá margem. Foto de cliente real gera mais confiança que foto profissional e custa só uma mensagem.',
  'Sessão de conteúdo para 4 semanas; convite de assinatura, 2ª onda': 'Conteúdo pronto evita parar a produção para postar. A segunda onda de assinatura mira quem virou frequente desde novembro (meta: 5 assinantes em janeiro).',
  'Lista de 10 alvos B2B': 'Começa a fase 3: cafeterias, coworkings, estúdios e empresas. Lista primeiro, visitas depois.',
  'Revisão mensal de janeiro (1h)': 'Confere o marco de R$ 4.000/mês e prepara as decisões de Páscoa e de mídia paga.',
  'Carnaval: pedidos até segunda 08/02; definir caixa de Páscoa': 'O Carnaval muda a rotina de quem compra; fechar os pedidos antes evita sobra. Definir a caixa de Páscoa cedo dá tempo de orçar a embalagem.',
  'Fase 3: visitas B2B com amostra; orçar embalagem de Páscoa': 'B2B não fecha por mensagem: precisa de amostra e tabela na mão. A embalagem de Páscoa tem prazo de gráfica.',
  'Decidir teste de mídia paga; teaser de Páscoa': 'Anúncio só se a reativação converteu. Teste de R$ 300 a 500 por mês; se cada pedido custar mais de R$ 25, o canal é desligado.',
  'Abrir encomendas de Páscoa; comunicar pausa de 29/03 a 18/04': 'A Páscoa é o segundo pico do ano. Avisar a pausa cedo evita perder assinantes e parceiros B2B durante a viagem.',
  'Revisão mensal de fevereiro (1h)': 'Confere o mês e ajusta a produção de Páscoa à capacidade.',
  'Comprar chocolate e embalagem de Páscoa': 'Chocolate é o insumo mais caro da Páscoa e sobe perto da data. Comprar com antecedência protege a margem.',
  'Fechar encomendas de Páscoa; agendar posts da pausa': 'Fechar no dia 19 dá o número exato para produzir sem sobra. Posts agendados mantêm o perfil ativo durante a viagem.',
  'Produção de Páscoa (22 a 25/03)': 'Última produção antes da pausa e a semana de maior receita do trimestre.',
  'Revisão trimestral (2h) e checagem da meta de 6 meses': 'Confere se a RM chegou a R$ 5.000/mês, a meta de 6 meses, e decide o crescimento depois da viagem.',
  'Cardápio de retomada (~50% do volume); abrir encomendas do Dia das Mães': 'Voltar com metade do volume evita sobra enquanto a base retorna. O Dia das Mães (09/05) é o próximo pico.',
  'Plano de maio a setembro; revisão de março e abril': 'Novo ciclo de 5 meses rumo aos R$ 10.000/mês em 12 meses, agora com os dados reais do semestre.',
  'Conferir "RM Confeitaria do dia a dia" no INPI e no Instagram (nome de exibição e @); arquivos finais da marca': 'Se o nome já tiver dono, a troca teria de ser refeita depois de etiqueta e perfil prontos. Conferir antes evita esse retrabalho.',
  'Orçar carimbo do selo RM (versão em uma cor) para caixa, nota e fita': 'Um carimbo do selo em uma cor marca caixa, nota e fita sem custo de impressão a cada lote. Mínimo de 1,5 cm para o RM continuar legível. Substitui o carimbo numerado, que saiu da marca em 03/10.',
  'Aprovar as regras do Clube da Raquel (mimo a cada 5º pedido, reserva antecipada, convite de assinatura)': 'O Clube premia quem volta sem dar desconto (custo estimado de cerca de 1% da receita). A Raquel precisa concordar com as regras antes de o app começar a avisar.',
  'Trocar avatar, nome e destaques do Instagram para a marca RM Confeitaria do dia a dia': 'O avatar é onde a cliente mais vê a marca. Trocar junto com o perfil novo mostra a mudança de uma vez, antes da reabertura.',
  'Lançar o Clube da Raquel junto com a assinatura: mensagem individual aos clientes com 3 ou mais pedidos': 'Recompensa quem já voltou e puxa a assinatura, que dá receita previsível. Meta de recompra: acima de 35%.',
  'Primeira reserva antecipada do Clube: mandar o cardápio aos frequentes às 18h (lista no app)': 'Deixar as frequentes reservarem primeiro não custa nada e faz o cardápio esgotar mais cedo, com menos sobra.',
  'Avaliar o Clube da Raquel na revisão trimestral: recompra, pedidos por cliente e custo dos mimos': 'Se a recompra não subir, o benefício troca. Decisão com dado, não com impressão.'
};
var MARCO_PORQUE = {
  '2026-10-18': 'Início do ciclo semanal. A partir daqui contam os marcos de 30, 60 e 90 dias.',
  '2026-11-18': 'Primeiro teste de que a reativação da base antiga converte em venda recorrente.',
  '2026-12-18': 'Com o Natal, mostra se a RM aguenta volume dentro das 16h semanais.',
  '2027-01-16': 'Ponto de decisão: o que sai do cardápio, o que fica e se as metas estão no caminho.',
  '2027-01-17': 'Marco de 90 dias: confirma se a indicação e a assinatura podem sustentar o crescimento.',
  '2027-03-27': 'Meta de 6 meses antecipada para março por causa da viagem.',
  '2027-03-29': 'Três semanas sem produção. Clientes, assinantes e parceiros precisam saber com antecedência.',
  '2027-04-19': 'Volta com cerca de 50% do volume para não sobrar produto enquanto a base retorna.'
};
function porque_(texto, colG) { return String(colG || '') || CONTEXTO[String(texto || '').trim()] || ''; }
function porqueRotina_(t) {
  var m = [[/Conferir a produção/i, 'Massa pronta no congelador é o que permite vender cookie na hora. Produzir antes de zerar evita perder venda; o app avisa quando um produto fica abaixo do mínimo de livres.'],
    [/Responder pedidos/i, 'Registrar no app é o que reserva a produção e alimenta os números. Encomenda só com Pix antecipado; pronta-entrega pode pagar na retirada.'],
    [/antecedência/i, 'O bolo é feito sob encomenda: com 2 dias de antecedência dá para comprar e produzir sem correria.'],
    [/Assar os cookies/i, 'O cookie sai do congelador e é assado no dia, sempre do lote mais antigo. Marcar como assado mostra o que já está pronto para retirar.'],
    [/Lembrete/i, 'Lembrar na véspera reduz esquecimento na retirada das encomendas.'],
    [/prova social/i, 'A prova social, com foto de cliente real, gera mais confiança que foto profissional.'],
    [/Reunião semanal/i, '15 minutos com os números da semana evitam decidir no escuro: receita, massa produzida e descartada, sobra e ações.'],
    [/legendas/i, 'O agente de Marketing prepara o rascunho; a aprovação garante preço certo e tom da marca.'],
    [/pedindo foto/i, 'Foto de cliente real é o conteúdo mais barato e mais convincente do perfil.'],
    [/Contar o estoque/i, 'A contagem mostra quanto dos insumos caros foi realmente usado no mês. A produção no congelador entra na conta, porque guarda chocolate e recheio que ainda não foram vendidos. Leva uns 10 minutos.'],
    [/Encomendas avulsas/i, 'A meta de outubro é 100% dos pedidos registrados. Sem registro, custo, margem e clientes ficam errados.']];
  for (var i = 0; i < m.length; i++) if (m[i][0].test(t)) return m[i][1];
  return '';
}
