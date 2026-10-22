/**
 * Massa.gs — versão 10 do app (decisões 36 e 37, 22/10/2026), sobre o controle de produção (Producao.gs).
 *
 * O estoque é o do controle de produção: a Raquel lança o que produziu ("Produzi 24 Cookie de Nutella": bolinhas de
 * massa congelada contam como produzido) e, quando quiser, conta o estoque. Os pedidos em aberto reservam; ao serem
 * retirados, baixam do estoque. Pronto é a etapa do pedido (Assado, na pronta-entrega).
 *   no estoque = produzido − itens dos pedidos retirados        livres = no estoque − em pedidos
 * Este arquivo junta o que a versão 10 acrescenta em cima disso: Tipo do pedido (Pronta-entrega ou Encomenda),
 * sugestão de produção, números de estoque para a Gestão e o painel, estoque guardado na contagem do fim do mês,
 * margem de contribuição por produto e a migração atualizarV10.
 *
 * Instalação: colar este arquivo, rodar atualizarV10() uma vez e publicar uma nova versão.
 */
var PEDIDO_TIPOS = ['Pronta-entrega', 'Encomenda'];
var V10_KIT_RE = /^(caixa|kit|assinatura)\b/i;
var V10_CONFIG = [
  ['estoque_minimo_massa', 12, 'Unidades livres por produto (cookie: bolinhas). Abaixo disso o app avisa e a sugestão de produção de segunda sai.'],
  ['antecedencia_bolo_dias', 2, 'Antecedência mínima, em dias, das encomendas (bolo caseirinho). Só avisa, não bloqueia.']
];

/* ------------------------------ estoque (a partir do Producao.gs) ------------------------------ */

/**
 * Estoque por produto controlado (sem caixas e kits), no formato usado pela Gestão, avisos e painel:
 * { itens: [{ produto, produzido, entregue, reservado, estoque, livre, lancado, diasEstoque, alertas }], total, cfg }
 * diasEstoque = livres ÷ média diária saída nas últimas 4 semanas (pedidos não cancelados).
 */
function estoqueProducao_(hoje) {
  hoje = hoje || today_();
  var r = prodResumo_(), cfg = v10Cfg_(), media = v10SaidaMedia_(hoje);
  var itens = r.itens.filter(function (x) { return !V10_KIT_RE.test(x.nome) && (x.lancado || x.reservado > 0); }).map(function (x) {
    var m = media[prodChave_(x.nome)] || 0, alertas = [];
    if (x.lancado && x.livre < 0) alertas.push({ tipo: 'faltam', texto: 'Faltam ' + (-x.livre) + ' para os pedidos em aberto' });
    else if (x.lancado && x.livre === 0) alertas.push({ tipo: 'zerado', texto: 'Nada livre' });
    else if (x.lancado && x.livre < cfg.minimo) alertas.push({ tipo: 'baixo', texto: 'Abaixo do mínimo de ' + cfg.minimo });
    return { produto: x.nome, produzido: x.produzido, entregue: x.entregue, reservado: x.reservado, estoque: x.estoque, livre: x.livre, lancado: x.lancado,
      diasEstoque: m > 0 ? Math.max(0, Math.floor(x.livre / m)) : null, alertas: alertas };
  });
  return { itens: itens, total: itens.reduce(function (a, x) { return a + (x.lancado ? x.estoque : 0); }, 0), cfg: cfg, inicio: r.inicio };
}

/* Unidades por dia que saíram (pedidos não cancelados) nas últimas 4 semanas, por produto (chave) */
function v10SaidaMedia_(hoje) {
  var lim = addDays_(hoje, -28), out = {};
  readPedidos_().forEach(function (p) {
    if (p.status === 'Cancelado' || !p.data || p.data < lim || p.data > hoje) return;
    prodItens_(p.itens, p.obs).forEach(function (it) { var k = prodChave_(it.nome); out[k] = (out[k] || 0) + it.q / 28; });
  });
  return out;
}

/** Produtos lançados com livres abaixo do mínimo (inclui zerados e faltando), do menor para o maior. */
function v10Baixos_(est) {
  return est.itens.filter(function (x) { return x.lancado && x.livre < est.cfg.minimo; }).sort(function (a, b) { return a.livre - b.livre; });
}
function v10BaixosTxt_(est) { return v10Baixos_(est).map(function (x) { return v10Curto_(x.produto) + ' ' + Math.max(0, x.livre); }).join(', '); }

/** Produção lançada e perda na contagem entre ini e fim (yyyy-MM-dd, inclusive): aba Producao. */
function producaoPeriodo_(ini, fim) {
  var o = { produzido: 0, perdido: 0 }, sh = prodAba_(), n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 1, n, PROD_CAB.length).getValues().forEach(function (r) {
    var d = v10Iso_(r[0]), q = Number(r[2]) || 0;
    if (!d || d < ini || d > fim || V10_KIT_RE.test(String(r[1]))) return;
    if (String(r[3]) === 'Produção') o.produzido += q;
    else if (String(r[3]) === 'Contagem' && q < 0) o.perdido += -q;
  });
  o.perda = o.produzido ? o.perdido / o.produzido : null;
  return o;
}

/** Contagem pelo servidor (fim do mês): grava na aba Producao a diferença para o estoque bater. Devolve a diferença. */
function prodContagem_(produto, q, pessoa, obs) {
  var atual = 0;
  prodResumo_().itens.forEach(function (it) { if (prodChave_(it.nome) === prodChave_(produto)) atual = it.estoque; });
  var dif = q - atual;
  if (!dif) return 0;
  prodInicio_();
  var agora = new Date(), tz = Session.getScriptTimeZone();
  prodAba_().appendRow([Utilities.formatDate(agora, tz, 'yyyy-MM-dd'), produto, dif, 'Contagem', String(pessoa || '').slice(0, 30),
    Utilities.formatDate(agora, tz, 'yyyy-MM-dd HH:mm'), (obs ? obs + ': ' : '') + 'contou ' + q + ' (o app esperava ' + atual + ')']);
  return dif;
}

/**
 * Insumos guardados no estoque de produção (contagem do fim do mês): { chaveInsumo: quantidade } para
 * unidades = { produto: n }, pela receita (quantidade no lote ÷ unidades por lote). Produto sem receita ou sem
 * "Unidades por lote" vira aviso, sem estimar.
 */
function v10InsumosGuardados_(unidades, base) {
  base = base || baseCustos_();
  var acc = {}, avisos = [];
  Object.keys(unidades || {}).forEach(function (nome) {
    var q = Number(unidades[nome]) || 0; if (!q) return;
    if (!expandir_(base, nome, q, acc, {})) avisos.push(nome + ': sem receita ou sem "Unidades por lote" na ficha; o estoque deste produto não entra nos insumos contados');
  });
  return { porInsumo: acc, avisos: avisos };
}

/** Margem de contribuição por produto (preço − custo total por unidade da ficha), da maior para a menor. */
function margemPorProduto_() {
  var sh = sh_('Fichas técnicas'), n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  var cab = v10Cab_(sh), v = sh.getRange(2, 1, n, cab.length).getValues();
  var cN = cab.indexOf('Produto'), cP = v10ColIni_(cab, 'Preço'), cC = v10ColIni_(cab, 'Custo total por unidade');
  if (cN < 0 || cP < 0 || cC < 0) return [];
  return v.map(function (r) {
    var nome = String(r[cN] || '').trim(), preco = Number(r[cP]), custo = r[cC];
    if (!nome || !(preco > 0) || custo === '' || custo === null || isNaN(Number(custo))) return null;
    custo = Number(custo);
    return { nome: nome, preco: preco, custo: custo, margem: Math.round((preco - custo) * 100) / 100, pct: (preco - custo) / preco };
  }).filter(Boolean).sort(function (a, b) { return b.margem - a.margem; });
}

/* ------------------------------ Tipo do pedido ------------------------------ */

/** Tipo do pedido como gravado; vazio ou desconhecido (pedidos antigos) = Encomenda. */
function tipoPedido_(v) { return String(v || '').trim() === 'Pronta-entrega' ? 'Pronta-entrega' : 'Encomenda'; }

/** Valida o Tipo que vem do app: vazio = padrão; outro valor = erro. */
function validarTipoPedido_(v, padrao) {
  var t = String(v === undefined || v === null ? '' : v).trim();
  if (!t) return padrao || 'Encomenda';
  if (PEDIDO_TIPOS.indexOf(t) < 0) throw new Error('Tipo de pedido inválido: ' + t.slice(0, 30) + '. Use Pronta-entrega ou Encomenda.');
  return t;
}

/* ------------------------------ avisos (gatilho de hora em hora criado por atualizarV10) ------------------------------ */

/**
 * Segunda às 7h: sugestão de produção, só com produto abaixo do mínimo de livres (cartão no Mural para a Raquel
 * e aviso "producao" no celular). Silêncio das 22h às 7h respeitado.
 */
function verificarMassa() {
  var hoje = today_(), hora = Number(fmt_(new Date(), 'H')), dow = parseD_(hoje).getDay();
  if (hora >= 22 || hora < 7 || dow !== 1) return;
  var lock = LockService.getScriptLock(); if (!lock.tryLock(10000)) return;
  try { v10Sugestao_(estoqueProducao_(hoje), hoje); }
  catch (e) { Logger.log('verificarMassa: ' + (e.stack || e)); }
  finally { lock.releaseLock(); }
}

function v10Sugestao_(est, hoje, semAviso) {
  var baixos = v10Baixos_(est);
  if (!baixos.length) return false;
  var chave = 'producao-sugestao-' + hoje;
  if (v10CartaoExiste_(chave)) return false;
  var txt = v10BaixosTxt_(est);
  muralNovo_({ Origem: 'Sistema', Para: 'Raquel', Tipo: 'tarefa', Titulo: 'Produção baixa: ' + txt,
    Resumo: 'Sugestão de produção da semana (mínimo de ' + est.cfg.minimo + ' livres por produto)',
    Corpo: '**Abaixo do mínimo**\n' + baixos.map(function (x) {
      return '- ' + x.produto + ': ' + x.livre + ' livre' + (Math.abs(x.livre) === 1 ? '' : 's') + ' (' + x.estoque + ' no estoque, ' + x.reservado + ' em pedidos)' +
        (x.diasEstoque !== null ? ' · dá para ' + x.diasEstoque + ' dia' + (x.diasEstoque === 1 ? '' : 's') : '') + ' · faltam ' + Math.max(0, est.cfg.minimo - x.livre) + ' para o mínimo';
    }).join('\n'),
    Passos: 'Conferir o congelador\nFazer a massa dos produtos da lista\nLançar no app: + › Produção',
    Prazo: hoje, Chave: chave });
  if (!semAviso && typeof pushAvisar_ === 'function' && typeof pushStatus_ === 'function' && pushStatus_().ativo)
    pushAvisar_('Raquel', 'producao', { titulo: 'Produção baixa', corpo: txt + '. Sugestão de produção no Mural.', url: '#hoje', tag: 'producao' });
  return true;
}

/* Mesma chave = mesmo cartão (a chave fica na coluna Chave do Mural, inclusive nos arquivados) */
function v10CartaoExiste_(chave) {
  return muralLer_('Mural', MURAL_CAB).linhas.some(function (c) { return c.Chave === chave; });
}

/* ------------------------------ migração ------------------------------ */

/**
 * Rodar uma vez no editor depois de colar os arquivos da versão 10. Pode rodar de novo: não duplica nada.
 * Cria a coluna Tipo em Pedidos, as chaves da Config e a coluna Tipo no Estoque; oculta horas e margem por hora
 * (DRE, Semanal e Fichas técnicas); troca os gatilhos (sai a lista de produção de terça, entra verificarMassa).
 */
function atualizarV10() {
  var log = [];
  // 1. Pedidos › Tipo (pedidos antigos ficam vazios e são lidos como Encomenda)
  var ped = sh_('Pedidos'), cp = v10Cab_(ped);
  if (cp.indexOf('Tipo') < 0) {
    var iRep = cp.indexOf('Repasse (R$)');
    if (iRep < 0) throw new Error('Aba Pedidos sem a coluna "Repasse (R$)". Confira a estrutura antes de rodar.');
    var col = cp.length + 1;
    for (var i = iRep + 1; i < cp.length; i++) if (!cp[i]) { col = i + 1; break; }
    if (col > ped.getMaxColumns()) ped.insertColumnsAfter(ped.getMaxColumns(), col - ped.getMaxColumns());
    ped.getRange(1, col).setValue('Tipo').setFontWeight('bold');
    ped.getRange(2, col, ped.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PEDIDO_TIPOS, true).setAllowInvalid(false).build());
    log.push('Pedidos: coluna Tipo criada na coluna ' + v10Letra_(col) + ' (vazio = Encomenda).');
  } else log.push('Pedidos: coluna Tipo já existia.');
  // 2. Config
  var cfgSh = sh_('Config'), nc = cfgSh.getLastRow() - 1, chaves = nc > 0 ? cfgSh.getRange(2, 1, nc, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
  V10_CONFIG.forEach(function (c) {
    if (chaves.indexOf(c[0]) >= 0) { log.push('Config: ' + c[0] + ' já existia.'); return; }
    cfgSh.appendRow(c); chaves.push(c[0]); log.push('Config: ' + c[0] + ' = ' + c[1] + '.');
  });
  // 3. horas e margem por hora (decisão 37): ocultas, sem apagar
  var dre = sh_('DRE');
  if (dre) {
    var nd = dre.getLastRow(), rot = nd ? dre.getRange(1, 1, nd, 1).getValues() : [];
    rot.forEach(function (r, k) {
      if (/^Horas trabalhadas|por hora/i.test(String(r[0])) && !dre.isRowHiddenByUser(k + 1)) { dre.hideRows(k + 1); log.push('DRE: linha ' + (k + 1) + ' ("' + r[0] + '") oculta.'); }
    });
  }
  [['Semanal', /^Horas trabalhadas|^Margem por hora/i], ['Fichas técnicas', /^Tempo do lote|^Unidades por hora|^Margem por hora|^Estimativa do plano/i]].forEach(function (x) {
    var sh = sh_(x[0]); if (!sh) return;
    v10Cab_(sh).forEach(function (c, k) { if (x[1].test(c) && !sh.isColumnHiddenByUser(k + 1)) { sh.hideColumns(k + 1); log.push(x[0] + ': coluna "' + c + '" oculta (sem uso).'); } });
  });
  // 4. Estoque: coluna Tipo (vazio = insumo; "Produção" = unidades no estoque de produção, contadas no fim do mês)
  var es = sh_('Estoque');
  if (es) {
    var ce = v10Cab_(es);
    if (ce.indexOf('Tipo') < 0) {
      var cec = ce.length + 1;
      if (cec > es.getMaxColumns()) es.insertColumnsAfter(es.getMaxColumns(), cec - es.getMaxColumns());
      es.getRange(1, cec).setValue('Tipo').setFontWeight('bold');
      log.push('Estoque: coluna Tipo criada (vazio = insumo, Produção = unidades do estoque de produção).');
    } else log.push('Estoque: coluna Tipo já existia.');
  }
  // 5. Gatilhos: sai o e-mail da lista de produção de terça; entra verificarMassa de hora em hora
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'emailFechamento') { ScriptApp.deleteTrigger(t); log.push('Gatilho emailFechamento (lista de produção de terça 20h30) removido.'); }
  });
  if (!ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'verificarMassa'; })) {
    ScriptApp.newTrigger('verificarMassa').timeBased().everyHours(1).create(); log.push('Gatilho verificarMassa (de hora em hora) criado.');
  } else log.push('Gatilho verificarMassa já existia.');
  var msg = 'atualizarV10\n' + log.join('\n');
  Logger.log(msg);
  return msg;
}

/* ------------------------------ utilitários ------------------------------ */

function v10Cfg_() {
  var c = config_(), n = function (k, p) { var v = Number(c[k]); return String(c[k] === undefined ? '' : c[k]).trim() !== '' && isFinite(v) ? v : p; };
  return { minimo: n('estoque_minimo_massa', 12), antecedenciaBolo: n('antecedencia_bolo_dias', 2) };
}
function v10Cab_(sh) { var lc = sh.getLastColumn(); return lc ? sh.getRange(1, 1, 1, lc).getValues()[0].map(function (c) { return String(c).trim(); }) : []; }
function v10ColIni_(cab, ini) { for (var i = 0; i < cab.length; i++) if (cab[i].indexOf(ini) === 0) return i; return -1; }
function v10Letra_(c) { var s = ''; while (c > 0) { var m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; }
function v10Iso_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v) ? '' : Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(v || '').trim(), m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : s.slice(0, 10);
}
/** "Cookie de Nutella" → "Nutella" (nome curto para avisos) */
function v10Curto_(nome) { return String(nome || '').replace(/^cookies?\s+(de\s+|com\s+)?/i, '').trim() || String(nome || ''); }

/* ------------------------------ testes (rodar testarV10 no editor) ------------------------------ */

/** Migração duas vezes, Tipo do pedido, lista fechada da API e cálculo do estoque. Resultado no registro de execução; não grava pedidos. */
function testarV10() {
  var res = [], ok = function (n, cond, det) { res.push((cond ? 'OK   ' : 'FALHA ') + n + (cond ? '' : ' → ' + det)); };
  var conta = function () {
    var cfg = sh_('Config'), ch = cfg.getRange(2, 1, cfg.getLastRow() - 1, 1).getValues().map(function (r) { return String(r[0]).trim(); });
    return JSON.stringify({ tipo: v10Cab_(sh_('Pedidos')).filter(function (c) { return c === 'Tipo'; }).length,
      cfg: V10_CONFIG.map(function (c) { return ch.filter(function (x) { return x === c[0]; }).length; }).join(','),
      gat: ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'verificarMassa'; }).length });
  };
  atualizarV10(); var a = conta(); atualizarV10(); var b = conta();
  ok('1. atualizarV10 duas vezes não duplica', a === b && a === JSON.stringify({ tipo: 1, cfg: '1,1', gat: 1 }), a + ' / ' + b);
  var erro = function (f) { try { f(); return false; } catch (e) { return true; } };
  ok('13. pedido com Tipo inválido é recusado', erro(function () { validarTipoPedido_('Delivery'); }), '');
  ok('14. pedido de tipo vazio (antigo) = Encomenda', tipoPedido_('') === 'Encomenda' && validarTipoPedido_('') === 'Encomenda' && tipoPedido_('Pronta-entrega') === 'Pronta-entrega', '');
  var recusou = false; try { apiRpc_({ pessoa: 'Bruno' }, { fn: 'atualizarV10', args: [] }); } catch (e) { recusou = /não permitida/.test(e.message); }
  ok('13. API recusa função fora da lista (atualizarV10)', recusou, '');
  var est = estoqueProducao_();
  ok('estoque de produção lido (' + est.itens.length + ' produtos, ' + est.total + ' no estoque)', est.itens.every(function (x) { return x.livre === x.estoque - x.reservado; }), '');
  ok('sugestão não sai sem produto baixo', v10Sugestao_({ cfg: { minimo: 12 }, itens: [{ produto: 'Teste', lancado: true, livre: 30, estoque: 30, reservado: 0 }] }, '2000-01-03', true) === false, '');
  var falhas = res.filter(function (l) { return l.indexOf('FALHA') === 0; }).length;
  Logger.log(res.join('\n') + '\n\n' + (falhas ? falhas + ' FALHA(S)' : 'Todos os testes passaram.'));
  return res;
}
