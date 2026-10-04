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

# 3. Servidor: fetch na API com token (o MOCK continua para os testes)
old_call = t[t.index('function callRaw(fn, args) {'):t.index('function msgErro(e)')]
new_call = r'''function callRaw(fn, args) {
  if (window.MOCK) return window.MOCK[fn].apply(null, ['tk'].concat(args));
  return api({ acao: 'rpc', token: S.token, fn: fn, args: args || [] }).then(function (d) { guardarCache(fn, args, d); return d; });
}
/* API do Apps Script: POST com JSON em text/plain (evita a pré-verificação de CORS). Erro de sessão volta ao login. */
function api(corpo) {
  var url = store('api') || (window.RM_CONFIG && RM_CONFIG.api) || '';
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
var CACHE_FNS = { getBootstrap: 1, getHoje: 1, getPedidosAbertos: 1, getPedidosHistorico: 1, getRoadmap: 1, getAcoes: 1, getPainel: 1, getMensagens: 1, getEstoque: 1, getAjuda: 1 };
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
  try { var qa = new URLSearchParams(location.search).get('api'); if (qa && /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(qa)) { store('api', qa); history.replaceState(null, '', location.pathname); } } catch (e) {}
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
