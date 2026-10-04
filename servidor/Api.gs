/**
 * Api.gs — porta de entrada do app novo (PWA no GitHub Pages), 03/10/2026.
 * O app chama esta API sempre com POST e corpo JSON enviado como text/plain (sem pré-verificação de CORS).
 * O app antigo (doGet + google.script.run) continua funcionando ao mesmo tempo, com o mesmo endereço /exec.
 *
 * Login: pessoa (Raquel ou Bruno) + PIN da aba Config. Cinco tentativas erradas bloqueiam 15 minutos.
 * Sessão: token aleatório de 64 caracteres; na planilha fica só o hash (aba Sessoes). Validade: Config › dias_sessao (padrão 60).
 * Chamadas: o app manda { acao: 'rpc', token, fn, args }. O servidor confere o token, confere se a função está na lista
 * permitida e chama a mesma função que o app antigo usa, passando o PIN da Config no lugar do PIN digitado.
 * Assim as regras de negócio (pedidos, DRE, estoque, Clube) ficam num lugar só.
 */
var API_VERSAO = '1.1.0';
var API_PESSOAS = ['Raquel', 'Bruno'];
var API_CAB_SESSOES = ['ID', 'TokenHash', 'Pessoa', 'CriadoEm', 'ExpiraEmMs', 'Aparelho', 'UltimoUso', 'Ativa'];

/* Funções que o app pode chamar (todas recebem o PIN como 1º argumento). Fora desta lista: recusado. */
function apiFuncoes_() {
  return {
    getBootstrap: getBootstrap, getHoje: getHoje, getPedidosAbertos: getPedidosAbertos, getPedidosHistorico: getPedidosHistorico,
    salvarPedido: salvarPedido, atualizarPedido: atualizarPedido, editarPedido: editarPedido,
    salvarDespesa: salvarDespesa, salvarSemana: salvarSemana, getSemana: getSemana,
    marcarTarefa: marcarTarefa, novaTarefa: novaTarefa, editarTarefa: editarTarefa, excluirTarefa: excluirTarefa,
    getIndicadores: getIndicadores, getReuniao: getReuniao, salvarReuniao: salvarReuniao,
    getAcoes: getAcoes, salvarAcao: salvarAcao, atualizarAcao: atualizarAcao, editarAcao: editarAcao,
    getEstoque: getEstoque, salvarContagem: salvarContagem, posAlteracao: posAlteracao,
    getPainel: getPainel, getRoadmap: getRoadmap,
    getAjuda: getAjuda, perguntarAjuda: perguntarAjuda, registrarPergunta: registrarPergunta,
    getMensagens: getMensagens, salvarMensagem: salvarMensagem
  };
}

function doPost(e) {
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (x) { return apiSaida_({ ok: false, erro: 'Pedido inválido.', codigo: 'JSON' }); }
  try {
    return apiSaida_({ ok: true, dados: apiRotear_(req), versao: API_VERSAO });
  } catch (err) {
    var cod = err.codigo || 'ERRO';
    if (cod === 'ERRO') apiLogErro_(req, err);
    return apiSaida_({ ok: false, erro: String(err.message || err).replace(/^Exception:\s*/, ''), codigo: cod });
  }
}

function apiRotear_(req) {
  switch (req.acao) {
    case 'ping': return { versao: API_VERSAO, hora: new Date().toISOString() };
    case 'login': return apiLogin_(req);
  }
  var s = apiAutenticar_(req.token);
  switch (req.acao) {
    case 'rpc': return apiRpc_(s, req);
    case 'sair': return apiEncerrar_(s.pessoa, req.token);
    case 'sairTodos': return apiEncerrar_(s.pessoa, null);
    case 'pushConfig': case 'registrarPush': case 'preferenciasPush': case 'removerPush': case 'testarPush':
      if (typeof pushApi_ !== 'function') throw apiErro_('Avisos ainda não instalados no servidor (falta o arquivo Push).', 'CONFIG');
      return pushApi_(req.acao, s, req);
  }
  throw apiErro_('Ação desconhecida.', 'ACAO');
}

function apiSaida_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function apiErro_(msg, codigo) { var e = new Error(msg); e.codigo = codigo || 'ERRO'; return e; }
function apiHash_(t) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(t), Utilities.Charset.UTF_8);
  return 'h' + b.map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('');
}
/* Comparação sem atalho (o tempo não revela quantos dígitos acertou) */
function apiIgual_(a, b) {
  a = String(a); b = String(b);
  var d = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

function apiSessoes_() {
  var sh = sh_('Sessoes');
  if (!sh) {
    sh = ss_().insertSheet('Sessoes');
    sh.getRange(1, 1, 1, API_CAB_SESSOES.length).setValues([API_CAB_SESSOES]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), API_CAB_SESSOES.length).setNumberFormat('@'); // texto puro: o Sheets não converte datas nem números
  }
  return sh;
}

function apiLogin_(req) {
  var pessoa = String(req.pessoa || '');
  if (API_PESSOAS.indexOf(pessoa) < 0) throw apiErro_('Escolha quem está usando o app.', 'LOGIN');
  var cache = CacheService.getScriptCache(), chave = 'rm_tent_' + pessoa;
  var tent = Number(cache.get(chave) || 0);
  if (tent >= 5) throw apiErro_('Muitas tentativas erradas. Aguarde 15 minutos.', 'BLOQUEADO');
  var c = config_();
  if (!c.pin) throw apiErro_('PIN não configurado na aba Config.', 'SETUP');
  if (!apiIgual_(String(req.pin || '').trim(), String(c.pin).trim())) {
    cache.put(chave, String(tent + 1), 15 * 60);
    throw apiErro_('PIN incorreto. Tentativas restantes: ' + Math.max(0, 4 - tent) + '.', 'PIN');
  }
  cache.remove(chave);
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var dias = Number(c.dias_sessao) || 60, agora = new Date();
  apiSessoes_().appendRow(['S' + agora.getTime(), apiHash_(token), pessoa, agora.toISOString(),
    String(agora.getTime() + dias * 864e5), String(req.aparelho || '').slice(0, 120), agora.toISOString(), 'sim']);
  return { token: token, pessoa: pessoa, diasSessao: dias, boot: JSON.parse(JSON.stringify(getBootstrap(c.pin))) };
}

function apiAutenticar_(token) {
  if (!token || String(token).length < 32) throw apiErro_('Sessão expirada. Entre de novo.', 'SESSAO');
  var h = apiHash_(token), cache = CacheService.getScriptCache();
  var pessoa = cache.get('rm_ses_' + h);
  if (!pessoa) {
    var sh = apiSessoes_(), n = sh.getLastRow() - 1, agora = new Date().toISOString(), ms = Date.now(), achou = null;
    if (n > 0) {
      var v = sh.getRange(2, 1, n, API_CAB_SESSOES.length).getValues();
      for (var i = 0; i < v.length; i++) {
        if (String(v[i][1]) === h && String(v[i][7]) === 'sim' && Number(v[i][4]) > ms) { achou = { linha: i + 2, pessoa: String(v[i][2]) }; break; }
      }
    }
    if (!achou) throw apiErro_('Sessão expirada. Entre de novo.', 'SESSAO');
    pessoa = achou.pessoa;
    sh.getRange(achou.linha, 7).setValue(agora);
    cache.put('rm_ses_' + h, pessoa, 600);
  }
  return { pessoa: pessoa, tokenHash: h };
}

function apiRpc_(s, req) {
  var mapa = apiFuncoes_(), fn = String(req.fn || '');
  if (!Object.prototype.hasOwnProperty.call(mapa, fn)) throw apiErro_('Função não permitida: ' + fn, 'ACAO');
  var args = Array.isArray(req.args) ? req.args : [];
  if (args.length > 8) throw apiErro_('Argumentos demais.', 'VALIDACAO');
  var r = mapa[fn].apply(null, [config_().pin].concat(args));
  return r === undefined ? null : JSON.parse(JSON.stringify(r)); // datas viram texto, como no app antigo
}

function apiEncerrar_(pessoa, soEsteToken) {
  var sh = apiSessoes_(), n = sh.getLastRow() - 1, cache = CacheService.getScriptCache(), alvo = soEsteToken ? apiHash_(soEsteToken) : null, k = 0;
  if (n <= 0) return { encerradas: 0 };
  var v = sh.getRange(2, 1, n, API_CAB_SESSOES.length).getValues();
  v.forEach(function (r, i) {
    if (String(r[2]) === pessoa && String(r[7]) === 'sim' && (!alvo || String(r[1]) === alvo)) { sh.getRange(i + 2, 8).setValue('não'); cache.remove('rm_ses_' + r[1]); k++; }
  });
  return { encerradas: k };
}

/** Rodar no editor se um celular for perdido ou o PIN mudar: encerra todas as sessões do app novo. */
function encerrarTodasSessoes() {
  var sh = apiSessoes_(), n = sh.getLastRow() - 1, cache = CacheService.getScriptCache();
  if (n <= 0) return 0;
  var v = sh.getRange(2, 1, n, API_CAB_SESSOES.length).getValues();
  v.forEach(function (r, i) { if (String(r[7]) === 'sim') { sh.getRange(i + 2, 8).setValue('não'); cache.remove('rm_ses_' + r[1]); } });
  Logger.log('Sessões encerradas: ' + n);
  return n;
}

function apiLogErro_(req, err) {
  try { Logger.log('API ' + (req && (req.fn || req.acao)) + ': ' + (err && err.stack || err)); } catch (x) { /* nada */ }
}
