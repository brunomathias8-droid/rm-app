/* Service worker do app RM: guarda o app no aparelho para abrir rápido (e sem internet, com os últimos dados).
   Troque VERSAO a cada publicação: o app baixa a versão nova e recarrega sozinho. Dados da API nunca passam por aqui. */
var VERSAO = 'rm-2026-10-04-2';
var ARQUIVOS = ['./', 'index.html', 'config.js', 'manifest.webmanifest', 'icones/icone-192.png', 'icones/icone-512.png', 'icones/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(ARQUIVOS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VERSAO && k !== VERSAO + '-fontes' && k.indexOf('rm-') === 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;                         // chamadas à API (POST) vão direto à internet
  if (url.origin === location.origin) {
    // Página: rede primeiro (pega versão nova), cache se estiver sem internet. Demais arquivos: cache primeiro.
    if (req.mode === 'navigate') {
      e.respondWith(fetch(req).then(function (r) { var cp = r.clone(); caches.open(VERSAO).then(function (c) { c.put('index.html', cp); }); return r; })
        .catch(function () { return caches.match('index.html'); }));
    } else {
      e.respondWith(caches.match(req).then(function (r) { return r || fetch(req); }));
    }
    return;
  }
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {  // fontes da marca: guarda depois do primeiro uso
    e.respondWith(caches.open(VERSAO + '-fontes').then(function (c) {
      return c.match(req).then(function (r) { return r || fetch(req).then(function (res) { c.put(req, res.clone()); return res; }); });
    }));
  }
});

/* ---------- Avisos (push pelo Firebase Cloud Messaging) ----------
   O servidor manda só dados {titulo, corpo, url, tag}; aqui viram a notificação. O iPhone exige mostrar uma notificação por push. */
self.addEventListener('push', function (e) {
  var p = {};
  try { p = e.data ? e.data.json() : {}; } catch (x) { p = { data: { corpo: e.data ? e.data.text() : '' } }; }
  var d = p.data || {}, n = p.notification || {};
  var opcoes = { body: d.corpo || n.body || '', icon: 'icones/icone-192.png', badge: 'icones/icone-192.png', data: { url: d.url || '#hoje' }, lang: 'pt-BR' };
  if (d.tag) { opcoes.tag = d.tag; opcoes.renotify = true; }
  e.waitUntil(self.registration.showNotification(d.titulo || n.title || 'RM', opcoes));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '#hoje';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
    var aberto = lista.filter(function (c) { return c.url.indexOf(self.registration.scope) === 0; })[0];
    if (aberto) { aberto.postMessage({ ir: url }); return aberto.focus(); }
    return self.clients.openWindow(self.registration.scope + url);
  }));
});
