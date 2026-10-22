/**
 * Producao.gs — controle do que está produzido (congelado ou pronto) e do que já está vendido, 17/10/2026.
 * A Raquel lança só a produção ("Produzi 24 Cookie de Nutella") e, quando quiser conferir, a contagem do congelador.
 * O resto vem dos pedidos:
 *   em pedidos (reservado) = itens dos pedidos em aberto (nem Retirado nem Cancelado)
 *   no estoque             = produzido − itens dos pedidos já retirados desde o início do controle
 *   livre para vender      = no estoque − em pedidos
 * Caixas e kits não contam pelo nome: contam os sabores escolhidos no app, gravados na Observação do pedido
 * numa linha "Sabores: 3x Cookie de Nutella; 3x Cookie de Kinder Bueno" (ponto e vírgula: há nomes com vírgula).
 *
 * Início do controle: no primeiro lançamento o script guarda o ID do momento (mesmo formato dos IDs de pedido,
 * P + aammddhhmmss) e os IDs dos pedidos em aberto. Entram na conta os pedidos criados depois disso e os que
 * estavam em aberto; os já retirados antes ficam de fora. Contar o congelador corrige qualquer diferença.
 * Versão 10 (22/10/2026): volta a ser o estoque do app (bolinhas de massa congelada contam como produzidas; pronto é a
 * etapa Assado do pedido). Lançamentos têm Desfazer. Avisos, Gestão e contagem do fim do mês leem daqui (Massa.gs).
 */
var PROD_CAB = ['Data', 'Produto', 'Quantidade', 'Tipo', 'Pessoa', 'RegistradoEm', 'Observação'];
var PROD_KIT_RE = /^(caixa|kit|assinatura)\b/i;
var PROD_SABORES_RE = /(^|\n)\s*Sabores:\s*([^\n]*)/i;

/* ------------------------------ funções chamadas pelo app (PIN como 1º argumento) ------------------------------ */

function getProducao(pin) {
  prodPin_(pin);
  var r = prodResumo_();
  if (typeof v10Cfg_ === 'function') r.cfg = v10Cfg_();   // versão 10: mínimo de livres e antecedência das encomendas
  return r;
}

/** reg = { produto, q, tipo: 'producao' | 'contagem', pessoa }. Produção soma; contagem grava a diferença para o estoque bater. */
function salvarProducao(pin, reg) {
  prodPin_(pin);
  reg = reg || {};
  var produto = String(reg.produto || '').trim().slice(0, 80), q = Number(reg.q), tipo = reg.tipo === 'contagem' ? 'contagem' : 'producao';
  if (!produto) throw new Error('Escolha o produto.');
  if (!isFinite(q) || q !== Math.round(q) || q < 0 || q > 2000) throw new Error('Quantidade inválida.');
  if (tipo === 'producao' && q === 0) throw new Error('Quantidade inválida.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    prodInicio_();
    var agora = new Date(), tz = Session.getScriptTimeZone(), linha;
    var data = Utilities.formatDate(agora, tz, 'yyyy-MM-dd'), em = Utilities.formatDate(agora, tz, 'yyyy-MM-dd HH:mm');
    var pessoa = String(reg.pessoa || '').slice(0, 30);
    if (tipo === 'producao') linha = [data, produto, q, 'Produção', pessoa, em, ''];
    else {
      var atual = 0;
      prodResumo_().itens.forEach(function (it) { if (prodChave_(it.nome) === prodChave_(produto)) atual = it.estoque; });
      var dif = q - atual;
      if (dif === 0) return prodResumo_();
      linha = [data, produto, dif, 'Contagem', pessoa, em, 'Contou ' + q + ' (o app esperava ' + atual + ')'];
    }
    prodAba_().appendRow(linha);
  } finally { lock.releaseLock(); }
  var r = prodResumo_();
  r.desfazer = { produto: linha[1], q: linha[2], tipo: linha[3], em: linha[5] };   // versão 10: o app oferece Desfazer
  return r;
}

/** Desfaz um lançamento feito pelo app (produção ou contagem): apaga a última linha igual da aba Producao. */
function desfazerProducao(pin, d) {
  prodPin_(pin);
  d = d || {};
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = prodAba_(), n = sh.getLastRow() - 1, achou = false;
    if (n > 0) {
      var v = sh.getRange(2, 1, n, PROD_CAB.length).getValues();
      for (var i = v.length - 1; i >= 0; i--) {
        if (String(v[i][1]) === String(d.produto) && Number(v[i][2]) === Number(d.q) && String(v[i][3]) === String(d.tipo) && String(v[i][5]) === String(d.em)) { sh.deleteRow(i + 2); achou = true; break; }
      }
    }
    if (!achou) throw new Error('Lançamento não encontrado (já desfeito?).');
  } finally { lock.releaseLock(); }
  return prodResumo_();
}

/* ------------------------------ cálculo ------------------------------ */

function prodResumo_() {
  var pr = PropertiesService.getScriptProperties(), ini = pr.getProperty('PROD_INICIO_ID') || '';
  var abertosIni = (pr.getProperty('PROD_ABERTOS') || '').split(',').filter(String);
  var mapa = {}, item = function (nome) { var k = prodChave_(nome); return mapa[k] || (mapa[k] = { nome: String(nome).trim(), produzido: 0, entregue: 0, reservado: 0, lancado: false }); };

  var sh = prodAba_(), n = sh.getLastRow() - 1, ultimos = [];
  if (n > 0) sh.getRange(2, 1, n, PROD_CAB.length).getValues().forEach(function (r) {
    if (!String(r[1]).trim()) return;
    var x = item(r[1]); x.produzido += Number(r[2]) || 0; x.lancado = true;
    ultimos.push({ data: String(r[0]), produto: String(r[1]), q: Number(r[2]) || 0, tipo: String(r[3]), pessoa: String(r[4]), obs: String(r[6] || '') });
  });

  if (ini) prodPedidos_().forEach(function (p) {
    if (p.status === 'Cancelado') return;
    var aberto = p.status !== 'Retirado';
    if (!aberto && !(p.id >= ini || abertosIni.indexOf(p.id) >= 0)) return;   // retirado antes do início do controle
    prodItens_(p.itens, p.obs).forEach(function (it) { if (aberto) item(it.nome).reservado += it.q; else item(it.nome).entregue += it.q; });
  });

  var itens = Object.keys(mapa).map(function (k) {
    var x = mapa[k]; x.estoque = x.produzido - x.entregue; x.livre = x.estoque - x.reservado; return x;
  }).sort(function (a, b) { return a.nome.localeCompare(b.nome); });
  return { inicio: ini, itens: itens, ultimos: ultimos.slice(-15).reverse() };
}

/** Itens que contam no estoque: produtos do pedido (sem caixas e kits) + sabores escolhidos para caixas e kits. */
function prodItens_(itensTxt, obs) {
  var out = [];
  var ler = function (txt, sep, pularKits) {
    String(txt || '').split(sep).forEach(function (s) {
      s = s.trim(); if (!s) return;
      var m = s.match(/^(\d+)\s*x\s*(.+)$/i), q = m ? +m[1] : 1, nome = (m ? m[2] : s).trim();
      if (pularKits && PROD_KIT_RE.test(nome)) return;
      out.push({ nome: nome, q: q });
    });
  };
  ler(itensTxt, ';', true);
  var m = String(obs || '').match(PROD_SABORES_RE);
  if (m) ler(m[2], ';', false);
  return out;
}

function prodPedidos_() {
  var sh = sh_('Pedidos'), n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  var cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (c) { return String(c).trim(); });
  var col = function (nome) { var i = cab.indexOf(nome); if (i < 0) throw new Error('Aba Pedidos sem a coluna "' + nome + '".'); return i; };
  var cI = col('Itens'), cS = col('Status'), cO = col('Observação'), cId = col('ID');
  return sh.getRange(2, 1, n, cab.length).getValues().map(function (r) {
    return { itens: String(r[cI] || ''), status: String(r[cS] || '').trim(), obs: String(r[cO] || ''), id: String(r[cId] || '').trim() };
  }).filter(function (p) { return p.itens; });
}

/* Primeiro lançamento: guarda o momento de início e os pedidos em aberto (eles também entram no controle). */
function prodInicio_() {
  var pr = PropertiesService.getScriptProperties();
  if (pr.getProperty('PROD_INICIO_ID')) return;
  var id = 'P' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMddHHmmss');
  var abertos = prodPedidos_().filter(function (p) { return p.id && p.status !== 'Retirado' && p.status !== 'Cancelado'; }).map(function (p) { return p.id; });
  pr.setProperty('PROD_ABERTOS', abertos.join(',').slice(0, 8000));
  pr.setProperty('PROD_INICIO_ID', id);
}

function prodAba_() {
  var sh = sh_('Producao');
  if (!sh) {
    sh = ss_().insertSheet('Producao');
    sh.getRange(1, 1, 1, PROD_CAB.length).setValues([PROD_CAB]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), 2).setNumberFormat('@');   // data e produto como texto
    sh.getRange(1, 4, sh.getMaxRows(), 4).setNumberFormat('@');
  }
  return sh;
}

function prodChave_(nome) { return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function prodPin_(pin) {
  if (!apiIgual_(String(pin || '').trim(), String(config_().pin || '').trim())) throw new Error('PIN incorreto.');
}
