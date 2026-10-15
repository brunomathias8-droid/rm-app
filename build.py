#!/usr/bin/env python3
"""Gera index.html (app PWA no GitHub Pages) a partir do Index.html do Apps Script.
Fonte única das telas: Index.html (pasta do Apps Script). Rode: python3 build.py <caminho do Index.html>
O que muda: chamadas ao servidor por fetch (API com token), login pessoa + PIN, cache local para abrir na hora,
manifest, ícones, service worker e área segura do iPhone."""
import sys, re, pathlib
src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else str(pathlib.Path(__file__).with_name('fonte') / 'Index.html')).read_text()
t = src
def rep(a, b, n=1):
    global t
    assert t.count(a) >= 1, 'não encontrado: ' + a[:90]
    t = t.replace(a, b) if n == 0 else t.replace(a, b, n)

# 1. Cabeçalho: sem <base target=_top>; manifest, ícones e metas de app instalado
rep('<base target="_top">\n', '')
rep('<meta name="theme-color" content="#4E1730">',
    '<meta name="theme-color" content="#4E1730">\n<title>RM</title>\n<link rel="manifest" href="manifest.webmanifest">\n'
    '<link rel="icon" type="image/png" sizes="192x192" href="icones/icone-192.png">\n<link rel="apple-touch-icon" href="icones/apple-touch-icon.png">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n<meta name="apple-mobile-web-app-title" content="RM">\n'
    '<script src="config.js"></script>')
# 2. Área segura (notch) no topo
rep('--top:54px;', '--top:calc(54px + env(safe-area-inset-top,0px));')
rep('.top{position:fixed;top:0;left:0;right:0;z-index:20;height:var(--top);', '.top{position:fixed;top:0;left:0;right:0;z-index:20;height:var(--top);padding-top:env(safe-area-inset-top,0px)!important;')

# 2b. Entrada das telas sem transparência: no iPhone a animação pode ficar parada no começo quando o app abre
#     ou volta do segundo plano, e a tela ficava invisível até tocar numa aba
rep('@keyframes in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}', '@keyframes in{from{transform:translateY(6px)}to{transform:none}}')

# 3. Servidor: fetch na API com token (o MOCK continua para os testes)
old_call = t[t.index('function callRaw(fn, args) {'):t.index('function msgErro(e)')]
new_call = r'''function callRaw(fn, args) {
  if (window.MOCK) return window.MOCK[fn].apply(null, ['tk'].concat(args));
  return api({ acao: 'rpc', token: S.token, fn: fn, args: args || [] }).then(function (d) { guardarCache(fn, args, d); return d; });
}
/* API do Apps Script: POST com JSON em text/plain (evita a pré-verificação de CORS). Erro de sessão volta ao login. */
function api(corpo) {
  var url = (window.RM_CONFIG && RM_CONFIG.api) || '';   // só o config.js: endereço vindo de link levaria o token e o PIN para outro servidor
  if (!url) return Promise.reject(new Error('Endereço do servidor não configurado (config.js).'));
  var ctl = window.AbortController ? new AbortController() : null, tm = setTimeout(function () { if (ctl) ctl.abort(); }, 45000);
  return fetch(url, { method: 'POST', body: JSON.stringify(corpo), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctl ? ctl.signal : undefined })
    .then(function (r) { clearTimeout(tm); if (!r.ok) throw new Error('Servidor respondeu ' + r.status + '. Tente de novo.'); return r.json().catch(function () { throw new Error('O servidor respondeu, mas não pelo Api.gs (falta publicar a versão nova?).'); }); },
      function (e) { clearTimeout(tm); if (e && e.name === 'AbortError') throw new Error('timeout'); if (navigator.onLine === false) throw new Error('Failed to fetch');
        var x = new Error('O servidor não atendeu o app. Confira em Implantar › Gerenciar implantações se a versão nova foi publicada, com acesso "Qualquer pessoa", e se o endereço é o mesmo do config.js.'); x.codigo = 'SERVIDOR'; throw x; })
    .then(function (j) {
      if (j === null || typeof j !== 'object') throw new Error('Resposta inesperada do servidor.');
      if (j && j.ok) return j.dados;
      var e = new Error((j && j.erro) || 'Erro no servidor'); e.codigo = j && j.codigo;
      if (e.codigo === 'SESSAO' && S.token) { sairLocal(); telaPin(); toast('Sessão expirada. Digite o PIN de novo.', true); }
      throw e;
    });
}
/* Cache local: as telas abrem na hora com os últimos dados e atualizam quando o servidor responde */
var CACHE_FNS = { getProducao: 1, getBootstrap: 1, getHoje: 1, getPedidosAbertos: 1, getPedidosHistorico: 1, getRoadmap: 1, getAcoes: 1, getPainel: 1, getMensagens: 1, getEstoque: 1, getAjuda: 1 };
function chaveCache(fn, args) { return 'c_' + fn + ':' + JSON.stringify(args || []); }
function guardarCache(fn, args, d) { if (CACHE_FNS[fn]) store(chaveCache(fn, args), JSON.stringify({ t: Date.now(), d: d })); }
function lerCache(fn, args) { try { var o = JSON.parse(store(chaveCache(fn, args)) || 'null'); return o && o.d; } catch (e) { return null; } }
function limparCache() { try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('rm_c_') === 0) localStorage.removeItem(k); }); } catch (e) {} }
function sairLocal() { store('token', ''); S.token = null; limparCache(); S.boot = S.h = S.ps = S.hist = null; }
'''
t = t.replace(old_call, new_call)
rep("function fail(e) { var m = msgErro(e); if (/PIN/.test(m)) { store('pin', ''); S.pin = null; telaPin(); } toast(m, true); }",
    "function fail(e) { if (e && e.codigo === 'SESSAO') return; toast(msgErro(e), true); }")
rep("function erroTela(e, retry) {\n", "function erroTela(e, retry) {\n  if (e && e.codigo === 'SESSAO') return;\n")

# 4. Entrada: pessoa → PIN → token. Abre com cache, atualiza em seguida.
old_start = t[t.index('function start() {'):t.index('/* Marca final (03/10/2026)')]
new_start = r'''function start() {
  try { localStorage.removeItem('rm_api'); } catch (e) {}   // apaga o endereço guardado pelo antigo ?api= (não é mais aceito)
  S.token = store('token'); S.pessoa = store('pessoa');
  if (!S.pessoa) return telaPessoa();
  if (!S.token) return telaPin();
  var cb = lerCache('getBootstrap', []);
  if (cb && !S.boot) {   // abre na hora com os dados guardados
    S.boot = cb; S.h = S.h || lerCache('getHoje', [S.pessoa]); S.ps = S.ps || lerCache('getPedidosAbertos', []);
    $('#tabs').classList.remove('hide'); go(S.view);
  } else if (!S.boot) $('#app').innerHTML = esqueleto();
  call('getBootstrap').then(function (b) { var primeira = !S.boot || !$('#tabs') || $('#tabs').classList.contains('hide'); S.boot = b; $('#tabs').classList.remove('hide'); if (primeira) go(S.view); })
    .catch(function (e) { if (e && e.codigo === 'SESSAO') return telaPin(); if (!S.boot) erroTela(e, start); else toast(msgErro(e), true); });
}
'''
t = t.replace(old_start, new_start)
old_pin = t[t.index('function telaPin() {'):t.index('function telaPessoa() {')]
new_pin = r'''function telaPin() {
  $('#tabs').classList.add('hide');
  if (!S.pessoa) return telaPessoa();
  $('#app').innerHTML = '<div class="page">' + heroMarca() + avisoInstalar() + '<div class="card"><p class="muted" style="margin:0 0 10px">Entrando como <b>' + esc(S.pessoa) + '</b> · <button class="lk" id="outraP" style="border:0;background:none;color:var(--ameixa);padding:0;text-decoration:underline">trocar</button></p><div class="fld"><label for="pin">PIN de acesso</label><input id="pin" class="pinput" type="password" inputmode="numeric" maxlength="8" autocomplete="current-password" enterkeyhint="go"></div><button class="btn" id="okPin">Entrar</button></div></div>';
  $('#outraP').onclick = function () { store('pessoa', ''); S.pessoa = null; telaPessoa(); };
  var entrar = function () {
    var v = $('#pin').value.trim(); if (!v) return $('#pin').focus();
    var b = $('#okPin'); b.disabled = true; b.textContent = 'Entrando…';
    var login = window.MOCK ? Promise.resolve({ token: 'tk', boot: null }) : api({ acao: 'login', pessoa: S.pessoa, pin: v, aparelho: (navigator.userAgent || '').slice(0, 120) });
    login.then(function (r) { store('token', r.token); S.token = r.token; if (r.boot) { S.boot = r.boot; guardarCache('getBootstrap', [], r.boot); } $('#tabs').classList.remove('hide'); S.view = 'hoje'; go('hoje'); })
      .catch(function (e) { b.disabled = false; b.textContent = 'Entrar'; var pi = $('#pin'); pi.value = ''; pi.classList.add('falta'); setTimeout(function () { pi.classList.remove('falta'); }, 400); toast(msgErro(e), true); });
  };
  $('#okPin').onclick = entrar;
  $('#pin').onkeydown = function (e) { if (e.key === 'Enter') entrar(); };
}
/* No iPhone, só o app instalado na tela de início guarda os dados e (depois) recebe avisos */
function avisoInstalar() {
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent || ''), inst = window.navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  if (!ios || inst) return '';
  return '<div class="card" style="background:var(--rosaC);border:0"><b>Instale o app na tela de início</b><p class="muted" style="margin:6px 0 0">No Safari, toque em Compartilhar (quadrado com seta) e depois em <b>Adicionar à Tela de Início</b>. Abra pelo ícone RM.</p></div>';
}
'''
t = t.replace(old_pin, new_pin)
rep("$$('[data-p]').forEach(function (b) { b.onclick = function () { store('pessoa', b.dataset.p); S.pessoa = b.dataset.p; start(); }; });",
    "$$('[data-p]').forEach(function (b) { b.onclick = function () { var nova = b.dataset.p; if (nova !== store('pessoa')) { sairLocal(); } store('pessoa', nova); S.pessoa = nova; start(); }; });")
rep("$('#troca').onclick = function () { store('pessoa', ''); S.pessoa = null; S.h = null; start(); };",
    "$('#troca').onclick = function () { if (!window.MOCK && S.token) api({ acao: 'sair', token: S.token }).catch(function () {}); sairLocal(); store('pessoa', ''); S.pessoa = null; start(); };")

# 3b. Pedido novo em segundo plano (extras/fila.js): a tela de sucesso abre na hora e o envio continua sozinho.
#     Um código por formulário (_rid): repetir o envio não grava o pedido duas vezes (Api.gs confere)
rep("""    call('salvarPedido', p).then(function (r) {
      var k = p.cliente.toLowerCase(), cl = (r && r.clube) || {};
      if (cl.n) { b.clube = b.clube || {}; b.clube[k] = { n: cl.n, n60: ((b.clube[k] || {}).n60 || 0) + 1 }; }
      S.h = null; S.ps = null;
      sucessoPedido(p, cl);
    }).catch(function (e) { bt.disabled = false; bt.textContent = 'Salvar'; fail(e); });""",
"""    p._rid = f.rid || (f.rid = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
    var k = p.cliente.toLowerCase(), c0 = (b.clube || {})[k], cl = {};
    if (hoje >= '2026-10-19') { var n60 = (c0 ? c0.n60 : 0) + 1; cl = { n: (c0 ? c0.n : 0) + 1 }; cl.mimo = cl.n % 5 === 0; cl.convite = n60 === 3; b.clube = b.clube || {}; b.clube[k] = { n: cl.n, n60: n60 }; }
    S.h = null; S.ps = null;
    enfileirarPedido(p);
    sucessoPedido(p, cl);""")
# 3c. Controle de produção (extras/producao.js): cartão na Hoje, item no menu +, livres e sabores das caixas no pedido
rep("  var pend = h.tarefas.filter(", "  html += prodCardHtml();\n  var pend = h.tarefas.filter(")
rep("""'<button class="mi" data-g="despesa">""", """'<button class="mi" data-g="producao"><span class="ic">' + ic('box') + '</span><span><b>Produção</b><span>O que ficou pronto ou congelado</span></span></button>' +
    '<button class="mi" data-g="despesa">""")
rep("if (b.dataset.g === 'tarefa')", "if (b.dataset.g === 'producao') { fecharSheet(); setTimeout(function () { prodSheet(); }, 260); } else if (b.dataset.g === 'tarefa')")
rep("""+ '</div><div class="pr">' + brl(p.preco, true) + '</div></div>""", """+ '</div><div class="pr">' + brl(p.preco, true) + ' <span class="pr-est" id="est' + i + '"></span></div></div>""")
rep("Item fora do cardápio</button></div>' +", "Item fora do cardápio</button></div><div id=\"sabBox\" class=\"hide\"></div>' +")
rep("  function extrasHtml() {", "  prodFormIni(f, b, pre, ed);\n  function extrasHtml() {")
rep("  function atualizar() {\n    var v = total(), n = nItens(), m = faltando();", "  function atualizar() {\n    prodForm(f, b, atualizar);\n    var v = total(), n = nItens(), m = faltando();")
rep("if (!f.canal) m.push('como chegou'); return m; }", "if (!f.canal) m.push('como chegou'); if (prodSabFalta(f, b)) m.push('sabores da caixa'); return m; }")
rep("obs: $('#obs').value.trim(), data:", "obs: prodObs($('#obs').value.trim(), f, b), data:")
rep("esc(ed ? ed.obs : '')", "esc(ed ? prodSemSabores(ed.obs) : '')")
rep("function msgErro(e) { var m = (e && e.message) || String(e || '');", "function msgErro(e) { var m = (e && e.message) || String(e || ''); if (m === 'timeout') return 'O servidor demorou para responder. Confira se salvou antes de tentar de novo.';")
# 4a. Painel da semana: o HTML vem do Painel.gs (o mesmo do e-mail). Imagem que não carrega no app vira a marca em texto
rep("function gPai() { call('getPainel').then(function (r) { $('#gBody').innerHTML = '<div class=\"painel\">' + r.html + '</div>'; }).catch(function (e) { gErro(e, gPai); }); }",
    """function gPai() { call('getPainel').then(function (r) { $('#gBody').innerHTML = '<div class="painel">' + r.html + '</div>'; marcaPainel(); }).catch(function (e) { gErro(e, gPai); }); }
function marcaPainel() {
  var trocar = function (im) { if (!im.parentNode) return; var d = document.createElement('div'); d.className = 'painel-marca'; d.innerHTML = '<span class="bm-rm">RM</span><span class="bm-t">confeitaria do dia a dia</span>'; im.parentNode.replaceChild(d, im); };
  $$('#gBody .painel img').forEach(function (im) {
    if (!/^(https:|data:image[/])/.test(im.getAttribute('src') || '') || (im.complete && !im.naturalWidth)) return trocar(im);
    im.addEventListener('error', function () { trocar(im); });
  });
}""")
# 4b. Avisos no celular (push pelo Firebase) e rotas por endereço (#pedidos)
rep('<button id="bHelp" class="ib" aria-label="Ajuda"></button>', '<button id="bAvisos" class="ib" aria-label="Avisos no celular"></button>\n  <button id="bHelp" class="ib" aria-label="Ajuda"></button>')
rep("$('#bRef').innerHTML = ic('refresh'); $('#bHelp').innerHTML = ic('help');", "$('#bRef').innerHTML = ic('refresh'); $('#bHelp').innerHTML = ic('help'); $('#bAvisos').innerHTML = ic('bell'); $('#bAvisos').onclick = function () { avisosSheet(); };")
rep("$('#bRef').classList.toggle('hide', form); $('#bHelp').classList.toggle('hide', form);", "$('#bRef').classList.toggle('hide', form); $('#bHelp').classList.toggle('hide', form); $('#bAvisos').classList.toggle('hide', form);")
rep("var IC = {\n", "var IC = {\n  bell: '<path d=\"M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z\"/><path d=\"M10 20a2 2 0 0 0 4 0\"/>',\n")
rep("""  S.token = store('token'); S.pessoa = store('pessoa');""", """  var hv = (location.hash || '').replace(/^#\\/?/, ''); if (hv && ['hoje', 'pedidos', 'gestao', 'plano', 'estoque'].indexOf(hv) >= 0 && !FORM[hv]) S.view = hv;
  S.token = store('token'); S.pessoa = store('pessoa');""")
AVISOS = r"""<script>
/* ============ Avisos no celular (Web Push pelo Firebase Cloud Messaging) ============
   O servidor decide QUANDO avisar; aqui o aparelho pede permissão, registra o endereço e escolhe os tipos.
   No iPhone, só funciona com o app instalado na tela de início (iOS 16.4 ou mais novo). */
var FB_VERSAO = '10.14.1', PUSH = { cfg: null };
function pushOk() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
function iosApp() { return /iphone|ipad|ipod/i.test(navigator.userAgent || ''); }
function instalado() { return window.navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches); }
function pushTipos() { var t = store('pushTipos'); return t ? t.split(',').filter(Boolean) : null; }
function carregarJs(src) { return new Promise(function (ok, erro) { if (document.querySelector('script[src="' + src + '"]')) return ok(); var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = function () { erro(new Error('Sem internet para ativar os avisos.')); }; document.head.appendChild(s); }); }
function tokenFirebase(cfg) {
  var base = 'https://www.gstatic.com/firebasejs/' + FB_VERSAO + '/';
  return carregarJs(base + 'firebase-app-compat.js').then(function () { return carregarJs(base + 'firebase-messaging-compat.js'); })
    .then(function () { if (!firebase.apps.length) firebase.initializeApp(cfg.webConfig); return navigator.serviceWorker.ready; })
    .then(function (reg) { return firebase.messaging().getToken({ vapidKey: cfg.vapidKey, serviceWorkerRegistration: reg }); });
}
function pushCfg() { return PUSH.cfg ? Promise.resolve(PUSH.cfg) : api({ acao: 'pushConfig', token: S.token }).then(function (c) { PUSH.cfg = c; return c; }); }
function avisosSheet() {
  var tok = store('pushToken'), corpo;
  var cab = '<h3>Avisos no celular</h3>';
  if (!pushOk()) corpo = '<p class="desc">' + (iosApp() && !instalado() ? 'No iPhone, os avisos só funcionam com o app <b>instalado na tela de início</b> (iOS 16.4 ou mais novo). No Safari: Compartilhar › Adicionar à Tela de Início, e abra pelo ícone RM.' : 'Este navegador não recebe avisos. No Android use o Chrome; no computador, Chrome, Edge ou Safari.') + '</p>';
  else if (Notification.permission === 'denied') corpo = '<p class="desc">Os avisos estão bloqueados para o RM neste aparelho. ' + (iosApp() ? 'Libere em <b>Ajustes do iPhone › Notificações › RM</b>.' : 'Libere nas configurações do site.') + '</p>';
  else if (tok && Notification.permission === 'granted') {
    var tipos = pushTipos() || [], nomes = (PUSH.cfg && PUSH.cfg.tipos) || {};
    corpo = '<p class="desc"><span class="pill ok">ativos</span> neste aparelho. Escolha o que quer receber:</p><div class="av-l">' +
      Object.keys(nomes).map(function (k) { return '<label class="av-i"><input type="checkbox" data-t="' + k + '"' + (tipos.indexOf(k) >= 0 ? ' checked' : '') + '><span>' + esc(nomes[k]) + '</span></label>'; }).join('') +
      '</div><div class="btns"><button class="btn sec" id="avTeste">Enviar um teste</button><button class="btn sec" id="avOff">Desligar neste aparelho</button></div>';
    if (!PUSH.cfg) pushCfg().then(function () { if ($('#avTeste')) avisosSheet(); }).catch(function () {});
  } else corpo = '<p class="desc">Receba no celular o bom dia com as tarefas, a véspera das retiradas, Pix pendente, a lista de produção, o lembrete do estoque e o painel da semana. Você escolhe quais depois.</p><button class="btn" id="avOn">' + ic('bell', 's') + 'Ativar avisos</button>';
  var sh = sheet(cab + corpo);
  var on = $('#avOn', sh), off = $('#avOff', sh), te = $('#avTeste', sh);
  if (on) on.onclick = function () {
    // No iPhone o pedido de permissão precisa ser a primeira coisa depois do toque
    Notification.requestPermission().then(function (perm) {
      if (perm !== 'granted') { toast('Sem permissão o app não consegue avisar. Dá para liberar depois nos Ajustes.', true); return avisosSheet(); }
      on.disabled = true; on.textContent = 'Ativando…';
      return pushCfg().then(function (cfg) {
        if (!cfg.ativo) throw new Error('Os avisos ainda não foram configurados no servidor (falta: ' + (cfg.falta || []).join(', ') + ').');
        return tokenFirebase(cfg).then(function (t) {
          if (!t) throw new Error('O aparelho não devolveu o endereço de aviso. Tente de novo.');
          var tipos = pushTipos() || cfg.padrao || [];
          return api({ acao: 'registrarPush', token: S.token, token_push: t, plataforma: iosApp() ? 'iPhone' : (/Android/.test(navigator.userAgent) ? 'Android' : 'computador'), tipos: tipos })
            .then(function (r) { store('pushToken', t); store('pushTipos', r.tipos.join(',')); store('pushVerif', S.boot ? S.boot.hoje : ''); toast('Avisos ativados neste aparelho.', false, { label: 'Testar', fn: function () { api({ acao: 'testarPush', token: S.token, token_push: t }).then(function () { toast('Enviado. Deve chegar em alguns segundos.'); }).catch(fail); } }); avisosSheet(); });
        });
      });
    }).catch(function (e) { toast(msgErro(e), true); avisosSheet(); });
  };
  $$('.av-i input', sh).forEach(function (c) { c.onchange = function () {
    var atuais = pushTipos() || [], k = c.dataset.t, novos = c.checked ? atuais.concat(atuais.indexOf(k) >= 0 ? [] : [k]) : atuais.filter(function (x) { return x !== k; });
    store('pushTipos', novos.join(','));
    api({ acao: 'preferenciasPush', token: S.token, token_push: store('pushToken'), tipos: novos }).catch(function (e) { store('pushTipos', atuais.join(',')); c.checked = !c.checked; fail(e); });
  }; });
  if (te) te.onclick = function () { te.disabled = true; api({ acao: 'testarPush', token: S.token, token_push: store('pushToken') }).then(function () { toast('Enviado. Deve chegar em alguns segundos.'); }).catch(fail).then(function () { te.disabled = false; }); };
  if (off) off.onclick = function () {
    var t = store('pushToken'); store('pushToken', ''); store('pushVerif', '');
    api({ acao: 'removerPush', token: S.token, token_push: t }).catch(function () {});
    try { if (window.firebase && firebase.apps.length) firebase.messaging().deleteToken(); } catch (e) {}
    toast('Avisos desligados neste aparelho.'); avisosSheet();
  };
}
/* Uma vez por dia confere o endereço (o Firebase pode trocá-lo) e limpa se a permissão foi retirada */
function revisarPush() {
  var tok = store('pushToken'); if (!tok || !S.token || !pushOk() || window.MOCK) return;
  if (Notification.permission !== 'granted') { api({ acao: 'removerPush', token: S.token, token_push: tok }).catch(function () {}); store('pushToken', ''); return; }
  var hoje = new Date().toISOString().slice(0, 10); if (store('pushVerif') === hoje) return;
  pushCfg().then(function (cfg) { if (!cfg.ativo) return; return tokenFirebase(cfg).then(function (novo) {
    if (novo && novo !== tok) api({ acao: 'removerPush', token: S.token, token_push: tok }).catch(function () {});
    return api({ acao: 'registrarPush', token: S.token, token_push: novo || tok, plataforma: iosApp() ? 'iPhone' : 'outro', tipos: pushTipos() || cfg.padrao || [] })
      .then(function (r) { store('pushToken', novo || tok); store('pushTipos', r.tipos.join(',')); store('pushVerif', hoje); });
  }); }).catch(function () {});
}
setTimeout(revisarPush, 8000);
/* Tocar num aviso abre o app na tela certa (o service worker avisa qual) */
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', function (e) { var v = e.data && e.data.ir && String(e.data.ir).replace(/^#\/?/, ''); if (v && S.token && ['hoje', 'pedidos', 'gestao', 'plano', 'estoque'].indexOf(v) >= 0) go(v); });
</script>
<style>.painel-marca{display:flex;align-items:baseline;gap:9px}.painel-marca .bm-rm{font:26px/1 var(--serif);color:var(--linho)}.painel-marca .bm-t{font:italic 18px/1 var(--serif);color:var(--rosaT)}.av-l{display:flex;flex-direction:column;gap:2px;margin:4px 0 12px}.av-i{display:flex;gap:12px;align-items:flex-start;padding:10px 2px;border-top:1px solid var(--linha);font-size:15px;line-height:1.35}.av-i input{width:22px;height:22px;flex:0 0 auto;margin:0;padding:0;border:1.5px solid var(--ameixa);border-radius:6px;background:#fff center/16px no-repeat}.av-i input:checked{background-color:var(--ameixa);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fff' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E")}</style>
"""
rep('</body>', AVISOS + '</body>')
# 4d. iPhone (app instalado): às vezes a área da página fica mais curta que a tela e as barras fixas sobem,
#     deixando um vão embaixo. Mede o vão e encosta as barras no fundo. Volta ao app depois de 1 min: atualiza a Hoje.
rep('</body>', """<script>
function ajustarFundo() {
  var inst = window.navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  var vao = inst ? Math.round(screen.height - window.innerHeight) : 0;
  if (vao < 0 || vao > 90 || window.innerWidth > window.innerHeight) vao = 0;   // só o vão pequeno, em pé
  document.documentElement.style.setProperty('--vao', vao + 'px');
}
ajustarFundo(); window.addEventListener('resize', ajustarFundo); window.addEventListener('pageshow', ajustarFundo);
var saiuEm = 0;
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') { saiuEm = Date.now(); return; }
  ajustarFundo();
  if (saiuEm && Date.now() - saiuEm > 60000 && S.token && S.boot && S.view === 'hoje' && !$('#sheet').classList.contains('open')) vHoje();
});
</script>
<style>.tabs,.actbar{bottom:calc(0px - var(--vao,0px))}#sheet{bottom:calc(0px - var(--vao,0px))}.toast{bottom:calc(var(--tab) + var(--safe) + 14px - var(--vao,0px))}body.form .toast{bottom:calc(var(--safe) + 96px - var(--vao,0px))}</style>
</body>""")
# 4c. Arquivos de extras/ (fila de pedidos e produção) e o estilo deles
EXTRAS = ''.join('<script>\n' + (pathlib.Path(__file__).with_name('extras') / n).read_text() + '</script>\n' for n in ['fila.js', 'producao.js'])
EXTRAS += ('<style>.fila-av{position:fixed;top:calc(var(--top) + 8px);left:50%;transform:translateX(-50%);z-index:25;display:flex;align-items:center;gap:6px;padding:8px 14px;border:0;border-radius:999px;background:var(--ameixa);color:#fff;font:600 13px var(--sans);box-shadow:0 4px 14px rgba(0,0,0,.18);white-space:nowrap}'
  '.fila-av.hide{display:none}.fila-av.err{background:var(--err)}.fila-av svg{width:16px;height:16px}.fila-av .spin{animation:filaGira 1s linear infinite}@keyframes filaGira{to{transform:rotate(360deg)}}'
  '.prod-est .li{align-items:center}.prod-est .tx small{display:block;font-size:13px;margin-top:2px}.pe-n{text-align:right;min-width:72px}.pe-n b{display:block;font:26px/1 var(--serif);color:var(--ameixa)}.pe-n b.neg{color:var(--err)}.pe-n b.nd{color:var(--sub)}.pe-n span{font-size:12px;color:var(--sub)}'
  '.pr-est{font-size:13px;color:var(--ok);margin-left:6px;font-weight:600}.pr-est.neg{color:var(--err)}.step.big{justify-content:flex-start;gap:12px}.step.big input{width:96px;text-align:center;font-size:22px;padding:8px}</style>\n')
rep('</body>', EXTRAS + '</body>')
# 5. Service worker: guarda o app no aparelho; versão nova recarrega sozinha
rep('</body>', '''<script>
if ('serviceWorker' in navigator && !window.MOCK && location.protocol === 'https:') {
  var recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () { if (recarregou) return; recarregou = true; location.reload(); });
  navigator.serviceWorker.register('sw.js').then(function (reg) { setInterval(function () { reg.update(); }, 30 * 60 * 1000); }).catch(function () {});
}
</script>
</body>''')
assert 'S.pin' not in t, [m.start() for m in re.finditer(r'S\.pin', t)]
assert 'google.script' not in t
pathlib.Path(__file__).with_name('index.html').write_text(t)
print('index.html gerado:', len(t), 'bytes')
