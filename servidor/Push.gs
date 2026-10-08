/**
 * Push.gs — avisos no celular (Web Push pelo Firebase Cloud Messaging), 04/10/2026.
 * O servidor decide QUANDO avisar; o app só pede permissão, registra o aparelho e escolhe os tipos.
 * No iPhone, só funciona com o app instalado na tela de início (iOS 16.4 ou mais novo).
 *
 * Configuração (uma vez, pelo celular):
 *   Config › firebase_web_config      bloco firebaseConfig do console do Firebase (com ou sem "const firebaseConfig =")
 *   Config › firebase_vapid_key       chave do par "Web Push certificates" (Cloud Messaging)
 *   Config › firebase_service_account conteúdo do arquivo JSON da conta de serviço. No primeiro uso o script
 *                                     guarda nas Propriedades do script (FCM_SERVICE_ACCOUNT) e limpa a célula.
 * Depois rodar ativarAvisos() uma vez (cria o gatilho de hora em hora).
 * Aparelhos ficam na aba Push. Endereço recusado pelo Firebase (aparelho desinstalado) é desativado sozinho.
 */
var PUSH_CAB = ['Token', 'Pessoa', 'Plataforma', 'Tipos', 'CriadoEm', 'AtualizadoEm', 'Ativo', 'UltimoErro'];
var PUSH_TIPOS = {
  manha: 'Bom dia às 7h: tarefas, retiradas e Pix pendente',
  vespera: 'Véspera de retirada, às 18h (para lembrar as clientes)',
  pix: 'Pix pendente há mais de 1 dia, às 10h',
  producao: 'Lista de produção pronta (terça, 20h30)',
  estoque: 'Contar o estoque (último dia do mês, 9h)',
  painel: 'Painel da semana (domingo, 18h)'
};
var PUSH_PADRAO = { Raquel: ['manha', 'vespera', 'pix', 'producao', 'estoque', 'painel'], Bruno: ['manha', 'pix', 'producao', 'painel'] };

/* ------------------------------ configuração ------------------------------ */

function pushWebConfig_() {
  var t = String(config_().firebase_web_config || '').trim();
  if (!t) return null;
  var m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  var s = m[0].replace(/^\s*\/\/.*$/gm, '').replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*\}/g, '}');
  try { var o = JSON.parse(s); return o.apiKey && o.projectId && o.messagingSenderId && o.appId ? o : null; } catch (e) { return null; }
}

function pushContaServico_() {
  var props = PropertiesService.getScriptProperties();
  var sh = sh_('Config'), n = sh.getLastRow() - 1;
  if (n > 0) {   // move a chave da planilha para as Propriedades do script e limpa a célula
    var v = sh.getRange(2, 1, n, 2).getValues();
    for (var i = 0; i < v.length; i++) {
      if (String(v[i][0]).trim() === 'firebase_service_account' && String(v[i][1]).trim()) {
        var j = pushLerConta_(String(v[i][1]));
        if (j) { props.setProperty('FCM_SERVICE_ACCOUNT', JSON.stringify(j)); sh.getRange(i + 2, 2).setValue('(guardada nas Propriedades do script)'); }
        break;
      }
    }
  }
  var p = props.getProperty('FCM_SERVICE_ACCOUNT');
  return p ? pushLerConta_(p) : null;
}
function pushLerConta_(txt) {
  try { var j = JSON.parse(String(txt).trim()); return j.client_email && j.private_key && j.project_id ? j : null; } catch (e) { return null; }
}

function pushStatus_() {
  var c = config_(), web = pushWebConfig_(), sa = pushContaServico_(), vapid = String(c.firebase_vapid_key || '').trim();
  var falta = [];
  if (!web) falta.push('firebase_web_config');
  if (!vapid) falta.push('firebase_vapid_key');
  if (!sa) falta.push('firebase_service_account');
  return { ativo: !falta.length, falta: falta, web: web, vapid: vapid, sa: sa };
}

/* ------------------------------ API (chamada pelo Api.gs) ------------------------------ */

function pushApi_(acao, sessao, req) {
  if (acao === 'pushConfig') {
    var st = pushStatus_();
    return { ativo: st.ativo, falta: st.falta, webConfig: st.web, vapidKey: st.vapid, tipos: PUSH_TIPOS, padrao: PUSH_PADRAO[sessao.pessoa] || [] };
  }
  var tok = String(req.token_push || '');
  if (tok.length < 20 || tok.length > 4096) throw apiErro_('Endereço de notificação inválido.', 'VALIDACAO');
  if (acao === 'registrarPush') return { tipos: pushGravar_(tok, sessao.pessoa, req.plataforma, req.tipos) };
  if (acao === 'preferenciasPush') return { tipos: pushGravar_(tok, sessao.pessoa, null, req.tipos) };
  if (acao === 'removerPush') { pushDesativar_(tok, 'removido no aparelho'); return { ok: true }; }
  if (acao === 'testarPush') {
    var r = pushEnviar_(tok, { titulo: 'RM · teste', corpo: 'As notificações estão funcionando neste aparelho.', url: '#hoje', tag: 'teste' });
    if (!r.ok) throw apiErro_('O Firebase recusou o envio: ' + r.erro, 'EXTERNO');
    return { ok: true };
  }
  throw apiErro_('Ação desconhecida.', 'ACAO');
}

function pushAba_() {
  var sh = sh_('Push');
  if (!sh) {
    sh = ss_().insertSheet('Push');
    sh.getRange(1, 1, 1, PUSH_CAB.length).setValues([PUSH_CAB]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), PUSH_CAB.length).setNumberFormat('@');
  }
  return sh;
}

function pushGravar_(tok, pessoa, plataforma, tipos) {
  var validos = (Array.isArray(tipos) ? tipos : []).filter(function (t) { return PUSH_TIPOS[t]; });
  var sh = pushAba_(), n = sh.getLastRow() - 1, agora = new Date().toISOString(), lin = 0;
  if (n > 0) sh.getRange(2, 1, n, 1).getValues().forEach(function (r, i) { if (String(r[0]) === tok) lin = i + 2; });
  if (lin) {
    var atual = sh.getRange(lin, 1, 1, PUSH_CAB.length).getValues()[0];
    sh.getRange(lin, 1, 1, PUSH_CAB.length).setValues([[tok, pessoa, plataforma || atual[2], validos.join(','), atual[4], agora, 'sim', '']]);
  } else {
    sh.appendRow([tok, pessoa, String(plataforma || '').slice(0, 30), validos.join(','), agora, agora, 'sim', '']);
  }
  return validos;
}

function pushDesativar_(tok, motivo) {
  var sh = pushAba_(), n = sh.getLastRow() - 1;
  if (n <= 0) return;
  sh.getRange(2, 1, n, 1).getValues().forEach(function (r, i) {
    if (String(r[0]) === tok) { sh.getRange(i + 2, 7, 1, 2).setValues([['não', String(motivo || '').slice(0, 200)]]); }
  });
}

function pushAparelhos_(pessoa, tipo) {
  var sh = pushAba_(), n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, PUSH_CAB.length).getValues().filter(function (r) {
    return String(r[6]) === 'sim' && String(r[1]) === pessoa && String(r[3]).split(',').indexOf(tipo) >= 0;
  }).map(function (r) { return String(r[0]); });
}

/* ------------------------------ envio (FCM HTTP v1) ------------------------------ */

function pushAcesso_(sa) {
  var cache = CacheService.getScriptCache(), c = cache.get('fcm_acesso');
  if (c) return c;
  var b64 = function (s) { return Utilities.base64EncodeWebSafe(s).replace(/=+$/, ''); };
  var agora = Math.floor(Date.now() / 1000);
  var cab = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var corpo = b64(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: agora, exp: agora + 3600 }));
  var ass = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(cab + '.' + corpo, sa.private_key)).replace(/=+$/, '');
  var r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: cab + '.' + corpo + '.' + ass } });
  if (r.getResponseCode() !== 200) throw new Error('Google não liberou o acesso ao Firebase (' + r.getResponseCode() + '): ' + r.getContentText().slice(0, 200));
  var tok = JSON.parse(r.getContentText()).access_token;
  cache.put('fcm_acesso', tok, 3000);
  return tok;
}

/** Envia para um aparelho. Devolve { ok, erro }. Endereço inválido ou desinstalado é desativado. */
function pushEnviar_(tok, msg) {
  var sa = pushContaServico_();
  if (!sa) return { ok: false, erro: 'conta de serviço do Firebase não configurada' };
  try {
    var r = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + pushAcesso_(sa) },
      payload: JSON.stringify({ message: { token: tok,
        data: { titulo: String(msg.titulo || 'RM'), corpo: String(msg.corpo || ''), url: String(msg.url || '#hoje'), tag: String(msg.tag || '') },
        webpush: { headers: { Urgency: 'high', TTL: '43200' } } } })
    });
    var code = r.getResponseCode();
    if (code === 200) return { ok: true };
    var txt = r.getContentText().slice(0, 300);
    if (code === 404 || /UNREGISTERED/.test(txt)) pushDesativar_(tok, txt);   // só aparelho desinstalado: INVALID_ARGUMENT também vem de mensagem mal montada
    return { ok: false, erro: code + ' ' + txt };
  } catch (e) { return { ok: false, erro: String(e.message || e) }; }
}

function pushAvisar_(pessoa, tipo, msg) {
  var n = 0;
  pushAparelhos_(pessoa, tipo).forEach(function (t) { if (pushEnviar_(t, msg).ok) n++; });
  return n;
}

/* ------------------------------ quando avisar ------------------------------ */

/** Gatilho de hora em hora. Cada aviso sai uma vez por dia (marca nas Propriedades do script). */
function verificarAvisos() {
  if (!pushStatus_().ativo) return;
  var agora = new Date(), hoje = today_(), hora = Number(fmt_(agora, 'H')), dow = parseD_(hoje).getDay();
  if (hoje > '2027-05-02' || inPause_(hoje)) return;
  var feito = function (k) { var p = PropertiesService.getScriptProperties(), c = 'AV_' + k + '_' + hoje; if (p.getProperty(c)) return true; p.setProperty(c, '1'); return false; };
  var peds = readPedidos_().filter(function (p) { return p.status !== 'Cancelado'; });
  var abertos = peds.filter(function (p) { return p.status !== 'Retirado'; });
  var plural = function (n, s, p) { return n + ' ' + (n === 1 ? s : p); };

  if (hora === 7 && !feito('manha')) {
    var retHoje = abertos.filter(function (p) { return p.retirada === hoje; }), semPix = peds.filter(function (p) { return p.pix !== 'Sim'; });
    API_PESSOAS.forEach(function (pe) {
      var t = tarefasDe_(pe, hoje).filter(function (x) { return !x.feita; }), atr = t.filter(function (x) { return x.atrasada; }).length;
      var partes = [plural(t.length, 'tarefa', 'tarefas') + (atr ? ' (' + atr + ' atrasada' + (atr === 1 ? '' : 's') + ')' : '')];
      if (retHoje.length) partes.push(plural(retHoje.length, 'retirada', 'retiradas'));
      if (semPix.length) partes.push(plural(semPix.length, 'Pix pendente', 'Pix pendentes'));
      pushAvisar_(pe, 'manha', { titulo: 'Bom dia, ' + pe, corpo: 'Hoje: ' + partes.join(' · ') + '.', url: '#hoje', tag: 'manha' });
    });
  }
  if (hora === 10 && !feito('pix')) {
    var velhos = peds.filter(function (p) { return p.pix !== 'Sim' && p.data && p.data < hoje; });
    if (velhos.length) {
      var tot = velhos.reduce(function (s, p) { return s + (Number(p.valor) || 0); }, 0);
      var nomes = velhos.slice(0, 3).map(function (p) { return String(p.cliente).split(' ')[0]; }).join(', ') + (velhos.length > 3 ? ' e mais ' + (velhos.length - 3) : '');
      API_PESSOAS.forEach(function (pe) { pushAvisar_(pe, 'pix', { titulo: 'Pix pendente: ' + brl_(tot), corpo: nomes + '. Toque para cobrar ou marcar como pago.', url: '#pedidos', tag: 'pix' }); });
    }
  }
  if (hora === 9 && addDays_(hoje, 1).slice(8) === '01' && !feito('estoque')) {
    API_PESSOAS.forEach(function (pe) { pushAvisar_(pe, 'estoque', { titulo: 'Hoje: contar o estoque', corpo: 'Último dia do mês. No app: + › Contar o estoque (só os insumos marcados).', url: '#estoque', tag: 'estoque' }); });
  }
  if (hora === 18 && !feito('vespera')) {
    var amanha = abertos.filter(function (p) { return p.retirada === addDays_(hoje, 1); });
    if (amanha.length) {
      var semP = amanha.filter(function (p) { return p.pix !== 'Sim'; }).length;
      API_PESSOAS.forEach(function (pe) { pushAvisar_(pe, 'vespera', { titulo: 'Amanhã: ' + plural(amanha.length, 'retirada', 'retiradas'), corpo: 'Mande o lembrete pelo WhatsApp (Pedidos › Amanhã).' + (semP ? ' ' + plural(semP, 'ainda sem Pix', 'ainda sem Pix') + '.' : ''), url: '#pedidos', tag: 'vespera' }); });
    }
  }
  if (dow === 0 && hora === 18 && !feito('painel')) {
    var r = resumoSemana_(hoje);
    API_PESSOAS.forEach(function (pe) { pushAvisar_(pe, 'painel', { titulo: 'Painel da semana ' + r.semana, corpo: plural(r.pedidos, 'pedido', 'pedidos') + ' · ' + brl_(r.receita) + (r.meta ? ' de ' + brl_(r.meta) : '') + '. Prioridades da semana no app.', url: '#gestao', tag: 'painel' }); });
  }
  if (dow === 2 && hora === 20 && hoje >= CICLO_INICIO && !feito('producao')) {
    var ini = weekStart_(hoje), sem = peds.filter(function (p) { return p.data >= ini; }), un = 0;
    sem.forEach(function (p) { String(p.itens).split(';').forEach(function (s) { var m = s.trim().match(/^(\d+)\s*x/i); if (s.trim() && !REPASSE_RE.test(s)) un += m ? +m[1] : 1; }); });
    API_PESSOAS.forEach(function (pe) { pushAvisar_(pe, 'producao', { titulo: 'Lista de produção pronta', corpo: plural(sem.length, 'pedido', 'pedidos') + ' · ' + un + ' itens. Detalhe no e-mail das 20h30.', url: '#pedidos', tag: 'producao' }); });
  }
  if (hora === 3) pushLimparMarcas_();
}

function pushLimparMarcas_() {
  var p = PropertiesService.getScriptProperties(), todas = p.getProperties(), lim = addDays_(today_(), -10);
  Object.keys(todas).forEach(function (k) { if (k.indexOf('AV_') === 0 && k.slice(-10) < lim) p.deleteProperty(k); });
}

/** Rodar uma vez no editor: confere a configuração e cria o gatilho de hora em hora. */
function ativarAvisos() {
  var st = pushStatus_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'verificarAvisos') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('verificarAvisos').timeBased().everyHours(1).create();
  pushAba_();
  var msg = st.ativo ? 'Avisos ativados. Agora, no app: sino no topo › Ativar avisos.' : 'Gatilho criado, mas falta preencher na aba Config: ' + st.falta.join(', ');
  Logger.log(msg);
  return msg;
}

/** Para testar no editor: manda um aviso a todos os aparelhos ativos. */
function testarAvisos() {
  var sh = pushAba_(), n = sh.getLastRow() - 1, ok = 0;
  if (n > 0) sh.getRange(2, 1, n, PUSH_CAB.length).getValues().forEach(function (r) {
    if (String(r[6]) === 'sim' && pushEnviar_(String(r[0]), { titulo: 'RM · teste', corpo: 'Aviso de teste enviado pelo editor.', url: '#hoje', tag: 'teste' }).ok) ok++;
  });
  Logger.log('Avisos enviados: ' + ok);
  return ok;
}
