/**
 * Ponte.gs — liga a planilha e o Apps Script ao banco do RM Gestão (Supabase), 31/10/2026.
 *
 * Colar este arquivo no projeto do Apps Script da planilha (junto dos outros). Ele faz quatro coisas:
 *   1. Virada: copia todas as abas e as propriedades do script para o banco (ponteVirada).
 *   2. Espelho: toda noite reescreve a planilha a partir do banco (a planilha vira cópia para consulta e para o contador).
 *   3. Mural e e-mail: lê a pasta do Drive dos agentes e entrega os cartões ao banco; envia pelo Gmail os e-mails do banco.
 *   4. Encaminhamento: qualquer chamada que ainda chegue ao endereço /exec antigo é repassada ao banco (Api.gs › doPost).
 *
 * Passo a passo (uma vez, no editor):
 *   a) ponteConfigurar('https://SEU-PROJETO.supabase.co/functions/v1/api', 'O MESMO RM_SEGREDO DA FUNÇÃO')
 *   b) ponteTestar()            → confere a conexão
 *   c) ponteVirada()            → desliga os gatilhos antigos, copia tudo para o banco, confere a DRE e liga os gatilhos da ponte
 *   d) trocar o endereço em config.js do app (GitHub) para o da função; o /exec antigo continua funcionando, encaminhando
 * Para voltar ao Apps Script: ponteVoltar() e o endereço antigo em config.js.
 */
var PONTE_GATILHOS = ['ponteEspelhar', 'ponteMural', 'ponteEmails'];
var PONTE_GATILHOS_ANTIGOS = ['verificarAvisos', 'verificarMural', 'verificarMassa', 'aoEditar', 'atualizarCustoTeorico', 'emailPainel', 'emailDiario', 'emailFechamento', 'enviarAvisosPedido'];

function ponteConfigurar(url, segredo) {
  if (!/^https:\/\/.+\/functions\/v1\/api$/.test(String(url || ''))) throw new Error('Endereço esperado: https://SEU-PROJETO.supabase.co/functions/v1/api');
  if (String(segredo || '').length < 24) throw new Error('Use um segredo longo (24 caracteres ou mais), o mesmo de RM_SEGREDO na função.');
  PropertiesService.getScriptProperties().setProperties({ RM_API_URL: url, RM_SEGREDO: segredo });
  return 'Ponte configurada. Rode ponteTestar().';
}

function ponteCfg_() {
  var p = PropertiesService.getScriptProperties(), url = p.getProperty('RM_API_URL'), seg = p.getProperty('RM_SEGREDO');
  if (!url || !seg) throw new Error('Rode ponteConfigurar(url, segredo) primeiro.');
  return { url: url, segredo: seg, ativa: p.getProperty('PONTE_ATIVA') === 'sim' };
}

function ponteChamar_(corpo) {
  var c = ponteCfg_();
  corpo.segredo = c.segredo;
  var r = UrlFetchApp.fetch(c.url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(corpo), muteHttpExceptions: true });
  var txt = r.getContentText(), js;
  try { js = JSON.parse(txt); } catch (e) { throw new Error('Resposta inválida do banco (' + r.getResponseCode() + '): ' + txt.slice(0, 300)); }
  if (!js.ok) throw new Error('Banco: ' + js.erro + ' (' + js.codigo + ')');
  return js.dados;
}

/* ------------------------------------------------------------ células ------------------------------------------------------------ */
function ponteCodificar_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v) ? '' : { $d: v.toISOString() };
  if (typeof v === 'number' && !isFinite(v)) return '';
  return v;
}
function ponteDecodificar_(v) {
  if (v && typeof v === 'object' && typeof v.$d === 'string') return new Date(v.$d);
  return v === null || v === undefined ? '' : v;
}
function ponteAparar_(l) { while (l.length && (l[l.length - 1] === '' || l[l.length - 1] === null)) l.pop(); return l; }

/* ------------------------------------------------------------ 1. virada ------------------------------------------------------------ */
function ponteTestar() {
  var d = ponteChamar_({ acao: 'espelho' });
  var msg = 'Conexão OK. O banco tem ' + Object.keys(d.abas).length + ' aba(s).';
  Logger.log(msg);
  return msg;
}

/** Copia a planilha inteira e as propriedades do script para o banco (substitui o que estiver lá). */
function ponteExportar() {
  var ss = ss_(), abas = {}, total = 0;
  ss.getSheets().forEach(function (sh) {
    var v = sh.getLastRow() ? sh.getDataRange().getValues() : [];
    abas[sh.getName()] = v.map(function (l) { return ponteAparar_(l.map(ponteCodificar_)); });
    total += v.length;
  });
  var props = PropertiesService.getScriptProperties().getProperties();
  ['RM_API_URL', 'RM_SEGREDO', 'PONTE_ATIVA'].forEach(function (k) { delete props[k]; });
  var r = ponteChamar_({ acao: 'importar', abas: abas, props: props });
  Logger.log('Exportado: ' + r.abas + ' abas, ' + r.linhas + ' linhas.');
  return r;
}

/** Confere se o banco calcula a mesma DRE e os mesmos custos da planilha */
function ponteConferir() {
  var d = ponteChamar_({ acao: 'conferir' }), dre = sh_('DRE'), dif = [];
  var v = dre.getRange(1, 1, dre.getLastRow(), dre.getLastColumn()).getValues();
  v.forEach(function (l, i) {
    var b = d.dre[i]; if (!b || !l[0] || l[0] !== b[0]) return;
    for (var j = 1; j < l.length; j++) {
      var x = l[j], y = b[j];
      if (typeof x === 'number' && typeof y === 'number' && Math.abs(x - y) > 0.011) dif.push(l[0] + ' (col ' + j + '): planilha ' + x + ' · banco ' + y);
      else if ((typeof x === 'number') !== (typeof y === 'number') && x !== '' && y !== '' && y !== null) dif.push(l[0] + ' (col ' + j + '): planilha ' + x + ' · banco ' + y);
    }
  });
  var msg = dif.length ? 'Diferenças na DRE (' + dif.length + '):\n' + dif.slice(0, 30).join('\n') : 'DRE igual entre planilha e banco.';
  Logger.log(msg);
  return { ok: !dif.length, diferencas: dif };
}

function ponteVirada() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    recalcular();   // a planilha fica com os números atualizados antes da cópia
    ScriptApp.getProjectTriggers().forEach(function (t) { if (PONTE_GATILHOS_ANTIGOS.indexOf(t.getHandlerFunction()) >= 0 || PONTE_GATILHOS.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
    var r = ponteExportar();
    PropertiesService.getScriptProperties().setProperty('PONTE_ATIVA', 'sim');
  } finally { lock.releaseLock(); }
  ScriptApp.newTrigger('ponteEspelhar').timeBased().everyDays(1).atHour(3).inTimezone(TZ).create();
  ScriptApp.newTrigger('ponteMural').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('ponteEmails').timeBased().everyMinutes(10).create();
  var conf = ponteConferir();
  var msg = 'Virada feita: ' + r.abas + ' abas e ' + r.linhas + ' linhas no banco. ' + (conf.ok ? 'DRE conferida: igual.' : 'ATENÇÃO: ' + conf.diferencas.length + ' diferença(s) na DRE (ver o registro).') +
    '\nAgora: trocar o endereço em config.js do app pelo da função. Chamadas ao /exec antigo já são encaminhadas ao banco.';
  Logger.log(msg);
  return msg;
}

/** Volta ao Apps Script: a planilha recebe o que está no banco, os gatilhos antigos voltam e o encaminhamento desliga. */
function ponteVoltar() {
  ponteEspelhar(true);
  PropertiesService.getScriptProperties().deleteProperty('PONTE_ATIVA');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (PONTE_GATILHOS.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t); });
  var msgs = [];
  try { msgs.push(ativarAvisos()); } catch (e) { msgs.push('avisos: ' + e.message); }
  try { msgs.push(ativarMural()); } catch (e) { msgs.push('mural: ' + e.message); }
  try { gatilhoEdicao_(); ScriptApp.newTrigger('atualizarCustoTeorico').timeBased().everyDays(1).atHour(5).nearMinute(0).inTimezone(TZ).create(); setupPainel_(); } catch (e) { msgs.push('gatilhos: ' + e.message); }
  try { if (typeof atualizarV10 === 'function') atualizarV10(); } catch (e) { msgs.push('v10: ' + e.message); }
  var msg = 'De volta ao Apps Script. Troque o endereço em config.js pelo /exec antigo. ' + msgs.join(' · ');
  Logger.log(msg);
  return msg;
}

/* ------------------------------------------------------------ 2. espelho ------------------------------------------------------------ */
/** Reescreve a planilha a partir do banco. Células com fórmula ficam como estão. forcar = mesmo sem a ponte ativa. */
function ponteEspelhar(forcar) {
  var c = ponteCfg_(); if (!c.ativa && forcar !== true) return 'Ponte desligada';
  var d = ponteChamar_({ acao: 'espelho' }), ss = ss_(), n = 0;
  Object.keys(d.abas).forEach(function (nome) {
    var linhas = d.abas[nome] || [], sh = ss.getSheetByName(nome) || ss.insertSheet(nome);
    var nc = Math.max(1, linhas.reduce(function (m, l) { return Math.max(m, (l || []).length); }, 0), sh.getLastColumn());
    var nr = Math.max(linhas.length, sh.getLastRow());
    if (!nr) return;
    var rng = sh.getRange(1, 1, nr, nc), formulas = rng.getFormulas();
    var m = [];
    for (var i = 0; i < nr; i++) {
      var l = linhas[i] || [], out = [];
      for (var j = 0; j < nc; j++) out.push(formulas[i][j] ? formulas[i][j] : ponteDecodificar_(l[j]));
      m.push(out);
    }
    rng.setValues(m);
    n++;
  });
  ss.getSheets().forEach(function (sh) { try { if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) sh.protect().setDescription('Cópia do banco do RM Gestão: altere pelo app').setWarningOnly(true); } catch (e) { } });
  Logger.log('Espelho: ' + n + ' aba(s) atualizadas');
  return n;
}

/* ------------------------------------------------------------ 3. mural e e-mail ------------------------------------------------------------ */
function ponteMural() {
  if (!ponteCfg_().ativa) return 0;
  var pasta; try { pasta = muralPasta_(false); } catch (e) { return 0; }
  if (!pasta) return 0;
  var it = pasta.getFiles(), arquivos = [], n = 0;
  while (it.hasNext() && arquivos.length < 20) arquivos.push(it.next());
  arquivos.sort(function (a, b) { return a.getDateCreated() - b.getDateCreated(); });
  arquivos.forEach(function (f) {
    var txt = muralLerArquivo_(f).replace(/^﻿/, '').trim(), j = null, m = txt.match(/[\[{][\s\S]*[\]}]/);
    if (m) txt = m[0];
    try { j = JSON.parse(txt); } catch (e) {
      j = [{ origem: 'Sistema', para: 'Bruno', tipo: 'aviso', titulo: 'Recado de agente com formato inválido', resumo: f.getName(), corpo: 'O arquivo **' + f.getName() + '** não é um JSON válido (' + e.message + '). Ele foi para a lixeira do Drive.\n\n' + txt.slice(0, 600) }];
    }
    var lista = Array.isArray(j) ? j : (j && Array.isArray(j.cartoes) ? j.cartoes : [j]);
    var r = ponteChamar_({ acao: 'muralEntrada', cartoes: lista.slice(0, 15) });
    n += r.recebidos;
    f.setTrashed(true);
  });
  return n;
}

function ponteEmails() {
  if (!ponteCfg_().ativa) return 0;
  var lista = ponteChamar_({ acao: 'emails' }), n = 0;
  lista.forEach(function (e) {
    var o = { to: e.para, subject: e.assunto, htmlBody: e.html, name: e.nome || MARCA.nome };
    if (e.selo) o.inlineImages = { rmselo: seloBlob_() };
    MailApp.sendEmail(o); n++;
  });
  return n;
}

/* ------------------------------------------------------------ 4. encaminhamento ------------------------------------------------------------ */
/** Chamado no começo do doPost (Api.gs): com a ponte ativa, a chamada vai para o banco e a resposta volta igual. */
function ponteEncaminhar_(e) {
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty('PONTE_ATIVA') !== 'sim') return null;
  var r = UrlFetchApp.fetch(p.getProperty('RM_API_URL'), { method: 'post', contentType: 'application/json', payload: (e && e.postData && e.postData.contents) || '{}', muteHttpExceptions: true });
  return ContentService.createTextOutput(r.getContentText()).setMimeType(ContentService.MimeType.JSON);
}
