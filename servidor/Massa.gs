/**
 * Massa.gs — massa de cookie congelada em bolinhas cruas, versão 10 do app (decisões 36 e 37, 22/10/2026).
 *
 * A Raquel faz a massa em lote, porciona em bolinhas e congela; assa conforme a venda. Aba Massa: um registro por
 * movimento (Produção = lote novo, Descarte, Ajuste). Nada fica gravado como saldo: tudo é calculado na leitura.
 *   vendido = soma de (quantidade × "Bolinhas por unidade vendida" da ficha) nos pedidos não cancelados com data a
 *             partir do primeiro lote do sabor. A massa sai quando o pedido é registrado (fica reservada); pedido
 *             cancelado devolve; pedido editado recalcula.
 *   saldo   = produzido − descartado + ajuste − vendido
 *   lotes   = baixa pelo lote mais antigo (FIFO calculado na leitura)
 * Caixas e kits (nome começa com Caixa, Kit ou Assinatura) não baixam de um sabor pelo nome: baixam dos sabores
 * escolhidos no app, gravados na Observação numa linha "Sabores: 3x Cookie de Nutella; 3x Cookie de Kinder Bueno".
 * Sem essa linha, o pedido entra no aviso "itens com massa sem sabor definido" e não baixa estoque.
 *
 * Instalação: colar este arquivo, rodar atualizarV10() uma vez e publicar uma nova versão.
 */
var MASSA_CAB = ['ID', 'Data', 'Tipo', 'Produto', 'Unidades', 'Validade', 'Motivo', 'Observação', 'Registrado por', 'Registrado em'];
var MASSA_TIPOS = ['Produção', 'Descarte', 'Ajuste'];
var MASSA_MOTIVOS = ['Vencido', 'Qualidade', 'Contagem', 'Outro'];
var MASSA_COL_FICHA = 'Bolinhas por unidade vendida';
var MASSA_KIT_RE = /^(caixa|kit|assinatura)\b/i;
var MASSA_SABORES_RE = /(^|\n)\s*Sabores:\s*([^\n]*)/i;
var PEDIDO_TIPOS = ['Pronta-entrega', 'Encomenda'];
var MASSA_CONFIG = [
  ['estoque_minimo_massa', 12, 'Bolinhas de massa por sabor. Abaixo disso o app avisa e a sugestão de produção de segunda sai.'],
  ['validade_massa_dias', 90, 'Validade padrão da massa congelada, em dias a partir da data do lote.'],
  ['alerta_lote_dias', 75, 'Idade do lote (dias) a partir da qual o app avisa que está perto de vencer.'],
  ['antecedencia_bolo_dias', 2, 'Antecedência mínima, em dias, das encomendas (bolo caseirinho). Só avisa, não bloqueia.']
];

/* ------------------------------ funções chamadas pelo app (PIN como 1º argumento) ------------------------------ */

function lerEstoqueMassa(pin) {
  massaPin_(pin);
  return estoqueMassa_();
}

/** dados = { tipo, produto, unidades, data, validade, motivo, obs, pessoa }. Devolve { id, estoque } (id para o Desfazer). */
function registrarMassa(pin, dados) {
  massaPin_(pin);
  var r = massaValidar_(dados || {}, massaFichas_(), massaCfg_(), today_());
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  var id;
  try {
    id = 'M' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMddHHmmss') + Math.floor(Math.random() * 90 + 10);
    massaAba_().appendRow([id, r.data, r.tipo, r.produto, r.unidades, r.validade, r.motivo, r.obs, r.pessoa,
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')]);
  } finally { lock.releaseLock(); }
  return { id: id, estoque: estoqueMassa_() };
}

/** Desfaz um registro da aba Massa (só o que foi criado pelo app; a linha some porque foi um engano). */
function desfazerMassa(pin, id) {
  massaPin_(pin);
  id = String(id || '').trim();
  if (!/^M\d{12,16}$/.test(id)) throw new Error('Registro inválido.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = massaAba_(), n = sh.getLastRow() - 1, achou = false;
    if (n > 0) {
      var ids = sh.getRange(2, 1, n, 1).getValues();
      for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === id) { sh.deleteRow(i + 2); achou = true; break; }
    }
    if (!achou) throw new Error('Registro não encontrado (já desfeito?).');
  } finally { lock.releaseLock(); }
  return { estoque: estoqueMassa_() };
}

/* ------------------------------ leitura ------------------------------ */

function estoqueMassa_(hoje) {
  hoje = hoje || today_();
  var cfg = massaCfg_();
  return massaCalcular_({ movs: massaMovs_(), pedidos: massaPedidos_(), fichas: massaFichas_(), cfg: cfg, hoje: hoje });
}

/**
 * Cálculo puro (sem planilha), usado pelo servidor e pelos testes.
 * d = { movs: [{id,data,tipo,produto,unidades,validade,motivo}], pedidos: [{data,itens,obs,status,id}],
 *       fichas: { chave: {nome,bpu,kit} }, cfg: {minimo,alertaDias,validadeDias}, hoje }
 */
function massaCalcular_(d) {
  var hoje = d.hoje, cfg = d.cfg, F = d.fichas, S = {}, avisos = [];
  var sabor = function (nome) {
    var k = massaChave_(nome), f = F[k];
    return S[k] || (S[k] = { produto: f ? f.nome : String(nome).trim(), produzido: 0, descartado: 0, ajuste: 0, vendido: 0, vendido28: 0,
      primeiroLote: '', ultimoLote: '', lotesTodos: [], cadastrado: !!(f && f.bpu > 0 && !f.kit) });
  };
  // sabores com massa (ficha com bolinhas > 0, sem caixas e kits) aparecem mesmo sem lote
  Object.keys(F).forEach(function (k) { if (F[k].bpu > 0 && !F[k].kit) sabor(F[k].nome); });

  d.movs.forEach(function (m) {
    if (!m.produto || MASSA_TIPOS.indexOf(m.tipo) < 0) return;
    var s = sabor(m.produto), u = Number(m.unidades) || 0;
    if (m.tipo === 'Produção') {
      s.produzido += u;
      s.lotesTodos.push({ id: m.id, data: m.data, validade: m.validade || massaAddDias_(m.data, cfg.validadeDias), unidades: u });
      if (!s.primeiroLote || m.data < s.primeiroLote) s.primeiroLote = m.data;
      if (!s.ultimoLote || m.data > s.ultimoLote) s.ultimoLote = m.data;
    } else if (m.tipo === 'Descarte') s.descartado += u;
    else s.ajuste += u;
  });

  var lim28 = massaAddDias_(hoje, -28), semSabor = [];
  d.pedidos.forEach(function (p) {
    if (p.status === 'Cancelado' || !p.data) return;
    massaItensDoPedido_(p.itens, p.obs, F).forEach(function (it) {
      if (it.semSabor) { semSabor.push({ id: p.id, data: p.data, item: it.nome, q: it.q }); return; }
      var s = S[massaChave_(it.nome)];
      if (!s || !s.primeiroLote || p.data < s.primeiroLote) return;   // pedido anterior ao primeiro lote não baixa
      s.vendido += it.bolinhas;
      if (p.data >= lim28 && p.data <= hoje) s.vendido28 += it.bolinhas;
    });
  });
  // só interessam os pedidos sem sabor a partir do primeiro lote de qualquer sabor
  var ini = Object.keys(S).map(function (k) { return S[k].primeiroLote; }).filter(String).sort()[0] || '';
  semSabor = ini ? semSabor.filter(function (x) { return x.data >= ini; }) : [];

  var sabores = Object.keys(S).map(function (k) {
    var s = S[k];
    s.saldo = s.produzido - s.descartado + s.ajuste - s.vendido;
    // FIFO: o que saiu (vendido + descartado − ajuste) baixa do lote mais antigo
    var lotes = s.lotesTodos.slice().sort(function (a, b) { return a.data < b.data ? -1 : a.data > b.data ? 1 : String(a.id) < String(b.id) ? -1 : 1; });
    var sai = s.vendido + s.descartado - s.ajuste;
    lotes.forEach(function (l) { var t = Math.max(0, Math.min(l.unidades, sai)); l.saldo = l.unidades - t; sai -= t; });
    if (sai < 0 && lotes.length) lotes[lotes.length - 1].saldo += -sai;   // ajuste para cima além do registrado: vai para o lote mais novo
    s.lotes = lotes.filter(function (l) { return l.saldo > 0; }).map(function (l) {
      var idade = massaDias_(l.data, hoje);
      return { id: l.id, data: l.data, validade: l.validade, idade: idade, saldo: l.saldo, vencido: !!l.validade && l.validade < hoje, perto: idade >= cfg.alertaDias };
    });
    delete s.lotesTodos;
    s.mediaDia = s.vendido28 / 28;
    s.diasEstoque = s.vendido28 > 0 ? Math.max(0, Math.floor(s.saldo / s.mediaDia)) : null;
    s.alertas = [];
    if (s.saldo < 0) s.alertas.push({ tipo: 'negativo', texto: 'Saldo negativo (' + s.saldo + '): registre o lote ou um ajuste' });
    else if (s.saldo === 0 && (s.produzido || s.vendido)) s.alertas.push({ tipo: 'zerado', texto: 'Sem massa' });
    else if (s.saldo < cfg.minimo && (s.produzido || s.cadastrado)) s.alertas.push({ tipo: 'baixo', texto: 'Abaixo do mínimo de ' + cfg.minimo });
    s.lotes.forEach(function (l) {
      if (l.vencido) s.alertas.push({ tipo: 'vencido', texto: 'Lote de ' + massaDm_(l.data) + ' vencido (' + l.saldo + ' bolinhas)', lote: l.id });
      else if (l.perto) s.alertas.push({ tipo: 'lote', texto: 'Lote de ' + massaDm_(l.data) + ' com ' + l.idade + ' dias', lote: l.id });
    });
    return s;
  }).filter(function (s) { return s.cadastrado || s.produzido || s.descartado || s.ajuste || s.vendido; })
    .sort(function (a, b) { return a.produto.localeCompare(b.produto); });

  if (semSabor.length) avisos.push({ tipo: 'semSabor', texto: semSabor.length + ' ' + (semSabor.length === 1 ? 'item' : 'itens') + ' com massa sem sabor definido (caixa sem a linha "Sabores:"): não baixaram estoque', pedidos: semSabor.slice(0, 20) });
  var total = sabores.reduce(function (a, s) { return a + s.saldo; }, 0);
  var fichas = Object.keys(F).filter(function (k) { return F[k].bpu > 0; }).map(function (k) { return { nome: F[k].nome, bpu: F[k].bpu, kit: F[k].kit }; });
  return { hoje: hoje, sabores: sabores, total: total, avisos: avisos, cfg: cfg, fichas: fichas,
    alertas: sabores.reduce(function (a, s) { return a + s.alertas.length; }, 0) };
}

/** Itens do pedido que usam massa: [{ nome (sabor), q, bolinhas }] ou { semSabor: true } para caixa sem sabores escolhidos. */
function massaItensDoPedido_(itensTxt, obs, F) {
  var out = [], sab = String(obs || '').match(MASSA_SABORES_RE), saboresUsados = false;
  massaLerItens_(itensTxt).forEach(function (it) {
    var f = F[massaChave_(it.nome)];
    if (!f || !(f.bpu > 0)) return;
    if (f.kit) { if (sab) saboresUsados = true; else out.push({ nome: it.nome, q: it.q, semSabor: true }); return; }
    out.push({ nome: f.nome, q: it.q, bolinhas: it.q * f.bpu });
  });
  if (saboresUsados) massaLerItens_(sab[2]).forEach(function (it) {
    var f = F[massaChave_(it.nome)];
    if (f && f.bpu > 0 && !f.kit) out.push({ nome: f.nome, q: it.q, bolinhas: it.q * f.bpu });
  });
  return out;
}

function massaLerItens_(txt) {
  return String(txt || '').split(';').map(function (s) {
    s = s.trim(); if (!s) return null;
    var m = s.match(/^(\d+)\s*x\s*(.+)$/i);
    return { q: m ? +m[1] : 1, nome: (m ? m[2] : s).trim() };
  }).filter(Boolean);
}

/** Bolinhas produzidas e descartadas por sabor entre ini e fim (datas yyyy-MM-dd, inclusive). */
function massaPeriodo_(ini, fim, movs) {
  var o = { produzido: 0, descartado: 0, ajuste: 0, porSabor: {} };
  (movs || massaMovs_()).forEach(function (m) {
    if (!m.data || m.data < ini || m.data > fim) return;
    var s = o.porSabor[m.produto] || (o.porSabor[m.produto] = { produzido: 0, descartado: 0 });
    if (m.tipo === 'Produção') { o.produzido += m.unidades; s.produzido += m.unidades; }
    else if (m.tipo === 'Descarte') { o.descartado += m.unidades; s.descartado += m.unidades; }
    else if (m.tipo === 'Ajuste') o.ajuste += m.unidades;
  });
  o.perda = o.produzido ? o.descartado / o.produzido : null;
  return o;
}

/** Margem de contribuição por produto (preço − custo total por unidade da ficha), da maior para a menor. */
function margemPorProduto_() {
  var sh = sh_('Fichas técnicas'), n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  var cab = massaCab_(sh), v = sh.getRange(2, 1, n, cab.length).getValues();
  var cN = cab.indexOf('Produto'), cP = massaColIni_(cab, 'Preço'), cC = massaColIni_(cab, 'Custo total por unidade');
  if (cN < 0 || cP < 0 || cC < 0) return [];
  return v.map(function (r) {
    var nome = String(r[cN] || '').trim(), preco = Number(r[cP]), custo = r[cC];
    if (!nome || !(preco > 0) || custo === '' || custo === null || isNaN(Number(custo))) return null;
    custo = Number(custo);
    return { nome: nome, preco: preco, custo: custo, margem: Math.round((preco - custo) * 100) / 100, pct: (preco - custo) / preco };
  }).filter(Boolean).sort(function (a, b) { return b.margem - a.margem; });
}

/* ------------------------------ contagem do fim do mês (massa guarda insumos contados) ------------------------------ */

/**
 * Quantidade de cada insumo contido em uma bolinha de cada sabor, pela aba Receitas:
 * quantidade do insumo no lote ÷ (unidades por lote da ficha × bolinhas por unidade vendida).
 * Devolve { porSabor: { chaveSabor: { chaveInsumo: q } }, avisos: [...] }. Produto componente na receita é aberto.
 */
function massaInsumosPorBolinha_() {
  var F = massaFichas_(), rec = {}, avisos = [];
  var sh = sh_('Receitas'), n = sh ? sh.getLastRow() - 1 : 0;
  if (n > 0) sh.getRange(2, 1, n, 3).getValues().forEach(function (r) {
    var p = massaChave_(r[0]), ins = String(r[1] || '').trim(), q = Number(r[2]);
    if (!p || !ins || !(q > 0)) return;
    (rec[p] = rec[p] || []).push({ insumo: ins, q: q });
  });
  var abrir = function (prod, fator, acc, prof) {
    (rec[prod] || []).forEach(function (l) {
      var k = massaChave_(l.insumo), fc = F[k];
      if (rec[k] && prof < 3) { var ul = fc && fc.unidadesLote > 0 ? fc.unidadesLote : 1; abrir(k, fator * l.q / ul, acc, prof + 1); }
      else acc[k] = (acc[k] || 0) + l.q * fator;
    });
  };
  var porSabor = {};
  Object.keys(F).forEach(function (k) {
    var f = F[k];
    if (!(f.bpu > 0) || f.kit) return;
    if (!rec[k]) { avisos.push(f.nome + ': sem receita na aba Receitas; a massa guardada deste sabor não entra no estoque dos insumos'); return; }
    if (!(f.unidadesLote > 0)) { avisos.push(f.nome + ': falta "Unidades por lote" na ficha; a massa guardada deste sabor não entra no estoque dos insumos'); return; }
    var acc = {};
    abrir(k, 1 / (f.unidadesLote * f.bpu), acc, 0);
    porSabor[k] = acc;
  });
  return { porSabor: porSabor, avisos: avisos };
}

/** Insumos contidos na massa: { chaveInsumo: quantidade } para bolinhas = { nome do sabor: n }. */
function massaInsumosGuardados_(bolinhas, porBolinha) {
  var pb = porBolinha || massaInsumosPorBolinha_(), out = {};
  Object.keys(bolinhas || {}).forEach(function (nome) {
    var b = Number(bolinhas[nome]) || 0, m = pb.porSabor[massaChave_(nome)];
    if (!b || !m) return;
    Object.keys(m).forEach(function (ins) { out[ins] = (out[ins] || 0) + b * m[ins]; });
  });
  return out;
}

/* ------------------------------ avisos (gatilho de hora em hora criado por atualizarV10) ------------------------------ */

/**
 * Segunda às 7h: sugestão de produção, só com sabor abaixo do mínimo ou zerado (cartão no Mural para a Raquel + aviso "producao").
 * Todo dia às 9h: lote perto de vencer (cartão com a chave do lote, não duplica) + aviso para a Raquel.
 * Silêncio das 22h às 7h respeitado.
 */
function verificarMassa() {
  var hoje = today_(), hora = Number(fmt_(new Date(), 'H')), dow = parseD_(hoje).getDay();
  if (hora >= 22 || hora < 7) return;
  var lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) return;
  try {
    var est = estoqueMassa_(hoje);
    if (dow === 1 && hora >= 7) massaSugestao_(est, hoje);
    if (hora >= 9) massaLotesVencendo_(est, hoje);
  } catch (e) { Logger.log('verificarMassa: ' + (e.stack || e)); }
  finally { lock.releaseLock(); }
}

/** Sabores abaixo do mínimo (inclui zerados e negativos), do menor saldo para o maior. */
function massaBaixos_(est) {
  return est.sabores.filter(function (s) { return s.saldo < est.cfg.minimo; }).sort(function (a, b) { return a.saldo - b.saldo; });
}
function massaBaixosTxt_(est) {
  return massaBaixos_(est).map(function (s) { return massaSabor_(s.produto) + ' ' + Math.max(0, s.saldo); }).join(', ');
}

function massaSugestao_(est, hoje, semAviso) {
  var baixos = massaBaixos_(est);
  if (!baixos.length) return false;
  var chave = 'massa-sugestao-' + hoje;
  if (massaCartaoExiste_(chave)) return false;
  var txt = massaBaixosTxt_(est);
  muralNovo_({ Origem: 'Sistema', Para: 'Raquel', Tipo: 'tarefa', Titulo: 'Massa baixa: ' + txt,
    Resumo: 'Sugestão de produção da semana (mínimo de ' + est.cfg.minimo + ' bolinhas por sabor)',
    Corpo: '**Abaixo do mínimo**\n' + baixos.map(function (s) {
      var falta = Math.max(0, est.cfg.minimo - s.saldo);
      return '- ' + s.produto + ': ' + s.saldo + ' bolinha' + (Math.abs(s.saldo) === 1 ? '' : 's') + (s.diasEstoque !== null ? ' (dá para ' + s.diasEstoque + ' dia' + (s.diasEstoque === 1 ? '' : 's') + ')' : '') + ' · faltam ' + falta + ' para o mínimo';
    }).join('\n'),
    Passos: 'Conferir o congelador\nFazer a massa dos sabores da lista\nRegistrar no app: + › Produzir massa',
    Prazo: hoje, Chave: chave });
  if (!semAviso && typeof pushAvisar_ === 'function' && typeof pushStatus_ === 'function' && pushStatus_().ativo)
    pushAvisar_('Raquel', 'producao', { titulo: 'Massa baixa', corpo: txt + '. Sugestão de produção no Mural.', url: '#hoje', tag: 'producao' });
  return true;
}

function massaLotesVencendo_(est, hoje, semAviso) {
  var n = 0;
  est.sabores.forEach(function (s) {
    s.lotes.forEach(function (l) {
      if (!l.perto && !l.vencido) return;
      var chave = 'massa-lote-' + l.id;
      if (massaCartaoExiste_(chave)) return;
      muralNovo_({ Origem: 'Sistema', Para: 'Raquel', Tipo: 'aviso', Titulo: (l.vencido ? 'Lote vencido: ' : 'Lote perto de vencer: ') + s.produto,
        Resumo: l.saldo + ' bolinhas do lote de ' + massaDm_(l.data) + ' (' + l.idade + ' dias, validade ' + massaDm_(l.validade) + ')',
        Corpo: 'Asse e venda este lote primeiro' + (l.vencido ? ', ou descarte o que passou da validade.' : '.') + '\n\n- Descartar: Hoje › Massa no congelador › ' + s.produto + ' › Descartar',
        Prazo: hoje, Chave: chave });
      if (!semAviso && typeof pushAvisar_ === 'function' && typeof pushStatus_ === 'function' && pushStatus_().ativo)
        pushAvisar_('Raquel', 'producao', { titulo: (l.vencido ? 'Lote vencido: ' : 'Lote perto de vencer: ') + massaSabor_(s.produto), corpo: l.saldo + ' bolinhas do lote de ' + massaDm_(l.data) + '. Asse este primeiro.', url: '#hoje', tag: 'lote-' + l.id });
      n++;
    });
  });
  return n;
}

/* Mesma chave = mesmo cartão (a chave fica na coluna Chave do Mural, inclusive nos arquivados) */
function massaCartaoExiste_(chave) {
  return muralLer_('Mural', MURAL_CAB).linhas.some(function (c) { return c.Chave === chave; });
}

/* ------------------------------ migração ------------------------------ */

/**
 * Rodar uma vez no editor depois de colar os arquivos da versão 10. Pode rodar de novo: não duplica nada.
 * Cria a aba Massa, a coluna Tipo em Pedidos, a coluna de bolinhas nas Fichas técnicas, as chaves da Config e a
 * coluna Tipo no Estoque; oculta as linhas de horas da DRE; troca os gatilhos (sai a lista de produção de terça,
 * entra verificarMassa de hora em hora).
 */
function atualizarV10() {
  var log = [];
  // 1. aba Massa
  if (!sh_('Massa')) { massaAba_(); log.push('Aba Massa criada.'); } else log.push('Aba Massa já existia.');
  // 2. Pedidos › Tipo (pedidos antigos ficam vazios e são lidos como Encomenda)
  var ped = sh_('Pedidos'), cp = massaCab_(ped);
  if (cp.indexOf('Tipo') < 0) {
    var iRep = cp.indexOf('Repasse (R$)');
    if (iRep < 0) throw new Error('Aba Pedidos sem a coluna "Repasse (R$)". Confira a estrutura antes de rodar.');
    var col = cp.length + 1;
    for (var i = iRep + 1; i < cp.length; i++) if (!cp[i]) { col = i + 1; break; }
    if (col > ped.getMaxColumns()) ped.insertColumnsAfter(ped.getMaxColumns(), col - ped.getMaxColumns());
    ped.getRange(1, col).setValue('Tipo').setFontWeight('bold');
    var regra = SpreadsheetApp.newDataValidation().requireValueInList(PEDIDO_TIPOS, true).setAllowInvalid(false).build();
    ped.getRange(2, col, ped.getMaxRows() - 1, 1).setDataValidation(regra);
    log.push('Pedidos: coluna Tipo criada na coluna ' + massaLetra_(col) + ' (vazio = Encomenda).');
  } else log.push('Pedidos: coluna Tipo já existia.');
  // 3. Fichas técnicas › Bolinhas por unidade vendida
  var fi = sh_('Fichas técnicas'), cf = massaCab_(fi);
  if (cf.indexOf(MASSA_COL_FICHA) < 0) {
    var cfc = cf.length + 1;
    if (cfc > fi.getMaxColumns()) fi.insertColumnsAfter(fi.getMaxColumns(), cfc - fi.getMaxColumns());
    fi.getRange(1, cfc).setValue(MASSA_COL_FICHA).setFontWeight('bold')
      .setNote('Bolinhas de massa congelada que saem do estoque por unidade vendida. Cookie por unidade = 1; caixa de 6 = 6. Vazio ou 0 = não usa massa (bolo, pudim).');
    log.push('Fichas técnicas: coluna "' + MASSA_COL_FICHA + '" criada na coluna ' + massaLetra_(cfc) + '. Preencher nas fichas de cookie.');
  } else log.push('Fichas técnicas: coluna de bolinhas já existia.');
  massaCab_(fi).forEach(function (c, i) {   // decisão 37: horas e margem por hora saem de uso (colunas ocultas, sem apagar)
    if (/^Tempo do lote|^Unidades por hora|^Margem por hora|^Estimativa do plano/i.test(c) && !fi.isColumnHiddenByUser(i + 1)) { fi.hideColumns(i + 1); log.push('Fichas técnicas: coluna "' + c + '" oculta (sem uso).'); }
  });
  // 4. Config
  var cfgSh = sh_('Config'), nc = cfgSh.getLastRow() - 1, chaves = nc > 0 ? cfgSh.getRange(2, 1, nc, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
  MASSA_CONFIG.forEach(function (c) {
    if (chaves.indexOf(c[0]) >= 0) { log.push('Config: ' + c[0] + ' já existia.'); return; }
    cfgSh.appendRow(c); chaves.push(c[0]); log.push('Config: ' + c[0] + ' = ' + c[1] + '.');
  });
  // 5. DRE: oculta (não apaga) as linhas de horas e margem por hora
  var dre = sh_('DRE');
  if (dre) {
    var nd = dre.getLastRow(), rot = nd ? dre.getRange(1, 1, nd, 1).getValues() : [];
    rot.forEach(function (r, i) {
      if (/^Horas trabalhadas|por hora/i.test(String(r[0]))) {
        if (!dre.isRowHiddenByUser(i + 1)) { dre.hideRows(i + 1); log.push('DRE: linha ' + (i + 1) + ' ("' + r[0] + '") oculta.'); }
      }
    });
  }
  // 6. Semanal: colunas de horas e margem por hora ficam sem uso (ocultas, sem apagar)
  var sem = sh_('Semanal');
  if (sem) massaCab_(sem).forEach(function (c, i) {
    if (/^Horas trabalhadas|^Margem por hora/i.test(c) && !sem.isColumnHiddenByUser(i + 1)) { sem.hideColumns(i + 1); log.push('Semanal: coluna "' + c + '" oculta (sem uso).'); }
  });
  // 7. Estoque: coluna Tipo (vazio = insumo; "Massa" = bolinhas contadas no congelador)
  var es = sh_('Estoque');
  if (es) {
    var ce = massaCab_(es);
    if (ce.indexOf('Tipo') < 0) {
      var cec = ce.length + 1;
      if (cec > es.getMaxColumns()) es.insertColumnsAfter(es.getMaxColumns(), cec - es.getMaxColumns());
      es.getRange(1, cec).setValue('Tipo').setFontWeight('bold');
      log.push('Estoque: coluna Tipo criada (vazio = insumo, Massa = bolinhas no congelador).');
    } else log.push('Estoque: coluna Tipo já existia.');
  }
  // 8. Gatilhos: a lista de produção de terça saiu do código (Push.gs e Mural.gs); entra verificarMassa de hora em hora
  var tem = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'verificarMassa'; });
  if (!tem) { ScriptApp.newTrigger('verificarMassa').timeBased().everyHours(1).create(); log.push('Gatilho verificarMassa (de hora em hora) criado.'); }
  else log.push('Gatilho verificarMassa já existia.');
  if (typeof prodAba_ === 'function') log.push('Controle de produção antigo (aba Producao) mantido sem uso.');
  var msg = 'atualizarV10\n' + log.join('\n');
  Logger.log(msg);
  return msg;
}

/* ------------------------------ planilha ------------------------------ */

function massaAba_() {
  var sh = sh_('Massa');
  if (!sh) {
    sh = ss_().insertSheet('Massa');
    sh.getRange(1, 1, 1, MASSA_CAB.length).setValues([MASSA_CAB]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), 4).setNumberFormat('@');   // ID, data, tipo e produto como texto
    sh.getRange(1, 6, sh.getMaxRows(), 5).setNumberFormat('@');
    sh.getRange(2, 3, sh.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(MASSA_TIPOS, true).build());
  }
  return sh;
}

function massaMovs_() {
  var sh = sh_('Massa'); if (!sh) return [];
  var n = sh.getLastRow() - 1; if (n <= 0) return [];
  return sh.getRange(2, 1, n, MASSA_CAB.length).getValues().map(function (r) {
    return { id: String(r[0]).trim(), data: massaIso_(r[1]), tipo: String(r[2]).trim(), produto: String(r[3]).trim(), unidades: Number(r[4]) || 0,
      validade: massaIso_(r[5]), motivo: String(r[6] || ''), obs: String(r[7] || ''), pessoa: String(r[8] || '') };
  }).filter(function (m) { return m.produto && m.data; });
}

/** Fichas: { chave: { nome, bpu, kit, unidadesLote, preco } } */
function massaFichas_() {
  var sh = sh_('Fichas técnicas'), n = sh.getLastRow() - 1, out = {};
  if (n <= 0) return out;
  var cab = massaCab_(sh), cN = cab.indexOf('Produto'), cB = cab.indexOf(MASSA_COL_FICHA), cU = massaColIni_(cab, 'Unidades por lote'), cP = massaColIni_(cab, 'Preço');
  sh.getRange(2, 1, n, cab.length).getValues().forEach(function (r) {
    var nome = String(r[cN] || '').trim(); if (!nome) return;
    var b = cB >= 0 ? Number(r[cB]) : 0;
    out[massaChave_(nome)] = { nome: nome, bpu: b > 0 ? b : 0, kit: MASSA_KIT_RE.test(nome), unidadesLote: cU >= 0 ? Number(r[cU]) || 0 : 0, preco: cP >= 0 ? Number(r[cP]) || 0 : 0 };
  });
  return out;
}

/** Pedidos para a baixa: { data, itens, obs, status, id, tipo }. Tipo vazio (pedido antigo) = Encomenda. */
function massaPedidos_() {
  var sh = sh_('Pedidos'), n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  var cab = massaCab_(sh), col = function (nome) { var i = cab.indexOf(nome); if (i < 0) throw new Error('Aba Pedidos sem a coluna "' + nome + '".'); return i; };
  var cD = col('Data do pedido'), cI = col('Itens'), cS = col('Status'), cO = col('Observação'), cId = col('ID'), cT = cab.indexOf('Tipo');
  return sh.getRange(2, 1, n, cab.length).getValues().map(function (r) {
    return { data: massaIso_(r[cD]), itens: String(r[cI] || ''), status: String(r[cS] || '').trim(), obs: String(r[cO] || ''), id: String(r[cId] || '').trim(),
      tipo: tipoPedido_(cT >= 0 ? r[cT] : '') };
  }).filter(function (p) { return p.itens; });
}

/** Tipo do pedido como gravado; vazio ou desconhecido (pedidos antigos) = Encomenda. */
function tipoPedido_(v) { return String(v || '').trim() === 'Pronta-entrega' ? 'Pronta-entrega' : 'Encomenda'; }

/** Valida o Tipo que vem do app: vazio = padrão; outro valor = erro. */
function validarTipoPedido_(v, padrao) {
  var t = String(v === undefined || v === null ? '' : v).trim();
  if (!t) return padrao || 'Encomenda';
  if (PEDIDO_TIPOS.indexOf(t) < 0) throw new Error('Tipo de pedido inválido: ' + t.slice(0, 30) + '. Use Pronta-entrega ou Encomenda.');
  return t;
}

function massaCfg_() {
  var c = config_(), n = function (k, p) { var v = Number(c[k]); return isFinite(v) && String(c[k]).trim() !== '' ? v : p; };
  return { minimo: n('estoque_minimo_massa', 12), validadeDias: n('validade_massa_dias', 90), alertaDias: n('alerta_lote_dias', 75), antecedenciaBolo: n('antecedencia_bolo_dias', 2) };
}

/* ------------------------------ validação ------------------------------ */

function massaValidar_(d, F, cfg, hoje) {
  var tipo = String(d.tipo || '').trim();
  if (MASSA_TIPOS.indexOf(tipo) < 0) throw new Error('Tipo inválido. Use Produção, Descarte ou Ajuste.');
  var f = F[massaChave_(d.produto)];
  if (!f || !(f.bpu > 0) || f.kit) throw new Error('Escolha um sabor com massa (ficha técnica com "' + MASSA_COL_FICHA + '" maior que 0).');
  var u = Number(d.unidades);
  if (!isFinite(u) || u !== Math.round(u) || Math.abs(u) > 5000) throw new Error('Quantidade inválida.');
  if (tipo === 'Ajuste' ? u === 0 : u <= 0) throw new Error(tipo === 'Ajuste' ? 'O ajuste precisa de uma quantidade diferente de 0 (use − para tirar).' : 'Quantidade inválida.');
  var data = String(d.data || hoje).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data > massaAddDias_(hoje, 1) || data < massaAddDias_(hoje, -400)) throw new Error('Data inválida.');
  var validade = '', motivo = '';
  if (tipo === 'Produção') {
    validade = String(d.validade || '').slice(0, 10) || massaAddDias_(data, cfg.validadeDias);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validade) || validade < data) throw new Error('Validade inválida.');
  } else {
    motivo = String(d.motivo || '').trim();
    if (MASSA_MOTIVOS.indexOf(motivo) < 0) throw new Error('Escolha o motivo: ' + MASSA_MOTIVOS.join(', ') + '.');
  }
  var pessoa = String(d.pessoa || '').trim();
  if (pessoa && API_PESSOAS.indexOf(pessoa) < 0) pessoa = '';
  return { tipo: tipo, produto: f.nome, unidades: u, data: data, validade: validade, motivo: motivo, obs: String(d.obs || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200), pessoa: pessoa };
}

/* ------------------------------ utilitários ------------------------------ */

function massaChave_(nome) { return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function massaCab_(sh) { var lc = sh.getLastColumn(); return lc ? sh.getRange(1, 1, 1, lc).getValues()[0].map(function (c) { return String(c).trim(); }) : []; }
function massaColIni_(cab, ini) { for (var i = 0; i < cab.length; i++) if (cab[i].indexOf(ini) === 0) return i; return -1; }
function massaLetra_(c) { var s = ''; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
function massaIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v || '').trim(), m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : s.slice(0, 10);
}
function massaAddDias_(iso, n) { var p = String(iso).split('-'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n)); return d.toISOString().slice(0, 10); }
function massaDias_(de, ate) { var a = String(de).split('-'), b = String(ate).split('-'); return Math.round((Date.UTC(+b[0], +b[1] - 1, +b[2]) - Date.UTC(+a[0], +a[1] - 1, +a[2])) / 864e5); }
function massaDm_(iso) { return iso ? String(iso).slice(8, 10) + '/' + String(iso).slice(5, 7) : ''; }
/** "Cookie de Nutella" → "Nutella" (nome curto para avisos) */
function massaSabor_(nome) { return String(nome || '').replace(/^cookies?\s+(de\s+|com\s+)?/i, '').trim() || String(nome || ''); }
function massaPin_(pin) { if (!apiIgual_(String(pin || '').trim(), String(config_().pin || '').trim())) throw new Error('PIN incorreto.'); }

/* ------------------------------ testes (rodar testarV10 no editor; não grava nada, exceto os testes 1 e 9, que limpam no fim) ------------------------------ */

function massaTesteDados_() {
  var F = {};
  [['Cookie de Nutella', 1], ['Cookie Chocolate', 1], ['Caixa de cookies 6 un', 6], ['Bolo caseirinho pequeno', 0]].forEach(function (x) {
    F[massaChave_(x[0])] = { nome: x[0], bpu: x[1], kit: MASSA_KIT_RE.test(x[0]), unidadesLote: 1, preco: 10 };
  });
  return { F: F, cfg: { minimo: 12, validadeDias: 90, alertaDias: 75, antecedenciaBolo: 2 } };
}
function massaTesteCalc_(movs, pedidos, hoje) {
  var t = massaTesteDados_();
  var r = massaCalcular_({ movs: movs, pedidos: pedidos, fichas: t.F, cfg: t.cfg, hoje: hoje || '2026-10-22' });
  var o = {}; r.sabores.forEach(function (s) { o[s.produto] = s; }); r.por = o; return r;
}
function massaTestes_() {
  var res = [], ok = function (n, cond, det) { res.push((cond ? 'OK   ' : 'FALHA ') + n + (cond ? '' : ' → ' + det)); };
  var lote = function (id, data, u, prod) { return { id: id, data: data, tipo: 'Produção', produto: prod || 'Cookie de Nutella', unidades: u }; };
  var ped = function (itens, data, status, obs) { return { id: 'P1', data: data || '2026-10-21', itens: itens, status: status || 'Confirmado', obs: obs || '' }; };
  var L = [lote('M1', '2026-10-20', 24)], r;
  r = massaTesteCalc_(L, [ped('6x Cookie de Nutella')]); ok('2. lote de 24 e pedido de 6 → saldo 18', r.por['Cookie de Nutella'].saldo === 18, r.por['Cookie de Nutella'].saldo);
  r = massaTesteCalc_(L, [ped('6x Cookie de Nutella', null, 'Cancelado')]); ok('3a. cancelar devolve → 24', r.por['Cookie de Nutella'].saldo === 24, r.por['Cookie de Nutella'].saldo);
  r = massaTesteCalc_(L, [ped('6x Cookie de Nutella', null, 'Confirmado')]); ok('3b. reabrir baixa de novo → 18', r.por['Cookie de Nutella'].saldo === 18, r.por['Cookie de Nutella'].saldo);
  r = massaTesteCalc_(L, [ped('8x cookie de nutélla')]); ok('4. editar para 8 (nome sem acento/maiúscula) → 16', r.por['Cookie de Nutella'].saldo === 16, r.por['Cookie de Nutella'].saldo);
  r = massaTesteCalc_(L, [ped('1x Caixa de cookies 6 un', null, null, 'Sem lactose\nSabores: 6x Cookie de Nutella')]); ok('5a. caixa de 6 com sabores baixa 6 → 18', r.por['Cookie de Nutella'].saldo === 18, r.por['Cookie de Nutella'].saldo);
  r = massaTesteCalc_(L, [ped('1x Caixa de cookies 6 un')]); ok('5b. caixa sem sabor: não baixa e avisa', r.por['Cookie de Nutella'].saldo === 24 && r.avisos.length === 1 && r.avisos[0].tipo === 'semSabor', JSON.stringify(r.avisos));
  var D = L.concat([{ id: 'M2', data: '2026-10-21', tipo: 'Descarte', produto: 'Cookie de Nutella', unidades: 4, motivo: 'Qualidade' }]);
  r = massaTesteCalc_(D, []); ok('6a. descarte de 4 → 20', r.por['Cookie de Nutella'].saldo === 20, r.por['Cookie de Nutella'].saldo);
  r = massaTesteCalc_(L, []); ok('6b. desfazer o descarte → 24', r.por['Cookie de Nutella'].saldo === 24, r.por['Cookie de Nutella'].saldo);
  r = massaTesteCalc_(L, [ped('6x Cookie de Nutella', '2026-10-19')]); ok('7. pedido anterior ao primeiro lote não baixa', r.por['Cookie de Nutella'].saldo === 24, r.por['Cookie de Nutella'].saldo);
  r = massaTesteCalc_([lote('M3', '2026-10-10', 10), lote('M4', '2026-10-20', 10)], [ped('12x Cookie de Nutella')]);
  var ls = r.por['Cookie de Nutella'].lotes;
  ok('8. FIFO: lote de 10/10 zera, 20/10 fica com 8', ls.length === 1 && ls[0].data === '2026-10-20' && ls[0].saldo === 8, JSON.stringify(ls));
  r = massaTesteCalc_([lote('M5', '2026-08-08', 20)], [], '2026-10-22');
  ok('9a. lote com 75 dias gera alerta', r.por['Cookie de Nutella'].alertas.some(function (a) { return a.tipo === 'lote'; }), JSON.stringify(r.por['Cookie de Nutella'].alertas));
  r = massaTesteCalc_([lote('M6', '2026-08-09', 20)], [], '2026-10-22');
  ok('9b. lote com 74 dias não gera alerta', !r.por['Cookie de Nutella'].alertas.length, JSON.stringify(r.por['Cookie de Nutella'].alertas));
  r = massaTesteCalc_([lote('M7', '2026-10-20', 24), lote('M8', '2026-10-20', 24, 'Cookie Chocolate')], []);
  ok('10a. sem sabor abaixo do mínimo: sem sugestão', massaBaixos_(r).length === 0, massaBaixosTxt_(r));
  r = massaTesteCalc_([lote('M7', '2026-10-20', 24), lote('M8', '2026-10-20', 4, 'Cookie Chocolate')], []);
  ok('10b. Chocolate com 4: sugestão "Chocolate 4"', massaBaixosTxt_(r) === 'Chocolate 4', massaBaixosTxt_(r));
  r = massaTesteCalc_(L, [ped('30x Cookie de Nutella')]);
  ok('saldo negativo vira alerta', r.por['Cookie de Nutella'].saldo === -6 && r.por['Cookie de Nutella'].alertas[0].tipo === 'negativo', JSON.stringify(r.por['Cookie de Nutella'].alertas));
  var pb = { porSabor: {} }; pb.porSabor[massaChave_('Cookie de Nutella')] = { 'recheio nutella': 25, 'manteiga': 11.67 };
  var g = massaInsumosGuardados_({ 'Cookie de Nutella': 10 }, pb);
  ok('11. 10 bolinhas de Nutella guardam 250 g de recheio', Math.abs(g['recheio nutella'] - 250) < 1e-9 && Math.abs(g['manteiga'] - 116.7) < 1e-9, JSON.stringify(g));
  var t = massaTesteDados_(), erro = function (f) { try { f(); return false; } catch (e) { return true; } };
  ok('13a. massa com Tipo inválido é recusada', erro(function () { massaValidar_({ tipo: 'Venda', produto: 'Cookie de Nutella', unidades: 5 }, t.F, t.cfg, '2026-10-22'); }), '');
  ok('13b. pedido com Tipo inválido é recusado', erro(function () { validarTipoPedido_('Delivery'); }), '');
  ok('13c. ajuste negativo aceito, descarte negativo recusado', !erro(function () { massaValidar_({ tipo: 'Ajuste', produto: 'Cookie de Nutella', unidades: -3, motivo: 'Contagem' }, t.F, t.cfg, '2026-10-22'); }) &&
    erro(function () { massaValidar_({ tipo: 'Descarte', produto: 'Cookie de Nutella', unidades: -3, motivo: 'Outro' }, t.F, t.cfg, '2026-10-22'); }), '');
  ok('13d. bolo (sem massa) não pode virar lote', erro(function () { massaValidar_({ tipo: 'Produção', produto: 'Bolo caseirinho pequeno', unidades: 3 }, t.F, t.cfg, '2026-10-22'); }), '');
  ok('14. pedido de tipo vazio (antigo) = Encomenda', tipoPedido_('') === 'Encomenda' && tipoPedido_(null) === 'Encomenda' && validarTipoPedido_('') === 'Encomenda' && tipoPedido_('Pronta-entrega') === 'Pronta-entrega', '');
  var v = massaValidar_({ tipo: 'Produção', produto: 'cookie de nutella', unidades: 24, data: '2026-10-22' }, t.F, t.cfg, '2026-10-22');
  ok('validade padrão = data + 90 dias', v.validade === '2027-01-20' && v.produto === 'Cookie de Nutella', JSON.stringify(v));
  return res;
}

/** Rodar no editor: testes do cálculo (sem planilha) + migração 2 vezes + cartão de lote sem duplicar. Resultado no registro de execução. */
function testarV10() {
  var res = massaTestes_(), ok = function (n, cond, det) { res.push((cond ? 'OK   ' : 'FALHA ') + n + (cond ? '' : ' → ' + det)); };
  // 1. migração idempotente
  var conta = function () {
    var cfg = sh_('Config'), n = cfg.getLastRow() - 1, ch = cfg.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]).trim(); });
    return JSON.stringify({ abas: ss_().getSheets().filter(function (s) { return s.getName() === 'Massa'; }).length,
      tipo: massaCab_(sh_('Pedidos')).filter(function (c) { return c === 'Tipo'; }).length,
      bol: massaCab_(sh_('Fichas técnicas')).filter(function (c) { return c === MASSA_COL_FICHA; }).length,
      cfg: MASSA_CONFIG.map(function (c) { return ch.filter(function (x) { return x === c[0]; }).length; }).join(','),
      gat: ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'verificarMassa'; }).length });
  };
  atualizarV10(); var a = conta(); atualizarV10(); var b = conta();
  ok('1. atualizarV10 duas vezes não duplica', a === b && a === JSON.stringify({ abas: 1, tipo: 1, bol: 1, cfg: '1,1,1,1', gat: 1 }), a + ' / ' + b);
  // 9. cartão de lote: um só, mesmo rodando duas vezes (dados de teste apagados no fim)
  var est = { cfg: massaCfg_(), sabores: [{ produto: 'Cookie TESTE', saldo: 5, lotes: [{ id: 'MTESTE' + Date.now(), data: '2026-08-08', validade: '2026-11-06', idade: 75, saldo: 5, perto: true, vencido: false }] }] };
  var hoje = today_(), n1 = massaLotesVencendo_(est, hoje, true), n2 = massaLotesVencendo_(est, hoje, true);
  var chave = 'massa-lote-' + est.sabores[0].lotes[0].id, t = muralLer_('Mural', MURAL_CAB), meus = t.linhas.filter(function (c) { return c.Chave === chave; });
  ok('9. lote de 75 dias: um cartão só no Mural', n1 === 1 && n2 === 0 && meus.length === 1, n1 + '/' + n2 + '/' + meus.length);
  meus.map(function (c) { return c._linha; }).sort(function (x, y) { return y - x; }).forEach(function (l) { t.sh.deleteRow(l); });
  // 10. sugestão só com sabor abaixo do mínimo (sem gravar: confere a condição)
  ok('10. sugestão não sai sem sabor baixo', massaSugestao_({ cfg: { minimo: 12 }, sabores: [{ produto: 'Cookie TESTE', saldo: 30, lotes: [] }] }, '2000-01-03', true) === false, '');
  // 13. API: função fora da lista é recusada
  var recusou = false; try { apiRpc_({ pessoa: 'Bruno' }, { fn: 'atualizarV10', args: [] }); } catch (e) { recusou = /não permitida/.test(e.message); }
  ok('13. API recusa função fora da lista (atualizarV10)', recusou, '');
  var falhas = res.filter(function (l) { return l.indexOf('FALHA') === 0; }).length;
  Logger.log(res.join('\n') + '\n\n' + (falhas ? falhas + ' FALHA(S)' : 'Todos os testes passaram.'));
  return res;
}
