/**
 * Custos.gs — custos e margem por produto (SKU), fichas técnicas e insumos editados pelo app (24/10/2026).
 *
 * A Raquel e o Bruno analisam custo e margem de cada produto e cadastram ou ajustam, sem abrir a planilha:
 *   Fichas técnicas  A Produto · B Preço · G Unidades por lote · L Status do preço (C, D, E e M são calculados)
 *   Receitas         A Produto · B Insumo ou produto componente · C Quantidade por lote (D e E têm fórmulas: não mexer)
 *   Insumos          A Insumo · B Categoria · C Unidade · D Qtd. na embalagem · E Preço pago · G Última compra · H Fornecedor · I Contar
 * O cálculo (custosCalcular_) é o mesmo do recálculo das Fichas técnicas (recalcFichas_, em Gestao.gs).
 * Nada apaga linhas: linha de receita que sai fica em branco; produto novo desfeito fica com a linha em branco.
 * Produto com status "Fora do cardápio" sai da tela de pedido (getBootstrap), sem apagar.
 */
var CUSTOS_STATUS = ['Praticado', 'A validar', 'Fora do cardápio'];
var CUSTOS_CATS = ['Ingrediente', 'Embalagem'];
var CUSTOS_UNS = ['g', 'ml', 'un'];
var FICHAS_NOTA_RE = /^Custo automático/i;   // nota no fim da aba Fichas técnicas (não é produto)

/* ------------------------------ funções chamadas pelo app (PIN como 1º argumento) ------------------------------ */

function getCustos(pin) {
  checkPin_(pin);
  return custosResumo_();
}

/**
 * f = { nomeOriginal (vazio = ficha nova), nome, preco, lote, status, receita: [{ comp, q }] }.
 * Devolve { custos, anterior } — anterior é a ficha como estava (para o Desfazer); null se a ficha é nova.
 */
function salvarFicha(pin, f) {
  checkPin_(pin);
  f = f || {};
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  var anterior = null;
  try {
    var d = custosLer_(), v = custosValidarFicha_(f, d);
    var orig = v.nomeOriginal ? d.produtos[chave_(v.nomeOriginal)] : null;
    if (v.nomeOriginal && !orig) throw new Error('Produto não encontrado: ' + v.nomeOriginal + '. Atualize a tela.');
    if (orig) anterior = { nomeOriginal: v.nome, nome: orig.nome, preco: orig.preco, lote: orig.lote, status: orig.status, receita: orig.receita.map(function (x) { return { comp: x.comp, q: x.q }; }) };
    var ft = sh_('Fichas técnicas'), row = orig ? orig.row : custosLinhaNovaFicha_(ft, d);
    ft.getRange(row, 1, 1, 2).setValues([[v.nome, v.preco]]);
    ft.getRange(row, 2).setNumberFormat('"R$" #,##0.00');
    ft.getRange(row, 7).setValue(v.lote);
    ft.getRange(row, 12).setValue(v.status);
    custosGravarReceita_(orig ? orig.nome : v.nome, v.nome, v.receita);
    if (orig && orig.nome !== v.nome) custosRenomearComponente_(orig.nome, v.nome);   // caixas e kits que usam o produto
  } finally { lock.releaseLock(); }
  return { custos: custosResumo_(), anterior: anterior };
}

/** Desfaz uma ficha nova: limpa a linha e a receita. Recusa se algum pedido já usa o produto. */
function desfazerFichaNova(pin, nome) {
  checkPin_(pin);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var d = custosLer_(), p = d.produtos[chave_(nome)];
    if (!p) throw new Error('Produto não encontrado (já desfeito?).');
    if (custosVendas_(d).todos[chave_(nome)]) throw new Error('Já existe pedido com este produto: use "Fora do cardápio" em vez de desfazer.');
    sh_('Fichas técnicas').getRange(p.row, 1, 1, 13).clearContent();
    custosGravarReceita_(p.nome, null, []);
  } finally { lock.releaseLock(); }
  return { custos: custosResumo_() };
}

/**
 * i = { nomeOriginal (vazio = insumo novo), nome, cat, un, qtdEmb, preco, fornecedor, contar }.
 * Devolve { custos, anterior } (anterior = insumo como estava, para o Desfazer; null se é novo).
 */
function salvarInsumo(pin, i) {
  checkPin_(pin);
  i = i || {};
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  var anterior = null;
  try {
    var d = custosLer_(), v = custosValidarInsumo_(i, d);
    var orig = v.nomeOriginal ? d.insumos[chave_(v.nomeOriginal)] : null;
    if (v.nomeOriginal && !orig) throw new Error('Insumo não encontrado: ' + v.nomeOriginal + '. Atualize a tela.');
    if (orig) anterior = { nomeOriginal: v.nome, nome: orig.nome, cat: orig.cat, un: orig.un, qtdEmb: orig.qtdEmb, preco: orig.preco, fornecedor: orig.fornecedor, contar: orig.contar, ultima: orig.ultima };
    var sh = sh_('Insumos'), row = orig ? orig.row : custosLinhaNovaInsumo_(sh);
    sh.getRange(row, 1, 1, 5).setValues([[v.nome, v.cat, v.un, v.qtdEmb === null ? '' : v.qtdEmb, v.preco === null ? '' : v.preco]]);
    sh.getRange(row, 5).setNumberFormat('"R$" #,##0.00');
    var mudouPreco = !orig || orig.qtdEmb !== v.qtdEmb || orig.preco !== v.preco;
    if (v.ultima) sh.getRange(row, 7).setValue(parseD_(v.ultima)).setNumberFormat('dd/mm/yyyy');
    else if (mudouPreco && v.preco !== null) sh.getRange(row, 7).setValue(parseD_(today_())).setNumberFormat('dd/mm/yyyy');
    sh.getRange(row, 8, 1, 2).setValues([[v.fornecedor, v.contar ? 'Sim' : 'Não']]);
    if (orig && orig.nome !== v.nome) custosRenomearComponente_(orig.nome, v.nome);
  } finally { lock.releaseLock(); }
  return { custos: custosResumo_(), anterior: anterior };
}

/** Desfaz um insumo novo: limpa a linha. Recusa se alguma receita já usa o insumo. */
function desfazerInsumoNovo(pin, nome) {
  checkPin_(pin);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var d = custosLer_(), x = d.insumos[chave_(nome)];
    if (!x) throw new Error('Insumo não encontrado (já desfeito?).');
    if (custosUsos_(d)[chave_(nome)]) throw new Error('Este insumo já está numa receita: tire da receita antes.');
    sh_('Insumos').getRange(x.row, 1, 1, 5).clearContent();
    sh_('Insumos').getRange(x.row, 7, 1, 3).clearContent();
  } finally { lock.releaseLock(); }
  return { custos: custosResumo_() };
}

/* ------------------------------ leitura e cálculo ------------------------------ */

/** Linhas de produto da aba Fichas técnicas (pula linhas em branco e a nota do fim). */
function fichasLinhas_() {
  var ft = sh_('Fichas técnicas'), last = ft.getLastRow(), out = { linhas: [], notaRow: 0, ultimaRow: 1 };
  if (last < 2) return out;
  ft.getRange(2, 1, last - 1, 13).getValues().forEach(function (r, i) {
    var nome = String(r[0] || '').trim();
    if (!nome) return;
    if (FICHAS_NOTA_RE.test(nome)) { if (!out.notaRow) out.notaRow = i + 2; return; }
    out.linhas.push({ row: i + 2, v: r });
    out.ultimaRow = i + 2;
  });
  return out;
}

function custosLer_() {
  var fl = fichasLinhas_(), produtos = {}, insumos = {}, receitas = {};
  fl.linhas.forEach(function (l) {
    var r = l.v, nome = String(r[0]).trim();
    produtos[chave_(nome)] = { row: l.row, nome: nome, preco: custosNum_(r[1]), lote: custosNum_(r[6]), status: String(r[11] || '').trim(), receita: [] };
  });
  var si = sh_('Insumos'), ni = si.getLastRow() - 1;
  if (ni > 0) si.getRange(2, 1, ni, 9).getValues().forEach(function (r, i) {
    var nome = String(r[0] || '').trim(); if (!nome) return;
    var q = custosNum_(r[3]), p = custosNum_(r[4]);
    insumos[chave_(nome)] = { row: i + 2, nome: nome, cat: String(r[1] || '').trim(), un: String(r[2] || '').trim(), qtdEmb: q, preco: p,
      custo: q > 0 && p !== null && p >= 0 ? p / q : null, ultima: iso_(r[6]), fornecedor: String(r[7] || '').trim(), contar: /^s/i.test(String(r[8] || '').trim()) };
  });
  var sr = sh_('Receitas'), nr = sr.getLastRow() - 1;
  if (nr > 0) sr.getRange(2, 1, nr, 3).getValues().forEach(function (r, i) {
    var prod = String(r[0] || '').trim(), comp = String(r[1] || '').trim(), q = custosNum_(r[2]);
    if (!prod || !comp) return;
    var linha = { row: i + 2, comp: comp, q: q };
    (receitas[chave_(prod)] = receitas[chave_(prod)] || []).push(linha);
    if (produtos[chave_(prod)]) produtos[chave_(prod)].receita.push(linha);
  });
  return { produtos: produtos, insumos: insumos, receitas: receitas, fichas: fl };
}

/**
 * Custo por unidade de cada produto: { chave: { ins, emb, total, falta: [motivos], linhas: [{ comp, q, un, tipo, custo }] } }.
 * Produto usado como componente entra como insumo (igual ao recálculo). Sem receita ou sem lote: total null.
 */
function custosCalcular_(d) {
  var memo = {};
  function calc(k, pilha) {
    if (memo[k]) return memo[k];
    var p = d.produtos[k], out = { ins: 0, emb: 0, total: null, falta: [], linhas: [] };
    if (!p) return out;
    if (pilha[k]) { out.falta.push('receita circular'); return out; }
    pilha[k] = true;
    p.receita.forEach(function (x) {
      var kc = chave_(x.comp), i = d.insumos[kc], linha = { comp: x.comp, q: x.q, un: '', tipo: '', custo: null };
      if (!(x.q > 0)) out.falta.push('quantidade de ' + x.comp);
      else if (i) {
        linha.tipo = i.cat === 'Embalagem' ? 'embalagem' : 'insumo'; linha.un = i.un;
        if (i.custo === null) out.falta.push(x.comp + ' sem preço');
        else { linha.custo = x.q * i.custo; if (i.cat === 'Embalagem') out.emb += linha.custo; else out.ins += linha.custo; }
      } else if (d.produtos[kc]) {
        linha.tipo = 'produto'; linha.un = 'un';
        var c = calc(kc, pilha);
        if (c.total === null) out.falta.push(x.comp + ' sem custo');
        else { linha.custo = x.q * c.total; out.ins += linha.custo; }
      } else out.falta.push(x.comp + ' não cadastrado');
      out.linhas.push(linha);
    });
    delete pilha[k];
    if (!p.receita.length) out.falta.unshift('sem receita');
    if (!(p.lote > 0)) out.falta.unshift('sem unidades por lote');
    if (!out.falta.length) { out.ins /= p.lote; out.emb /= p.lote; out.total = out.ins + out.emb; }
    return (memo[k] = out);
  }
  var r = {};
  Object.keys(d.produtos).forEach(function (k) { r[k] = calc(k, {}); });
  return r;
}

/* Vendas do mês por produto (pedidos não cancelados) e quais produtos já têm pedido */
function custosVendas_(d) {
  var hoje = today_(), ini = hoje.slice(0, 7) + '-01', mes = {}, todos = {};
  readPedidos_().forEach(function (p) {
    if (p.status === 'Cancelado') return;
    parseItens_(p.itens).forEach(function (it) {
      var k = chave_(it.nome); todos[k] = true;
      if (p.data >= ini && p.data <= hoje) mes[k] = (mes[k] || 0) + it.q;
    });
  });
  return { mes: mes, todos: todos };
}

/* Onde cada insumo ou produto aparece nas receitas: { chaveComp: [{ produto, q }] } */
function custosUsos_(d) {
  var u = {};
  Object.keys(d.produtos).forEach(function (k) {
    d.produtos[k].receita.forEach(function (x) { if (x.q > 0) (u[chave_(x.comp)] = u[chave_(x.comp)] || []).push({ produto: d.produtos[k].nome, q: x.q }); });
  });
  return u;
}

function custosResumo_() {
  var d = custosLer_(), c = custosCalcular_(d), v = custosVendas_(d), u = custosUsos_(d), r2 = function (x) { return x === null ? null : Math.round(x * 10000) / 10000; };
  var produtos = Object.keys(d.produtos).map(function (k) {
    var p = d.produtos[k], x = c[k], margem = x.total !== null && p.preco !== null ? p.preco - x.total : null;
    return { nome: p.nome, preco: p.preco, lote: p.lote, status: p.status, custo: r2(x.total), ins: x.total === null ? null : r2(x.ins), emb: x.total === null ? null : r2(x.emb),
      margem: r2(margem), pct: margem !== null && p.preco > 0 ? margem / p.preco : null, falta: x.falta,
      receita: x.linhas.map(function (l) { return { comp: l.comp, q: l.q, un: l.un, tipo: l.tipo, custo: r2(l.custo) }; }),
      vendidosMes: v.mes[k] || 0, temPedido: !!v.todos[k] };
  });
  var insumos = Object.keys(d.insumos).map(function (k) {
    var i = d.insumos[k];
    return { nome: i.nome, cat: i.cat, un: i.un, qtdEmb: i.qtdEmb, preco: i.preco, custo: i.custo === null ? null : Math.round(i.custo * 1e6) / 1e6, ultima: i.ultima,
      fornecedor: i.fornecedor, contar: i.contar, usadoEm: u[k] || [] };
  }).sort(function (a, b) { return a.nome.localeCompare(b.nome); });
  return { hoje: today_(), produtos: produtos, insumos: insumos, status: CUSTOS_STATUS, cats: CUSTOS_CATS, uns: CUSTOS_UNS };
}

/* ------------------------------ gravação ------------------------------ */

function custosValidarFicha_(f, d) {
  var nome = String(f.nome || '').replace(/[;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!nome) throw new Error('Informe o nome do produto.');
  if (FICHAS_NOTA_RE.test(nome)) throw new Error('Nome inválido.');
  var nomeOriginal = String(f.nomeOriginal || '').trim();
  var outro = d.produtos[chave_(nome)];
  if (outro && chave_(nome) !== chave_(nomeOriginal)) throw new Error('Já existe um produto com o nome "' + outro.nome + '".');
  if (d.insumos[chave_(nome)]) throw new Error('Já existe um insumo com o nome "' + nome + '": use outro nome para o produto.');
  var preco = custosNum_(f.preco), lote = custosNum_(f.lote);
  if (preco === null || preco < 0 || preco > 100000) throw new Error('Preço inválido.');
  if (lote === null || !(lote > 0) || lote > 100000) throw new Error('Informe quantas unidades o lote rende (1 para caixas e kits).');
  var status = String(f.status || '').trim().slice(0, 40) || 'A validar';
  if (/[\r\n]/.test(status)) throw new Error('Status inválido.');
  var vistos = {}, receita = (Array.isArray(f.receita) ? f.receita : []).slice(0, 60).map(function (x) {
    var comp = String(x && x.comp || '').trim(), q = custosNum_(x && x.q), kc = chave_(comp);
    if (!comp) return null;
    if (!d.insumos[kc] && !d.produtos[kc]) throw new Error('"' + comp + '" não é insumo nem produto cadastrado.');
    if (kc === chave_(nome) || (nomeOriginal && kc === chave_(nomeOriginal))) throw new Error('O produto não pode entrar na própria receita.');
    if (q === null || !(q > 0) || q > 100000) throw new Error('Quantidade inválida de ' + comp + '.');
    if (vistos[kc]) throw new Error(comp + ' aparece duas vezes na receita: some as quantidades numa linha só.');
    vistos[kc] = true;
    return { comp: (d.insumos[kc] || d.produtos[kc]).nome, q: q };
  }).filter(Boolean);
  return { nomeOriginal: nomeOriginal, nome: nome, preco: preco, lote: lote, status: status, receita: receita };
}

function custosValidarInsumo_(i, d) {
  var nome = String(i.nome || '').replace(/[;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!nome) throw new Error('Informe o nome do insumo.');
  var nomeOriginal = String(i.nomeOriginal || '').trim(), outro = d.insumos[chave_(nome)];
  if (outro && chave_(nome) !== chave_(nomeOriginal)) throw new Error('Já existe um insumo com o nome "' + outro.nome + '".');
  if (d.produtos[chave_(nome)]) throw new Error('Já existe um produto com o nome "' + nome + '": use outro nome para o insumo.');
  var cat = CUSTOS_CATS.indexOf(i.cat) >= 0 ? i.cat : null, un = CUSTOS_UNS.indexOf(i.un) >= 0 ? i.un : null;
  if (!cat) throw new Error('Escolha a categoria: Ingrediente ou Embalagem.');
  if (!un) throw new Error('Escolha a unidade: g, ml ou un.');
  var q = i.qtdEmb === '' || i.qtdEmb === null || i.qtdEmb === undefined ? null : custosNum_(i.qtdEmb);
  var p = i.preco === '' || i.preco === null || i.preco === undefined ? null : custosNum_(i.preco);
  if (q !== null && !(q > 0 && q <= 1e7)) throw new Error('Quantidade da embalagem inválida.');
  if (p !== null && !(p >= 0 && p <= 100000)) throw new Error('Preço inválido.');
  if ((q === null) !== (p === null)) throw new Error('Informe a quantidade da embalagem e o preço pago juntos.');
  var ultima = /^\d{4}-\d{2}-\d{2}$/.test(String(i.ultima || '')) ? String(i.ultima) : '';
  return { nomeOriginal: nomeOriginal, nome: nome, cat: cat, un: un, qtdEmb: q, preco: p, fornecedor: String(i.fornecedor || '').trim().slice(0, 80), contar: !!i.contar, ultima: ultima };
}

/* Linha para ficha nova: primeira em branco entre os produtos e a nota; sem espaço, insere antes da nota (ou no fim). */
function custosLinhaNovaFicha_(ft, d) {
  var fim = d.fichas.notaRow || (d.fichas.ultimaRow + 2);
  if (fim > 2) {
    var v = ft.getRange(2, 1, fim - 2, 1).getValues();
    for (var i = 0; i < v.length; i++) if (!String(v[i][0]).trim()) return i + 2;
  }
  if (d.fichas.notaRow) { ft.insertRowBefore(d.fichas.notaRow); return d.fichas.notaRow; }
  return d.fichas.ultimaRow + 1;
}

/* Linha para insumo novo: primeira em branco (as fórmulas da coluna F vão até a linha 200) ou a seguinte à última. */
function custosLinhaNovaInsumo_(sh) {
  var last = sh.getLastRow();
  if (last >= 2) {
    var v = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < v.length; i++) if (!String(v[i][0]).trim()) return i + 2;
  }
  return last + 1;
}

/** Troca as linhas da receita do produto (nomeAntigo) pelas novas, com o nome novo. Só mexe em A:C (D e E têm fórmulas). */
function custosGravarReceita_(nomeAntigo, nomeNovo, receita) {
  var sh = sh_('Receitas'), last = sh.getLastRow(), k = chave_(nomeAntigo);
  var v = last >= 2 ? sh.getRange(2, 1, last - 1, 3).getValues() : [];
  var minhas = [], livres = [];
  v.forEach(function (r, i) {
    var a = String(r[0] || '').trim(), b = String(r[1] || '').trim();
    if (a && chave_(a) === k) minhas.push(i + 2);
    else if (!a && !b && r[2] === '') livres.push(i + 2);
  });
  var proxima = last + 1;
  receita.forEach(function (x, j) {   // reaproveita as linhas do produto, depois as em branco, depois o fim
    var row = j < minhas.length ? minhas[j] : (livres.length ? livres.shift() : proxima++);
    sh.getRange(row, 1, 1, 3).setValues([[nomeNovo, x.comp, x.q]]);
  });
  for (var m = receita.length; m < minhas.length; m++) sh.getRange(minhas[m], 1, 1, 3).clearContent();   // linha que sai fica em branco
}

/* Nome trocado: atualiza as receitas que usam o produto ou o insumo como componente */
function custosRenomearComponente_(antigo, novo) {
  var sh = sh_('Receitas'), last = sh.getLastRow(), k = chave_(antigo);
  if (last < 2) return;
  var col = sh.getRange(2, 2, last - 1, 1).getValues(), mudou = false;
  col.forEach(function (r) { if (String(r[0] || '').trim() && chave_(r[0]) === k) { r[0] = novo; mudou = true; } });
  if (mudou) sh.getRange(2, 2, last - 1, 1).setValues(col);
}

function custosNum_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  var s = String(v).replace(/[R$\s]/g, '');
  if (/,/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  var n = Number(s);
  return isFinite(n) ? n : null;
}
