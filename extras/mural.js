/* ============ Mural (18/10/2026) ============
   Recados dos agentes, tarefas de Instagram com "kit de postagem", pedidos ao assistente e arquivos da marca.
   Inspirado em: caixa de entrada do Slack/Linear (lido, feito, adiar), "notification publishing" do Buffer/Later
   (na hora de postar: imagem salva, legenda copiada, Instagram aberto) e modelos com a marca do Canva (cardápio).
   Dados: Mural.gs (abas Mural e PedidosAssistente). Arquivos da marca: marca/biblioteca.json neste repositório. */
var MU_IG = '@rm_confeitari4', MU_IG_URL = 'https://www.instagram.com/rm_confeitari4/', MU_WA = '(85) 98690-0420';
S.mu = S.mu || { sub: 'rec', filtro: 'meus', dados: null, abrir: null, bib: null };
var MU_ORIGEM = { Marketing: ['mega', 'Marketing'], 'Gestão': ['chart', 'Gestão'], Fechamento: ['box', 'Fechamento'], Assistente: ['send', 'Assistente'], Sistema: ['info', 'Sistema'], Plano: ['cal', 'Plano'] };

/* ---------- dados ---------- */
function muCarregar(forcar) {
  if (S.mu.carregando && !forcar) return S.mu.carregando;
  S.mu.carregando = call('getMural', S.pessoa).then(function (d) { S.mu.dados = d; S.mu.carregando = null; muBadge(); return d; }, function (e) { S.mu.carregando = null; throw e; });
  return S.mu.carregando;
}
function muMeus() { var d = S.mu.dados; return d ? d.cartoes.filter(function (c) { return c.paraMim && c.status !== 'feito'; }) : []; }
function muPendentes() { var h = S.mu.dados && S.mu.dados.hoje; return muMeus().filter(function (c) { var q = muQuando(c); return !c.visto || (q && q <= h); }).length; }
function muQuando(c) { return c.adiadoAte && c.adiadoAte > (c.prazo || '') ? c.adiadoAte : c.prazo; }
function muBadge() {
  var b = $('#tabs [data-v="mural"]'); if (!b) return;
  var n = muPendentes(), el = $('.mu-bdg', b);
  if (!n) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement('i'); el.className = 'mu-bdg'; b.appendChild(el); }
  el.textContent = n > 9 ? '9+' : n;
}
function muBib() {
  if (S.mu.bib) return Promise.resolve(S.mu.bib);
  return fetch('marca/biblioteca.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) { S.mu.bib = j; return j; });
}
function muArq(chave) { var b = S.mu.bib; if (!b) return null; for (var i = 0; i < b.arquivos.length; i++) if (b.arquivos[i].chave === chave) return b.arquivos[i]; return null; }

/* ---------- texto com marcação simples: **negrito**, listas "- " e "1. ", tabelas com | ---------- */
function muTexto(md) {
  var linhas = String(md || '').replace(/\r/g, '').split('\n'), h = '', lista = null, tab = [];
  var inl = function (s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>'); };
  var fechaLista = function () { if (lista) { h += '</' + lista + '>'; lista = null; } };
  var fechaTab = function () {
    if (!tab.length) return;
    var rows = tab.filter(function (r) { return !/^\s*\|?\s*:?-{2,}/.test(r); }).map(function (r) { return r.replace(/^\s*\||\|\s*$/g, '').split('|').map(function (c) { return c.trim(); }); });
    h += '<div class="mu-tw"><table class="mu-tab">' + rows.map(function (r, i) { return '<tr>' + r.map(function (c) { return i ? '<td>' + inl(c) + '</td>' : '<th>' + inl(c) + '</th>'; }).join('') + '</tr>'; }).join('') + '</table></div>';
    tab = [];
  };
  linhas.forEach(function (l) {
    if (/^\s*\|.*\|\s*$/.test(l)) { fechaLista(); tab.push(l); return; }
    fechaTab();
    var m;
    if ((m = l.match(/^\s*[-•*]\s+(.*)$/))) { if (lista !== 'ul') { fechaLista(); h += '<ul>'; lista = 'ul'; } h += '<li>' + inl(m[1]) + '</li>'; return; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)$/))) { if (lista !== 'ol') { fechaLista(); h += '<ol>'; lista = 'ol'; } h += '<li>' + inl(m[1]) + '</li>'; return; }
    fechaLista();
    if (!l.trim()) return;
    if ((m = l.match(/^#{1,3}\s+(.*)$/))) { h += '<h4>' + inl(m[1]) + '</h4>'; return; }
    h += '<p>' + inl(l) + '</p>';
  });
  fechaLista(); fechaTab();
  return h;
}
function muDataTxt(iso, hora) {
  if (!iso) return '';
  var h = S.mu.dados ? S.mu.dados.hoje : S.boot.hoje, d = iso === h ? 'hoje' : iso === isoAdd(h, 1) ? 'amanhã' : iso === isoAdd(h, -1) ? 'ontem' : dBR(iso);
  return d + (hora ? ' às ' + hora.replace(':00', 'h').replace(':', 'h') : '');
}
function muPrazoPill(c) {
  var q = muQuando(c), h = S.mu.dados.hoje;
  if (c.status === 'feito') return '<span class="pill ok">' + ic('check', 's') + 'feito' + (c.feitoPor ? ' · ' + esc(c.feitoPor) : '') + '</span>';
  if (!q) return '';
  if (q < h) return '<span class="pill err">' + ic('clock', 's') + 'atrasado · ' + esc(muDataTxt(q)) + '</span>';
  if (q === h) return '<span class="pill av">' + ic('clock', 's') + esc(muDataTxt(q, c.hora)) + '</span>';
  return '<span class="pill nd">' + ic('clock', 's') + esc(muDataTxt(q, c.hora)) + (c.status === 'adiado' ? ' (adiado)' : '') + '</span>';
}

/* ---------- tela principal ---------- */
function vMural() {
  if (S.mu.abrir) { var id = S.mu.abrir; S.mu.abrir = null; S.mu.cartao = id; return go('cartao'); }
  muBib().catch(function () {});
  muRender();
  muCarregar(true).then(function () { if (S.view === 'mural') muRender(); }).catch(function (e) { if (S.mu.dados) return fail(e); if (S.view === 'mural') erroTela(e, vMural); });
}
function muRender() {
  var sub = S.mu.sub;
  var h = '<div class="page"><div class="lt"><small>Recados, tarefas e arquivos</small><h1>Mural</h1></div>' +
    seg('muSeg', [['rec', 'Recados'], ['ped', 'Pedir'], ['arq', 'Arquivos']], sub) + '<div id="muBody"></div>' +
    '<button class="mi" style="margin-top:18px" onclick="go(\'plano\')"><span class="ic">' + ic('cal') + '</span><span class="grow"><b>Plano mês a mês</b><span>Tarefas, ações e marcos de outubro a abril</span></span>' + ic('chev', 's') + '</button></div>';
  $('#app').innerHTML = h;
  $$('#muSeg button').forEach(function (b) { b.onclick = function () { S.mu.sub = b.dataset.k; muRender(); }; });
  ({ rec: muRecados, ped: muPedir, arq: muArquivos })[sub]();
}

function muRecados() {
  var d = S.mu.dados, el = $('#muBody');
  if (!d) { el.innerHTML = esqueleto([40, 96, 96, 96]); return; }
  var f = S.mu.filtro;
  var lista = d.cartoes.filter(function (c) { return f === 'feitos' ? c.status === 'feito' : c.status !== 'feito' && (f === 'todos' || c.paraMim); });
  var nMeus = muMeus().length;
  var h = chipsHtml('muF', [['meus', 'Para mim' + (nMeus ? ' (' + nMeus + ')' : '')], ['todos', 'Todos'], ['feitos', 'Feitos']], f, 'scroll');
  if (!lista.length) h += vazio(f === 'feitos' ? 'check' : 'info', f === 'feitos' ? 'Nada concluído nas últimas 3 semanas' : 'Nada pendente por aqui', f === 'feitos' ? '' : 'Os agentes publicam no sábado (Marketing), na terça (Fechamento) e na sexta (Gestão). Para pedir algo, use Pedir.');
  else {
    var grupos = [['Para hoje e atrasados', function (c) { return c.ordem <= 1; }], ['Novos', function (c) { return c.ordem === 2; }], ['Próximos dias', function (c) { return c.ordem === 3; }], ['Concluídos', function (c) { return c.ordem === 9; }]];
    grupos.forEach(function (g) {
      var cs = lista.filter(g[1]); if (!cs.length) return;
      h += '<div class="sec"><h2>' + g[0] + '</h2><span class="cnt">' + cs.length + '</span></div>' + cs.map(muCartaoLinha).join('');
    });
  }
  el.innerHTML = h;
  chipsSel($('#muF'), function (v) { S.mu.filtro = v; muRecados(); });
  $$('[data-mu]', el).forEach(function (b) { b.onclick = function () { S.mu.cartao = b.dataset.mu; go('cartao'); }; });
}
function muCartaoLinha(c) {
  var o = MU_ORIGEM[c.origem] || ['info', c.origem];
  var kit = (c.legenda || c.cardapio || (c.anexos && c.anexos.length)) ? '<span class="pill">' + ic('star', 's') + (c.cardapio ? 'cardápio pronto' : c.legenda ? 'legenda pronta' : 'arquivos') + '</span>' : '';
  return '<button class="mu-c' + (c.visto || c.status === 'feito' ? '' : ' novo') + '" data-mu="' + esc(c.id) + '">' +
    '<span class="mu-o">' + ic(o[0], 's') + esc(o[1]) + (c.para !== 'Ambos' ? ' · para ' + esc(c.para) : '') + '</span>' +
    '<b>' + esc(c.titulo) + '</b>' + (c.resumo ? '<span class="mu-r">' + esc(c.resumo) + '</span>' : '') +
    '<span class="mu-m">' + muPrazoPill(c) + kit + (c.passos.length && c.status !== 'feito' ? '<span class="pill nd">' + c.passos.length + ' passo' + (c.passos.length === 1 ? '' : 's') + '</span>' : '') + '</span></button>';
}

/* ---------- um recado ---------- */
function vCartao() {
  var c = S.mu.dados && S.mu.dados.cartoes.filter(function (x) { return x.id === S.mu.cartao; })[0];
  if (!c) {
    $('#app').innerHTML = esqueleto([60, 200, 120]);
    return muCarregar(true).then(function (d) { if (S.view !== 'cartao') return; if (d.cartoes.some(function (x) { return x.id === S.mu.cartao; })) vCartao(); else { toast('Recado não encontrado (pode ter sido arquivado).', true); go('mural'); } }).catch(function (e) { erroTela(e, vCartao); });
  }
  muBib().then(function () { if (S.view === 'cartao' && $('#muAnx')) $('#muAnx').innerHTML = muAnexosHtml(c); muLigarAnexos(); }).catch(function () {});
  if (!c.visto) { c.visto = true; muBadge(); call('muralAcao', c.id, 'visto', S.pessoa).catch(function () {}); }
  var o = MU_ORIGEM[c.origem] || ['info', c.origem], feito = c.status === 'feito', ehPost = c.tipo === 'post' || c.tipo === 'cardapio' || c.legenda;
  var feitos = muPassosFeitos(c.id);
  var h = '<div class="page mu-d"><span class="mu-o">' + ic(o[0], 's') + esc(o[1]) + ' · ' + esc(dBR(String(c.criadoEm).slice(0, 10))) + (c.para !== 'Ambos' ? ' · para ' + esc(c.para) : '') + '</span>' +
    '<h1>' + esc(c.titulo) + '</h1><div class="mu-m">' + muPrazoPill(c) + '</div>' + (c.resumo ? '<p class="mu-res">' + esc(c.resumo) + '</p>' : '');
  if (ehPost) {
    h += '<section class="mu-kit"><h3>' + ic('star', 's') + 'Kit de postagem</h3>';
    if (c.cardapio) h += '<button class="btn" id="muCdp">' + ic('edit', 's') + 'Montar o cardápio e gerar a imagem</button>';
    if (c.legenda) h += '<div class="mu-leg"><div class="lab">Legenda</div><div class="mu-lt" id="muLeg">' + esc(c.legenda).replace(/\n/g, '<br>') + '</div><button class="btn sec" id="muCop">' + ic('doc', 's') + 'Copiar legenda</button></div>';
    h += '<button class="btn sec" id="muIg">' + ic('out', 's') + 'Abrir o Instagram</button><p class="muted" style="margin:8px 0 0">No Instagram: novo post › escolha a imagem salva › toque na legenda e cole.</p></section>';
  }
  if (c.passos.length) h += '<section class="mu-sec"><h3>Passo a passo</h3><div class="mu-ps">' + c.passos.map(function (p, i) { return '<label class="mu-p"><input type="checkbox" data-pi="' + i + '"' + (feitos[i] ? ' checked' : '') + '><span>' + muTexto(p).replace(/^<p>|<\/p>$/g, '') + '</span></label>'; }).join('') + '</div></section>';
  if (c.corpo) h += '<section class="mu-sec mu-corpo">' + muTexto(c.corpo) + '</section>';
  h += '<div id="muAnx">' + muAnexosHtml(c) + '</div>';
  h += '<div class="btns">' + (feito ? '<button class="btn sec" id="muRe">' + ic('undo', 's') + 'Reabrir</button>' : '<button class="btn ok" id="muOk">' + ic('check', 's') + 'Feito</button><button class="btn sec" id="muAd">' + ic('clock', 's') + 'Adiar</button>') +
    '<button class="btn sec" id="muAj">' + ic('send', 's') + 'Pedir ajuste ao assistente</button><button class="lk mu-arq" id="muAr">Arquivar (some da lista)</button></div></div>';
  $('#app').innerHTML = h;
  muLigarAnexos();
  var b;
  if ((b = $('#muCdp'))) b.onclick = function () { S.cdp = { id: c.id, dados: JSON.parse(JSON.stringify(c.cardapio)), legenda: c.legenda || '' }; go('cardapio'); };
  if ((b = $('#muCop'))) b.onclick = function () { muCopiar(c.legenda, 'Legenda copiada. No Instagram, toque na legenda e cole.'); };
  if ((b = $('#muIg'))) b.onclick = muAbrirInstagram;
  $$('.mu-p input').forEach(function (x) { x.onchange = function () { var f = muPassosFeitos(c.id); f[x.dataset.pi] = x.checked; store('mup_' + c.id, JSON.stringify(f)); if (x.checked && c.passos.every(function (p, i) { return f[i]; }) && c.status !== 'feito') toast('Todos os passos marcados.', false, { label: 'Marcar feito', fn: function () { muAcao(c, 'feito'); } }); }; });
  if ((b = $('#muOk'))) b.onclick = function () { muAcao(c, 'feito'); };
  if ((b = $('#muRe'))) b.onclick = function () { muAcao(c, 'reabrir'); };
  if ((b = $('#muAd'))) b.onclick = function () { muAdiar(c); };
  if ((b = $('#muAr'))) b.onclick = function () { confirmar('Arquivar este recado?', 'Ele sai do Mural para os dois. Continua guardado na planilha.', 'Arquivar').then(function (ok) { if (ok) muAcao(c, 'arquivar'); }); };
  $('#muAj').onclick = function () { S.mu.sub = 'ped'; S.mu.ref = c; go('mural'); };
}
function muPassosFeitos(id) { try { return JSON.parse(store('mup_' + id) || '{}'); } catch (e) { return {}; } }
function muAcao(c, acao, valor) {
  var antes = JSON.parse(JSON.stringify(c));
  call('muralAcao', c.id, acao, S.pessoa, valor || '').then(function (novo) {
    var l = S.mu.dados.cartoes, i = l.map(function (x) { return x.id; }).indexOf(c.id);
    if (acao === 'arquivar') l.splice(i, 1); else if (i >= 0) l[i] = novo;
    muBadge();
    var msg = { feito: 'Feito. Saiu da lista.', reabrir: 'Reaberto.', arquivar: 'Arquivado.', adiar: 'Adiado para ' + muDataTxt(valor) + '.' }[acao];
    toast(msg, false, acao === 'reabrir' ? null : { label: 'Desfazer', fn: function () { call('muralAcao', c.id, acao === 'arquivar' ? 'reabrir' : antes.status === 'adiado' && acao !== 'adiar' ? 'adiar' : 'reabrir', S.pessoa, antes.adiadoAte || '').then(function () { return muCarregar(true); }).then(function () { if (S.view === 'mural') muRender(); }).catch(fail); } });
    go('mural');
  }).catch(fail);
}
function muAdiar(c) {
  var h = S.mu.dados.hoje, dow = pd(h).getDay(), seg = isoAdd(h, ((8 - dow) % 7) || 7);
  var op = [[isoAdd(h, 1), 'Amanhã'], [isoAdd(h, 2), dBR(isoAdd(h, 2))], [seg, 'Segunda (' + dBR(seg).slice(4) + ')']];
  var sh = sheet('<h3>Adiar para quando?</h3><div class="btns">' + op.map(function (o) { return '<button class="btn sec" data-d="' + o[0] + '">' + esc(o[1]) + '</button>'; }).join('') +
    '<div class="fld" style="margin:4px 0 0"><label for="muDt">Outra data</label><input type="date" id="muDt" min="' + h + '"></div><button class="btn" id="muDtOk">Adiar</button></div>');
  $$('[data-d]', sh).forEach(function (b) { b.onclick = function () { fecharSheet(); muAcao(c, 'adiar', b.dataset.d); }; });
  $('#muDtOk', sh).onclick = function () { var v = $('#muDt', sh).value; if (!v) return toast('Escolha a data.', true); fecharSheet(); muAcao(c, 'adiar', v); };
}

/* ---------- arquivos: salvar, compartilhar ---------- */
function muAnexosHtml(c) {
  if (!c.anexos || !c.anexos.length) return '';
  var itens = c.anexos.map(function (k) { var a = muArq(k); return a ? '<button class="mu-ax" data-ax="' + esc(k) + '"><img src="' + esc(a.arquivo) + '" alt="" loading="lazy"><span>' + esc(a.titulo) + '</span></button>' : ''; }).join('');
  return itens ? '<section class="mu-sec"><h3>Arquivos</h3><div class="mu-axs">' + itens + '</div></section>' : '';
}
function muLigarAnexos() { $$('[data-ax]').forEach(function (b) { b.onclick = function () { muArquivoSheet(b.dataset.ax); }; }); }
function muArquivoSheet(chave) {
  var a = muArq(chave); if (!a) return;
  var sh = sheet('<h3>' + esc(a.titulo) + '</h3><div class="mu-prev"><img src="' + esc(a.arquivo) + '" alt="' + esc(a.titulo) + '"></div><p class="desc">' + esc(a.uso) + '</p>' +
    '<div class="btns"><button class="btn" id="muSh">' + ic('out', 's') + 'Salvar ou compartilhar</button>' + (chave === 'avatar' ? '<button class="btn sec" id="muIg2">Abrir o Instagram</button><p class="muted">No Instagram: perfil › Editar perfil › Editar foto › escolher a imagem salva.</p>' : '') + '</div>');
  $('#muSh', sh).onclick = function () { muCompartilharUrl(a.arquivo, chave + '.png', a.titulo); };
  if ($('#muIg2', sh)) $('#muIg2', sh).onclick = muAbrirInstagram;
}
function muCompartilharUrl(url, nome, titulo) {
  fetch(url).then(function (r) { return r.blob(); }).then(function (b) { muCompartilharBlob(b, nome, titulo); }).catch(function () { window.open(url, '_blank'); });
}
/* No iPhone, a folha de compartilhar tem "Salvar Imagem" e o Instagram. Sem ela (computador), baixa o arquivo. */
function muCompartilharBlob(blob, nome, titulo) {
  var file = null;
  try { file = new File([blob], nome, { type: blob.type || 'image/png' }); } catch (e) {}
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    return navigator.share({ files: [file], title: titulo || nome }).catch(function (e) { if (e && e.name !== 'AbortError') muBaixar(blob, nome); });
  }
  muBaixar(blob, nome);
}
function muBaixar(blob, nome) {
  var u = URL.createObjectURL(blob), a = document.createElement('a'); a.href = u; a.download = nome; document.body.appendChild(a); a.click();
  setTimeout(function () { URL.revokeObjectURL(u); a.remove(); }, 4000);
  toast('Imagem baixada.');
}
function muCopiar(txt, ok) {
  var feito = function () { toast(ok || 'Copiado.'); };
  var plano = function () { var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); feito(); } catch (e) { toast('Não deu para copiar. Toque e segure no texto.', true); } ta.remove(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(feito, plano); else plano();
}
function muAbrirInstagram() {
  var ini = Date.now();
  location.href = 'instagram://user?username=rm_confeitari4';
  setTimeout(function () { if (Date.now() - ini < 2500 && document.visibilityState === 'visible') window.open(MU_IG_URL, '_blank'); }, 1200);
}

function muArquivos() {
  var el = $('#muBody'); el.innerHTML = esqueleto([120, 120, 120]);
  muBib().then(function (b) {
    if (S.view !== 'mural' || S.mu.sub !== 'arq') return;
    var grupos = []; b.arquivos.forEach(function (a) { if (grupos.indexOf(a.grupo) < 0) grupos.push(a.grupo); });
    el.innerHTML = '<p class="muted" style="margin:0 0 6px">Arquivos com o nome <b>' + esc(b.marca) + '</b> e o ' + esc(b.instagram) + '. Toque para salvar no celular ou mandar para o Instagram, WhatsApp ou gráfica.</p>' +
      grupos.map(function (g) { return '<div class="sec"><h2>' + esc(g) + '</h2></div><div class="mu-axs">' + b.arquivos.filter(function (a) { return a.grupo === g; }).map(function (a) { return '<button class="mu-ax" data-ax="' + esc(a.chave) + '"><img src="' + esc(a.arquivo) + '" alt="" loading="lazy"><span>' + esc(a.titulo) + '</span></button>'; }).join('') + '</div>'; }).join('') +
      '<button class="mi" style="margin-top:16px" id="muNovoCdp"><span class="ic">' + ic('edit') + '</span><span class="grow"><b>Montar um cardápio</b><span>Gera a imagem do post e do story</span></span>' + ic('chev', 's') + '</button>';
    muLigarAnexos();
    $('#muNovoCdp').onclick = function () { S.cdp = { id: '', dados: muCardapioBase(), legenda: '' }; go('cardapio'); };
  }).catch(function (e) { el.innerHTML = vazio('alert', 'Não deu para carregar os arquivos', msgErro(e)); });
}

/* ---------- pedir ao assistente ---------- */
var MU_SUGESTOES = [['Legenda', 'Escreva a legenda do post de '], ['Cardápio', 'Monte o cardápio da próxima semana com '], ['Reel', 'Ideia de reel para quarta mostrando '], ['Responder cliente', 'Me ajude a responder esta cliente no WhatsApp: '], ['Preço', 'Quanto devo cobrar por '], ['Promoção', 'Ideia de ação para vender mais ']];
function muPedir() {
  var d = S.mu.dados, el = $('#muBody'), ref = S.mu.ref; S.mu.ref = null;
  var h = '';
  if (d && !d.assistente) h += '<div class="card" style="background:var(--avC)"><b>Assistente ainda não ligado</b><p class="muted" style="margin:4px 0 0">Falta o Bruno colocar a chave da API na Config. Os recados dos agentes já funcionam.</p></div>';
  h += '<div class="card"><div class="fld" style="margin:0"><label for="muTx">O que você precisa?</label>' +
    '<textarea id="muTx" rows="4" maxlength="1500" placeholder="Ex.: legenda para o bolo de banana com doce de leite, 900 g, R$ 70">' + (ref ? esc('Sobre o recado "' + ref.titulo + '": ') : '') + '</textarea></div>' +
    '<div class="chips scroll" id="muSug" style="margin:10px 0 2px">' + MU_SUGESTOES.map(function (s, i) { return '<button type="button" class="chip" data-s="' + i + '">' + esc(s[0]) + '</button>'; }).join('') + '</div>' +
    '<button class="btn" id="muEnv" style="margin-top:12px">' + ic('send', 's') + 'Enviar ao assistente</button>' +
    '<p class="muted" style="margin:8px 0 0">A resposta chega aqui no Mural em menos de 1 minuto. O assistente prepara rascunhos: nada é publicado nem enviado a cliente sem vocês.</p></div>';
  var meus = d ? d.pedidos : [];
  if (meus.length) h += '<div class="sec"><h2>Pedidos recentes</h2></div>' + meus.map(function (p) {
    var st = p.status === 'respondido' ? '<span class="pill ok">respondido</span>' : p.status === 'erro' ? '<span class="pill err">não saiu</span>' : '<span class="pill av">' + ic('clock', 's') + 'o assistente está trabalhando</span>';
    return '<div class="mu-pd' + (p.muralId ? ' lnk" data-mu="' + esc(p.muralId) : '') + '"><span class="mu-o">' + esc(p.pessoa) + ' · ' + esc(dBR(String(p.criadoEm).slice(0, 10))) + ' ' + esc(String(p.criadoEm).slice(11, 16)) + '</span><span>' + esc(p.texto) + '</span><span class="mu-m">' + st + (p.muralId ? '<span class="pill">ver resposta ' + ic('chev', 's') + '</span>' : '') + '</span>' + (p.status === 'erro' && p.erro ? '<span class="muted">' + esc(p.erro) + '</span>' : '') + '</div>';
  }).join('');
  el.innerHTML = h;
  var tx = $('#muTx');
  if (ref) { tx.focus(); tx.setSelectionRange(tx.value.length, tx.value.length); }
  $$('#muSug .chip').forEach(function (b) { b.onclick = function () { var s = MU_SUGESTOES[b.dataset.s][1]; tx.value = tx.value.trim() ? tx.value.trim() + '\n' + s : s; tx.focus(); tx.setSelectionRange(tx.value.length, tx.value.length); }; });
  $$('.mu-pd.lnk').forEach(function (b) { b.onclick = function () { S.mu.cartao = b.dataset.mu; go('cartao'); }; });
  $('#muEnv').onclick = function () {
    var v = tx.value.trim(), btn = this; if (v.length < 4) { tx.focus(); return toast('Escreva o que você precisa.', true); }
    btn.disabled = true; btn.textContent = 'Enviando…';
    call('pedirAssistente', S.pessoa, v, ref ? ref.id : '').then(function (r) {
      if (r.modo === 'api') { toast('Pedido enviado. O assistente está escrevendo — leva menos de 1 minuto.'); muResponder(r.id); }
      else toast(r.status === 'enviado' ? 'Pedido enviado. A resposta chega no Mural em alguns minutos.' : 'Pedido guardado. O servidor vai tentar de novo em 10 minutos.', r.status !== 'enviado');
      return muCarregar(true);
    }).then(function () { if (S.view === 'mural' && S.mu.sub === 'ped') muPedir(); }).catch(function (e) { btn.disabled = false; btn.innerHTML = ic('send', 's') + 'Enviar ao assistente'; fail(e); });
  };
}

/* Resposta na hora pela API: o servidor escreve o recado e o app abre o aviso "Resposta pronta" */
function muResponder(id) {
  call('responderPedido', id).then(function (r) {
    return muCarregar(true).then(function () {
      if (S.view === 'mural' && !($('#muTx') && $('#muTx').value.trim())) muRender();
      if (r && r.ok && r.muralId) toast('Resposta do assistente pronta.', false, { label: 'Ver', fn: function () { S.mu.cartao = r.muralId; go('cartao'); } });
      else if (r && r.status === 'erro') toast(r.erro || 'O assistente não conseguiu responder.', true);
    });
  }).catch(function () {});   // demorou mais que o app espera: o servidor termina sozinho e o Mural atualiza em seguida
}

/* ---------- editor do cardápio (post 1080×1080 e story 1080×1920) ---------- */
function muCardapioBase() {
  var u = S.mu.dados && S.mu.dados.ultimoCardapio, h = S.boot.hoje, dow = pd(h).getDay(), seg = isoAdd(h, ((8 - dow) % 7) || 7), sex = isoAdd(seg, 4);
  var per = seg.slice(8) + ' a ' + sex.slice(8) + '/' + sex.slice(5, 7);
  if (u) { var c = JSON.parse(JSON.stringify(u)); c.periodo = per; return c; }
  return { titulo: 'Cardápio da semana', periodo: per, itens: ((S.boot && S.boot.produtos) || []).slice(0, 3).map(function (p) { return { nome: p.nome, desc: '', peso: '', preco: 'R$ ' + String(p.preco).replace('.', ','), qtd: '' }; }), prazo: 'Cookies de pronta-entrega, assados no dia', retirada: 'Retirada combinada pelo WhatsApp', nota: 'Bolo sob encomenda com 2 dias de antecedência · entrega por motoboy por conta da cliente' };
}
function vCardapio() {
  if (!S.cdp) S.cdp = { id: '', dados: muCardapioBase(), legenda: '' };
  var c = S.cdp.dados;
  var item = function (it, i) {
    return '<div class="cd-it" data-i="' + i + '"><div class="cd-hd"><b>Item ' + (i + 1) + '</b><span><button class="icb" data-up="' + i + '" aria-label="Subir">' + ic('back', 's') + '</button><button class="icb" data-rm="' + i + '" aria-label="Remover">' + ic('trash', 's') + '</button></span></div>' +
      '<div class="fld"><label>Produto</label><input data-k="nome" value="' + esc(it.nome) + '" maxlength="60" placeholder="Bolo caseirinho de banana"></div>' +
      '<div class="fld"><label>Descrição (sabor, textura)</label><input data-k="desc" value="' + esc(it.desc) + '" maxlength="110" placeholder="Massa úmida, canela e doce de leite"></div>' +
      '<div class="cd-3"><div class="fld"><label>Peso ou tamanho</label><input data-k="peso" value="' + esc(it.peso) + '" maxlength="30" placeholder="900 g"></div><div class="fld"><label>Preço</label><input data-k="preco" value="' + esc(it.preco) + '" maxlength="20" placeholder="R$ 70"></div><div class="fld"><label>Quantidade</label><input data-k="qtd" value="' + esc(it.qtd) + '" maxlength="30" placeholder="10 unidades"></div></div>' +
      '<label class="cd-dest"><input type="checkbox" data-k="destaque"' + (it.destaque ? ' checked' : '') + '> Destaque (o mais vendido)</label></div>';
  };
  var h = '<div class="page cd"><div class="cd-prev"><canvas id="cdCv" width="1080" height="1080"></canvas><p id="cdAv" class="cd-av" hidden>Texto demais para caber: as descrições foram encurtadas. Tire um item ou resuma as descrições.</p></div>' +
    '<div class="seg" id="cdFmt"><button class="on" data-k="post">Post 1080×1080</button><button data-k="story">Story 1080×1920</button></div>' +
    '<div class="card"><div class="fld"><label>Título</label><input id="cdT" value="' + esc(c.titulo) + '" maxlength="60"></div><div class="fld"><label>Semana</label><input id="cdP" value="' + esc(c.periodo) + '" maxlength="40" placeholder="19 a 23/10"></div></div>' +
    '<div id="cdIts">' + c.itens.map(item).join('') + '</div>' + (c.itens.length < 6 ? '<button class="btn sec" id="cdAdd">' + ic('plus', 's') + 'Adicionar item</button>' : '') +
    '<div class="card" style="margin-top:12px"><div class="fld"><label>Como pedir</label><input id="cdPz" value="' + esc(c.prazo) + '" maxlength="80"></div><div class="fld"><label>Retirada</label><input id="cdRt" value="' + esc(c.retirada) + '" maxlength="100"></div><div class="fld" style="margin:0"><label>Observação</label><input id="cdNt" value="' + esc(c.nota) + '" maxlength="140"></div></div>' +
    '<div class="btns"><button class="btn" id="cdGer">' + ic('out', 's') + 'Gerar e salvar a imagem</button>' + (S.cdp.legenda ? '<button class="btn sec" id="cdLeg">' + ic('doc', 's') + 'Copiar a legenda</button>' : '') + '<button class="btn sec" id="cdIg">Abrir o Instagram</button></div>' +
    '<p class="muted" style="margin:10px 0 24px">Gere o post e, se quiser, troque para Story e gere de novo. As duas imagens saem com o nome e as cores da marca. O texto fica guardado para a próxima semana.</p></div>';
  $('#app').innerHTML = h;
  var fmt = 'post';
  var ler = function () {
    c.titulo = $('#cdT').value.trim(); c.periodo = $('#cdP').value.trim(); c.prazo = $('#cdPz').value.trim(); c.retirada = $('#cdRt').value.trim(); c.nota = $('#cdNt').value.trim();
    $$('.cd-it').forEach(function (el) { var it = c.itens[el.dataset.i]; $$('[data-k]', el).forEach(function (x) { it[x.dataset.k] = x.type === 'checkbox' ? x.checked : x.value.trim(); }); });
  };
  var desenhar = function () { ler(); return cdDesenhar($('#cdCv'), c, fmt).then(function (r) { var a = $('#cdAv'); if (a) a.hidden = !r || r.cabe; return r; }); };
  var sujo = false, redesenharDepois = (function () { var tm; return function () { sujo = true; clearTimeout(tm); tm = setTimeout(function () { desenhar().then(function () { sujo = false; }); }, 250); }; })();
  $$('.cd input').forEach(function (x) { x.oninput = redesenharDepois; x.onchange = redesenharDepois; });
  $$('#cdFmt button').forEach(function (b) { b.onclick = function () { $$('#cdFmt button').forEach(function (x) { x.classList.toggle('on', x === b); }); fmt = b.dataset.k; sujo = true; desenhar().then(function () { sujo = false; }); }; });
  $$('[data-rm]').forEach(function (b) { b.onclick = function () { ler(); if (c.itens.length <= 1) return toast('O cardápio precisa de pelo menos um item.', true); c.itens.splice(+b.dataset.rm, 1); vCardapio(); }; });
  $$('[data-up]').forEach(function (b) { b.onclick = function () { ler(); var i = +b.dataset.up; if (!i) return; var x = c.itens.splice(i, 1)[0]; c.itens.splice(i - 1, 0, x); vCardapio(); }; });
  if ($('#cdAdd')) $('#cdAdd').onclick = function () { ler(); c.itens.push({ nome: '', desc: '', peso: '', preco: '', qtd: '' }); vCardapio(); };
  if ($('#cdLeg')) $('#cdLeg').onclick = function () { muCopiar(S.cdp.legenda, 'Legenda copiada. No Instagram, toque na legenda e cole.'); };
  $('#cdIg').onclick = muAbrirInstagram;
  $('#cdGer').onclick = function () {
    var b = this; ler();
    if (!c.itens.some(function (i) { return i.nome; })) return toast('Preencha pelo menos um produto.', true);
    var nome = 'cardapio-' + (fmt === 'story' ? 'story-' : '') + (c.periodo || 'semana').replace(/[^\w]+/g, '-') + '.png';
    // iPhone: a folha de compartilhar só abre se for chamada direto no toque; com a prévia em dia, a imagem sai na hora
    if (!sujo) muCompartilharBlob(cdBlob($('#cdCv')), nome, c.titulo);
    else { b.disabled = true; desenhar().then(function () { sujo = false; b.disabled = false; muCompartilharBlob(cdBlob($('#cdCv')), nome, c.titulo); }); }
    call('salvarCardapio', S.cdp.id, c, S.pessoa).then(function (r) { if (S.mu.dados) S.mu.dados.ultimoCardapio = r.cardapio; }).catch(function () {});
  };
  sujo = true; desenhar().then(function () { sujo = false; });
}

/* Desenho no padrão da marca (manual v1.0): fundo linho, selo rendado, DM Serif Display nos títulos e preços,
   Nunito Sans no texto; título 96, subtítulo 52, item 46, texto 32, preço 52, rótulo 28. */
function cdFontes() {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.all(['400 96px "DM Serif Display"', 'italic 400 52px "DM Serif Display"', '400 32px "Nunito Sans"', '700 32px "Nunito Sans"', '800 28px "Nunito Sans"'].map(function (f) { return document.fonts.load(f).catch(function () {}); }));
}
function cdDesenhar(cv, c, fmt) {
  return cdFontes().then(function () {
    var x = cv.getContext('2d'), W = 1080, H = fmt === 'story' ? 1920 : 1080, M = 72, AM = '#4E1730', LI = '#F4ECE2', TI = '#231318', SUB = '#6B5560', OU = '#7A5A1E', RC = '#E3B3BE', PA = '#FFFCF8';
    var SER = '"DM Serif Display", Georgia, serif', SAN = '"Nunito Sans", -apple-system, sans-serif';
    cv.width = W; cv.height = H;
    x.fillStyle = LI; x.fillRect(0, 0, W, H);
    var linhas = function (txt, larg, fonte) { x.font = fonte; var ps = String(txt || '').split(/\s+/), out = [], l = ''; ps.forEach(function (p) { var t = l ? l + ' ' + p : p; if (x.measureText(t).width > larg && l) { out.push(l); l = p; } else l = t; }); if (l) out.push(l); return out; };
    // cabeçalho: selo + nome
    var top = fmt === 'story' ? 150 : 64, s = 1.15;
    x.save(); x.translate(M, top); x.scale(s, s);
    x.fillStyle = RC; x.fill(new Path2D(RENDADO));
    x.beginPath(); x.arc(60, 60, 33, 0, Math.PI * 2); x.fillStyle = AM; x.fill();
    x.setLineDash([0.1, 6]); x.lineCap = 'round'; x.lineWidth = 2.2; x.strokeStyle = AM; x.beginPath(); x.arc(60, 60, 40, 0, Math.PI * 2); x.stroke(); x.setLineDash([]);
    x.fillStyle = LI; x.font = '34px ' + SER; x.textAlign = 'center'; x.fillText('RM', 60, 72); x.textAlign = 'left';
    x.restore();
    var nx = M + 120 * s + 26;
    x.fillStyle = AM; x.font = '46px ' + SER; x.fillText('Confeitaria', nx, top + 60);
    x.font = 'italic 40px ' + SER; x.fillText('Artesanal', nx, top + 106);
    // título e semana
    var y = top + 120 * s + (fmt === 'story' ? 110 : 78);
    x.fillStyle = AM; x.font = (fmt === 'story' ? 104 : 92) + 'px ' + SER; x.fillText(c.titulo || 'Cardápio da semana', M, y);
    y += 62; x.fillStyle = OU; x.font = 'italic 52px ' + SER; x.fillText(c.periodo || '', M, y);
    // rodapé ameixa (como pedir): altura calculada pelo conteúdo, para nada se sobrepor
    var ST = fmt === 'story', LW = W - 2 * M - 30, fPz = ST ? 36 : 31, fNt = ST ? 30 : 26, lhPz = ST ? 50 : 42, lhNt = ST ? 42 : 34;
    var lPz = []; [c.prazo, c.retirada].filter(Boolean).forEach(function (l) { lPz = lPz.concat(linhas(l, LW, '700 ' + fPz + 'px ' + SAN)); });
    var lNt = c.nota ? linhas(c.nota, LW, '400 ' + fNt + 'px ' + SAN).slice(0, 2) : [];
    var ct = 'PEDIDOS NO WHATSAPP ' + MU_WA + '  ·  ' + MU_IG.toUpperCase(), fc = ST ? 30 : 25;
    do { x.font = '800 ' + fc + 'px ' + SAN; } while (x.measureText(ct).width > LW && --fc > 16);
    var padT = ST ? 64 : 50, padB = ST ? 44 : 32, rh = padT + lPz.length * lhPz + lNt.length * lhNt + (lNt.length ? 8 : 0) + fc + padB;
    var baixo = ST ? 150 : 40, ry = H - baixo - rh;
    // itens: mede o bloco em várias escalas e usa a maior que cabe entre o título e o rodapé
    var its = c.itens.filter(function (i) { return i.nome; }), y0 = y + 34, dispo = ry - 30 - y0;
    var plano = function (k, descLinhas) {
      var fN = Math.round(46 * k), fD = Math.round(31 * Math.max(k, .72)), fP = Math.round(52 * k), gap = Math.round((ST ? 44 : 26) * k), fQ = Math.round(fD * 0.86);
      var blocos = its.map(function (it) {
        x.font = fP + 'px ' + SER; var precoW = x.measureText(it.preco || '').width;
        var ln = linhas(it.nome, W - 2 * M - precoW - 30, fN + 'px ' + SER).slice(0, 2);
        var info = [it.desc, it.peso].filter(Boolean).join(' · ');
        var ld = info ? linhas(info, W - 2 * M - (ln.length > 1 ? 0 : 0), '400 ' + fD + 'px ' + SAN) : [];
        if (ld.length > descLinhas) { ld = ld.slice(0, descLinhas); ld[descLinhas - 1] = ld[descLinhas - 1].replace(/\s*\S*$/, '') + '…'; }
        var h = (it.destaque ? 34 : 0) + fN * 0.8 + (ln.length - 1) * fN * 1.08 + ld.length * fD * 1.3 + (it.qtd ? fD * 1.35 : 0);
        return { it: it, ln: ln, ld: ld, h: h };
      });
      var total = blocos.reduce(function (s, b) { return s + b.h; }, 0) + Math.max(0, blocos.length - 1) * (gap * 2 + 22) + gap;
      return { k: k, fN: fN, fD: fD, fP: fP, fQ: fQ, gap: gap, blocos: blocos, total: total };
    };
    var pl = null, kmax = ST ? 1.3 : 1;
    for (var dl = 2; dl >= 1 && !pl; dl--) for (var k = kmax; k >= 0.62; k -= 0.04) { var tent = plano(k, dl); if (tent.total <= dispo) { pl = tent; break; } }
    var cabe = !!pl; if (!pl) pl = plano(0.62, 1);
    y = y0 + pl.gap + (ST && pl.total < dispo ? Math.min(120, (dispo - pl.total) / 3) : 0);   // story: respiro acima dos itens
    x.save(); x.beginPath(); x.rect(0, 0, W, ry - 12); x.clip();   // nunca invade o rodapé
    pl.blocos.forEach(function (b, i) {
      var it = b.it, fN = pl.fN, fD = pl.fD;
      if (it.destaque) { x.fillStyle = OU; x.font = '800 ' + Math.round(24 * Math.max(pl.k, .8)) + 'px ' + SAN; x.fillText('O MAIS PEDIDO', M, y + 4); y += 34; }
      x.fillStyle = TI; x.font = fN + 'px ' + SER; b.ln.forEach(function (l, k) { x.fillText(l, M, y + fN * 0.8 + k * fN * 1.08); });
      x.fillStyle = AM; x.font = pl.fP + 'px ' + SER; x.textAlign = 'right'; x.fillText(it.preco || '', W - M, y + fN * 0.82); x.textAlign = 'left';
      var yy = y + fN * 0.8 + (b.ln.length - 1) * fN * 1.08;
      x.fillStyle = SUB; x.font = '400 ' + fD + 'px ' + SAN; b.ld.forEach(function (l) { yy += fD * 1.3; x.fillText(l, M, yy); });
      if (it.qtd) { yy += fD * 1.35; x.fillStyle = OU; x.font = '800 ' + pl.fQ + 'px ' + SAN; x.fillText(String(it.qtd).toUpperCase(), M, yy); }
      y = yy + pl.gap * 2 + 22;
      if (i < pl.blocos.length - 1) { x.strokeStyle = '#E2D5C7'; x.lineWidth = 2; x.beginPath(); x.moveTo(M, y - pl.gap - 11); x.lineTo(W - M, y - pl.gap - 11); x.stroke(); }
    });
    x.restore();
    x.fillStyle = AM; cdRet(x, M - 12, ry, W - 2 * M + 24, rh, 28); x.fill();
    var ty = ry + padT;
    x.fillStyle = PA; x.font = '700 ' + fPz + 'px ' + SAN; lPz.forEach(function (q) { x.fillText(q, M + 18, ty); ty += lhPz; });
    x.fillStyle = RC; x.font = '400 ' + fNt + 'px ' + SAN; lNt.forEach(function (q) { x.fillText(q, M + 18, ty - lhPz + lhNt + 4); ty += lhNt; });
    x.fillStyle = PA; x.font = '800 ' + fc + 'px ' + SAN; x.fillText(ct, M + 18, ry + rh - padB);
    return { cabe: cabe };
  });
}
function cdBlob(cv) { var u = cv.toDataURL('image/png'), bin = atob(u.split(',')[1]), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: 'image/png' }); }
function cdRet(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }

/* Mural carrega em segundo plano ao abrir o app, para o número no ícone aparecer */
setTimeout(function () { if (S.token && !window.MOCK) muCarregar().catch(function () {}); }, 2500);
// pedido ao assistente aguardando resposta: atualiza o Mural de 45 em 45 s enquanto a tela estiver aberta
setInterval(function () {
  var d = S.mu && S.mu.dados; if (!d || !S.token || window.MOCK || document.visibilityState !== 'visible' || S.view !== 'mural') return;
  if (!(d.pedidos || []).some(function (p) { return p.status === 'enviado' || p.status === 'aberto'; })) return;
  muCarregar().then(function () { var tx = $('#muTx'); if (S.view === 'mural' && !(tx && tx.value.trim()) && !document.querySelector('textarea:focus, input:focus')) muRender(); }).catch(function () {});
}, 20000);
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && S.token && !window.MOCK) muCarregar().then(function () { if (S.view === 'mural') muRender(); }).catch(function () {}); });
