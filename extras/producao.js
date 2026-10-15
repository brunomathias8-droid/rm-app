/* ============ Controle de produção (17/10/2026) ============
   A Raquel lança o que produziu (congelado ou pronto) e, quando quiser, conta o estoque. Os pedidos reservam e,
   ao serem retirados, descontam sozinhos (Producao.gs). Caixas e kits contam pelos sabores escolhidos no pedido,
   gravados na Observação numa linha "Sabores: 3x Cookie de Nutella; 3x Cookie de Kinder Bueno". */
var PROD_KIT = /^(caixa|kit|assinatura)\b/;
var PROD_SAB = /(^|\n)\s*Sabores:\s*([^\n]*)/i;
function prodKit(nome) { return PROD_KIT.test(norm(nome)); }
function prodControlados() { return ((S.boot && S.boot.produtos) || []).filter(function (p) { return !prodKit(p.nome); }).map(function (p) { return p.nome; }); }
function prodLerItens(txt, sep, pularKits) {
  return String(txt || '').split(sep).map(function (s) { s = s.trim(); if (!s) return null; var m = s.match(/^(\d+)\s*x\s*(.+)$/i); return { q: m ? +m[1] : 1, nome: (m ? m[2] : s).trim() }; })
    .filter(function (x) { return x && !(pularKits && prodKit(x.nome)); });
}
/* Itens que contam no estoque (igual ao Producao.gs): produtos sem caixas e kits + sabores das caixas */
function prodItensPed(itens, obs) { var m = String(obs || '').match(PROD_SAB); return prodLerItens(itens, ';', true).concat(m ? prodLerItens(m[2], ';', false) : []); }
function prodSemSabores(obs) { return String(obs || '').replace(PROD_SAB, '').trim(); }
function prodSaboresDe(obs) { var m = String(obs || '').match(PROD_SAB), o = {}; if (m) prodLerItens(m[2], ';', false).forEach(function (x) { o[x.nome] = (o[x.nome] || 0) + x.q; }); return o; }

/* Situação por produto (chave norm): dados do servidor + pedidos que ainda estão saindo do aparelho */
function prodMapa() {
  if (!S.prod) return null;
  var m = {};
  S.prod.itens.forEach(function (x) { m[norm(x.nome)] = Object.assign({}, x); });
  if (typeof filaPendentes === 'function') filaPendentes().forEach(function (p) {
    prodItensPed(p.itens, p.obs).forEach(function (it) {
      var k = norm(it.nome), x = m[k] || (m[k] = { nome: it.nome, produzido: 0, entregue: 0, reservado: 0, estoque: 0, livre: 0, lancado: false });
      x.reservado += it.q; x.livre -= it.q;
    });
  });
  return m;
}
function prodCarregar(depois) {
  if (S.prodCarregando) return;
  if (!S.prod) S.prod = lerCache('getProducao', []);
  S.prodCarregando = true;
  call('getProducao').then(function (r) { S.prodCarregando = false; S.prod = r; if (depois) depois(); })
    .catch(function () { S.prodCarregando = false; });
}

/* ---------- Cartão na tela Hoje ---------- */
function prodCardHtml() {
  if (!S.prodT || Date.now() - S.prodT > 60000) { S.prodT = Date.now(); setTimeout(function () { prodCarregar(function () { if (S.view === 'hoje' && S.h) renderHoje(); }); }, 2500); }   // depois da Hoje, para não disputar o servidor
  var m = prodMapa(), cab = '<div class="sec"><h2>Produção</h2><button class="lk" onclick="prodSheet()">+ Lançar</button></div>';
  if (!m) return '';
  if (!S.prod.inicio) return cab + '<div class="card flat"><p class="muted" style="margin:0 0 12px">Lance o que foi produzido (congelado ou pronto) e o app mostra quanto ainda dá para vender. Os pedidos descontam sozinhos.</p><button class="btn sec" onclick="prodSheet()">' + ic('plus', 's') + 'Lançar produção</button></div>';
  var linhas = prodControlados().map(function (nome) { return m[norm(nome)] ? Object.assign({ rotulo: nome }, m[norm(nome)]) : null; })
    .filter(function (x) { return x && (x.lancado || x.reservado > 0); });
  if (!linhas.length) return cab + '<div class="card flat"><p class="muted" style="margin:0">Nada produzido nem reservado agora.</p></div>';
  return cab + '<div class="list prod-est">' + linhas.map(function (x) {
    var num = x.lancado ? (x.livre >= 0 ? '<b>' + x.livre + '</b><span>livre' + (x.livre === 1 ? '' : 's') + '</span>' : '<b class="neg">' + (-x.livre) + '</b><span>faltam</span>') : '<b class="nd">—</b><span>sem lançamento</span>';
    var sub = x.lancado ? x.estoque + ' no estoque · ' + x.reservado + ' em pedidos' : x.reservado + ' em pedidos';
    return '<div class="li tap" onclick="prodSheet(\'producao\', this.dataset.n)" data-n="' + esc(x.rotulo) + '"><div class="tx"><span>' + esc(x.rotulo) + '</span><small class="muted">' + sub + '</small></div><div class="pe-n">' + num + '</div></div>';
  }).join('') + '</div><div class="btns" style="margin-top:10px"><button class="btn sec" onclick="prodSheet(\'producao\')">Produzi</button><button class="btn ghost" onclick="prodSheet(\'contagem\')">Contar o estoque</button></div>';
}

/* ---------- Lançar produção ou contagem ---------- */
function prodSheet(tipo, produto) {
  tipo = tipo === 'contagem' ? 'contagem' : 'producao';
  var nomes = prodControlados(), sel = produto && nomes.indexOf(produto) >= 0 ? produto : '', m = prodMapa() || {};
  var html = '<h3>Produção</h3>' + seg('pTipo', [['producao', 'Produzi'], ['contagem', 'Contei o estoque']], tipo) +
    '<p class="desc" id="pDesc"></p><div class="fld"><span class="lab">Produto</span>' + chipsHtml('pProd', nomes, sel) + '</div>' +
    '<div class="fld"><label for="pQ" id="pQl"></label><div class="step big"><button type="button" class="mn" id="pMn" aria-label="Menos">' + ic('plus').replace('M12 5v14', '') + '</button><input id="pQ" inputmode="numeric" placeholder="0"><button type="button" class="plus" id="pMa" aria-label="Mais">' + ic('plus') + '</button></div><p class="muted" id="pInfo" style="margin:8px 0 0"></p></div>' +
    '<div class="btns"><button class="btn" id="pOk">Salvar</button><button class="btn ghost" id="pNo">Voltar</button></div>';
  var sh = sheet(html);
  var info = function () {
    var x = sel && m[norm(sel)];
    $('#pDesc', sh).textContent = tipo === 'producao' ? 'Quantas unidades ficaram prontas ou congeladas agora. Soma no estoque.' : 'Quantas unidades existem agora, contando no congelador. O app corrige a diferença.';
    $('#pQl', sh).textContent = tipo === 'producao' ? 'Quantidade produzida' : 'Quantidade contada';
    $('#pInfo', sh).textContent = !sel ? '' : !x || !x.lancado ? 'Primeiro lançamento deste produto.' : 'Hoje o app conta ' + x.estoque + ' no estoque, ' + x.reservado + ' em pedidos e ' + x.livre + ' livres.';
  };
  info();
  $$('#pTipo button', sh).forEach(function (b) { b.onclick = function () { tipo = b.dataset.k; $$('#pTipo button', sh).forEach(function (o) { o.classList.toggle('on', o === b); o.setAttribute('aria-selected', o === b); }); info(); }; });
  chipsSel($('#pProd', sh), function (v) { sel = v; info(); });
  var q = $('#pQ', sh), passo = function (d) { var v = Math.max(0, (parseInt(q.value, 10) || 0) + d); q.value = v; };
  $('#pMn', sh).onclick = function () { passo(-1); }; $('#pMa', sh).onclick = function () { passo(1); };
  $('#pNo', sh).onclick = fecharSheet;
  $('#pOk', sh).onclick = function () {
    var v = q.value.trim(), n = parseInt(v, 10);
    if (!sel) return toast('Escolha o produto', true);
    if (!/^\d+$/.test(v) || (tipo === 'producao' && n === 0)) { q.classList.add('falta'); setTimeout(function () { q.classList.remove('falta'); }, 600); return toast('Quantidade inválida', true); }
    var bt = this; bt.disabled = true; bt.textContent = 'Salvando…';
    call('salvarProducao', { produto: sel, q: n, tipo: tipo, pessoa: S.pessoa }).then(function (r) {
      S.prod = r; guardarCache('getProducao', [], r); fecharSheet();
      toast(tipo === 'producao' ? 'Lançado: ' + n + ' ' + sel : 'Contagem salva: ' + n + ' ' + sel);
      if (S.view === 'hoje' && S.h) renderHoje();
    }).catch(function (e) { bt.disabled = false; bt.textContent = 'Salvar'; fail(e); });
  };
}

/* ---------- Pedido novo: livres por produto e sabores das caixas ---------- */
function prodFormIni(f, b, pre, ed) {
  f.sab = pre ? prodSaboresDe(pre.obs) : {};
  f.prodEd = ed && emAberto(ed) ? prodItensPed(ed.itens, ed.obs) : [];   // edição: o próprio pedido já está reservado
  if (!S.prod || !S.prodT || Date.now() - S.prodT > 60000) { S.prodT = Date.now(); prodCarregar(function () { if ($('#prods') && f.atu) f.atu(); }); }
}
function prodKitsSel(f, b) { return b.produtos.filter(function (p, i) { return f.qt[i] && prodKit(p.nome) && !/^assinatura/.test(norm(p.nome)); }).map(function (p) { return { nome: p.nome, q: f.qt[b.produtos.indexOf(p)] }; }); }
function prodPrecisa(kits) {
  var c = 0, bo = 0;
  kits.forEach(function (k) { if (/assinatura/i.test(k.nome)) return; var m = k.nome.match(/(\d+)\s*(un|cookies)/i); c += k.q * (m ? +m[1] : 0); if (/bolo/i.test(k.nome)) bo += k.q; });
  return { cookies: c, bolos: bo };
}
function prodSabFalta(f, b) { var kits = prodKitsSel(f, b).filter(function (k) { return !/assinatura/i.test(k.nome); }); if (!kits.length) return false; for (var k in f.sab) if (f.sab[k] > 0) return false; return true; }
function prodObs(obs, f, b) {
  obs = prodSemSabores(obs);
  if (!prodKitsSel(f, b).length) return obs;
  var l = Object.keys(f.sab).filter(function (k) { return f.sab[k] > 0; }).map(function (k) { return f.sab[k] + 'x ' + k; });
  return l.length ? (obs ? obs + '\n' : '') + 'Sabores: ' + l.join('; ') : obs;
}
function prodForm(f, b, atualizar) {
  f.atu = atualizar;
  var m = prodMapa(), ed = {};
  (f.prodEd || []).forEach(function (x) { ed[norm(x.nome)] = (ed[norm(x.nome)] || 0) + x.q; });
  var resta = function (nome, usado) { var x = m && m[norm(nome)]; if (!x || !x.lancado) return null; return x.livre + (ed[norm(nome)] || 0) - usado; };
  b.produtos.forEach(function (p, i) {
    var el = $('#est' + i); if (!el) return;
    var r = prodKit(p.nome) ? null : resta(p.nome, (f.qt[i] || 0) + (f.sab[p.nome] || 0));
    el.textContent = r === null ? '' : r >= 0 ? r + ' livre' + (r === 1 ? '' : 's') : 'faltam ' + (-r);
    el.className = 'pr-est' + (r !== null && r < 0 ? ' neg' : '');
  });
  var box = $('#sabBox'); if (!box) return;
  var kits = prodKitsSel(f, b);
  if (!kits.length) { box.classList.add('hide'); box.innerHTML = ''; return; }
  var pr = prodPrecisa(kits), nomes = prodControlados(), c = 0, bo = 0;
  nomes.forEach(function (n) { var q = f.sab[n] || 0; if (/cookie/i.test(n)) c += q; else if (/bolo/i.test(n)) bo += q; });
  var alvo = [pr.cookies ? c + ' de ' + pr.cookies + ' cookies' : '', pr.bolos ? bo + ' de ' + pr.bolos + ' bolo' + (pr.bolos === 1 ? '' : 's') : ''].filter(String).join(' · ');
  box.classList.remove('hide');
  box.innerHTML = '<div class="sec" style="margin-top:14px"><h2>O que vai nas caixas</h2>' + (alvo ? '<span class="cnt">' + alvo + '</span>' : '') + '</div><div class="list">' + nomes.map(function (n, k) {
    var q = f.sab[n] || 0, i = b.produtos.map(function (p) { return p.nome; }).indexOf(n), r = resta(n, q + (f.qt[i] || 0));
    return '<div class="prod' + (q ? ' sel' : '') + '"><div class="grow"><div class="nm">' + esc(n) + '</div><div class="pr">' + (r === null ? '' : '<span class="pr-est' + (r < 0 ? ' neg' : '') + '">' + (r >= 0 ? r + ' livre' + (r === 1 ? '' : 's') : 'faltam ' + (-r)) + '</span>') + '</div></div>' +
      '<div class="step"><button type="button" class="mn" data-sm="' + k + '" aria-label="Menos ' + esc(n) + '">' + ic('plus').replace('M12 5v14', '') + '</button><output>' + q + '</output><button type="button" class="plus" data-sp="' + k + '" aria-label="Mais ' + esc(n) + '">' + ic('plus') + '</button></div></div>';
  }).join('') + '</div>';
  $$('[data-sp], [data-sm]', box).forEach(function (bt) { bt.onclick = function () {
    var n = nomes[+(bt.dataset.sp || bt.dataset.sm)]; f.sab[n] = Math.max(0, (f.sab[n] || 0) + (bt.dataset.sp ? 1 : -1)); atualizar();
  }; });
}
