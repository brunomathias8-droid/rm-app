/* ============ Pedidos novos em segundo plano (17/10/2026) ============
   Ao tocar Salvar, o pedido fica guardado no aparelho e a tela de "Pedido salvo" abre na hora.
   O envio continua sozinho e tenta de novo quando falha. Repetir é seguro: cada pedido leva o mesmo _rid,
   e o Api.gs devolve o resultado do primeiro envio em vez de gravar outra vez (vale por 6 horas). */
var FILA = { enviando: false, t: null, MAX_MS: 5 * 36e5 };
function filaLer(k) { try { return JSON.parse(store(k || 'filaPed') || '[]'); } catch (e) { return []; } }
function filaGravar(l, k) { store(k || 'filaPed', JSON.stringify(l)); filaAviso(); }
function filaPendentes() { return filaLer().map(function (x) { return x.p; }); }
function enfileirarPedido(p) { var l = filaLer(); l.push({ p: p, t: Date.now(), n: 0 }); filaGravar(l); setTimeout(filaEnviar, 50); }
function filaTirar(rid) { filaGravar(filaLer().filter(function (x) { return x.p._rid !== rid; })); }
function filaFalhou(it, motivo) {
  filaTirar(it.p._rid);
  var f = filaLer('filaFalhou'); f.push({ p: it.p, t: it.t, motivo: motivo }); filaGravar(f, 'filaFalhou');
  toast('O pedido de ' + primeiro(it.p.cliente) + ' não foi salvo. Toque no aviso no topo.', true);
}
function filaEnviar() {
  if (FILA.enviando || (!S.token && !window.MOCK)) return;
  var l = filaLer(); if (!l.length) return filaAviso();
  var it = l[0];
  if (Date.now() - it.t > FILA.MAX_MS) { filaFalhou(it, 'O servidor não confirmou em 5 horas. Confira em Pedidos se ele entrou antes de enviar de novo.'); return filaEnviar(); }
  FILA.enviando = true; it.n = (it.n || 0) + 1; filaGravar(l); clearTimeout(FILA.t);
  call('salvarPedido', it.p).then(function (r) {
    FILA.enviando = false; filaTirar(it.p._rid);
    var cl = (r && r.clube) || {}, b = S.boot, k = it.p.cliente.toLowerCase();
    if (cl.n && b) { b.clube = b.clube || {}; b.clube[k] = { n: cl.n, n60: (b.clube[k] || {}).n60 || 1 }; }
    S.h = null; S.ps = null; S.prodT = 0;
    if ((S.view === 'hoje' || S.view === 'pedidos') && !$('#sheet').classList.contains('open')) go(S.view, true);
    filaEnviar();
  }, function (e) {
    FILA.enviando = false;
    var cod = e && e.codigo;
    if (cod === 'VALIDACAO' || cod === 'ACAO' || (cod === 'ERRO' && it.n >= 5)) { filaFalhou(it, msgErro(e)); return filaEnviar(); }
    // sem internet, demora, sessão expirada ou servidor ocupado: tenta de novo mais tarde
    FILA.t = setTimeout(filaEnviar, Math.min(120000, 15000 * it.n));
    filaAviso();
  });
}
/* Aviso fixo no topo: pedidos enviando ou que não foram salvos */
function filaAviso() {
  var n = filaLer().length, f = filaLer('filaFalhou').length, el = $('#filaAv');
  if (!el) { el = document.createElement('button'); el.id = 'filaAv'; el.className = 'fila-av hide'; el.onclick = filaSheet; document.body.appendChild(el); }
  el.classList.toggle('hide', !n && !f); el.classList.toggle('err', !!f);
  el.innerHTML = f ? ic('alert', 's') + f + ' pedido' + (f === 1 ? '' : 's') + ' não salvo' + (f === 1 ? '' : 's') : ic('refresh', 's spin') + 'Enviando ' + n + ' pedido' + (n === 1 ? '' : 's') + '…';
}
function filaSheet() {
  var l = filaLer(), f = filaLer('filaFalhou');
  var li = function (x, k, falhou) {
    return '<div class="card flat" style="margin:0 0 10px"><b>' + esc(x.p.cliente) + '</b> · ' + brl(x.p.valor) + '<br><span class="muted">' + esc(itensCurto(x.p.itens)) + '</span>' +
      (falhou ? '<p style="margin:8px 0;color:var(--err)">' + esc(x.motivo) + '</p><div class="btns"><button class="btn sec" data-fr="' + k + '">Já conferi, enviar de novo</button><button class="btn ghost" data-fd="' + k + '">Descartar</button></div>'
        : '<p class="muted" style="margin:8px 0 0">' + (x.n ? x.n + 'ª tentativa. ' : '') + 'O app tenta sozinho até o servidor confirmar.</p>') + '</div>';
  };
  var sh = sheet('<h3>Pedidos no aparelho</h3>' +
    (f.length ? '<p class="desc">Estes não foram salvos. Veja em Pedidos se não entraram antes de enviar de novo.</p>' + f.map(function (x, k) { return li(x, k, true); }).join('') : '') +
    (l.length ? '<p class="desc">Enviando. Pode continuar usando o app.</p>' + l.map(function (x, k) { return li(x, k, false); }).join('') + '<button class="btn sec" id="fAgora">Tentar agora</button>' : '') +
    '<button class="btn ghost" id="fVer">Ver pedidos</button>');
  var ag = $('#fAgora', sh); if (ag) ag.onclick = function () { fecharSheet(); filaEnviar(); };
  $('#fVer', sh).onclick = function () { go('pedidos'); };
  $$('[data-fr]', sh).forEach(function (b) { b.onclick = function () {
    var f2 = filaLer('filaFalhou'), x = f2.splice(+b.dataset.fr, 1)[0]; filaGravar(f2, 'filaFalhou');
    x.p._rid = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);   // pedido conferido: envio novo
    enfileirarPedido(x.p); fecharSheet(); toast('Enviando de novo');
  }; });
  $$('[data-fd]', sh).forEach(function (b) { b.onclick = function () {
    confirmar('Descartar o pedido?', 'Ele sai deste aparelho. Se já estiver em Pedidos, continua lá.', 'Descartar', true).then(function (ok) {
      if (!ok) return; var f2 = filaLer('filaFalhou'); f2.splice(+b.dataset.fd, 1); filaGravar(f2, 'filaFalhou'); toast('Descartado');
    });
  }; });
}
window.addEventListener('online', function () { setTimeout(filaEnviar, 1000); });
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') setTimeout(filaEnviar, 1500); });
setInterval(filaEnviar, 60000);
setTimeout(function () { filaAviso(); filaEnviar(); }, 3000);
