/**
 * RM — PDF do plano de execução (26/09/2026; marca v1.0 em 03/10/2026)
 * O conteúdo fica no arquivo PlanoDoc (HTML) deste projeto. gerarPlanoPdf() converte em PDF,
 * salva no Drive (mesma pasta da planilha), compartilha com os e-mails da aba Config e grava o link
 * em Config › plano_pdf. O app lê esse link (botão "Plano completo (PDF)" em Plano e Gestão).
 * Para atualizar o plano: substituir o PlanoDoc e rodar gerarPlanoPdf de novo (o PDF antigo vai para a lixeira).
 * Logotipo da capa: o PlanoDoc tem o marcador {{LOGO}}, trocado aqui pelo mesmo PNG do cabeçalho dos e-mails
 * (SELO_EMAIL_B64, em Code.gs). Se a constante não existir, a capa sai só com o texto.
 */
function gerarPlanoPdf() {
  var html = planoHtml_();
  var nome = 'RM — Plano de Execução out-26 a abr-27 (' + fmt_(new Date(), 'dd-MM-yyyy') + ').pdf';
  var pdf = Utilities.newBlob(html, 'text/html', 'plano.html').getAs('application/pdf').setName(nome);
  var c = config_();
  if (c.plano_pdf_id) { try { DriveApp.getFileById(String(c.plano_pdf_id)).setTrashed(true); } catch (e) { Logger.log('PDF antigo: ' + e.message); } }
  var pasta = null;
  try { var pais = DriveApp.getFileById(SHEET_ID).getParents(); if (pais.hasNext()) pasta = pais.next(); } catch (e) {}
  var arq = pasta ? pasta.createFile(pdf) : DriveApp.createFile(pdf);
  var emails = [c.email_raquel, c.email_bruno].join(',').split(',').map(function (e) { return String(e).trim(); })
    .filter(function (e) { return /@/.test(e) && e !== Session.getEffectiveUser().getEmail(); });
  emails.forEach(function (e) { try { arq.addViewer(e); } catch (err) { Logger.log('Não compartilhou com ' + e + ': ' + err.message); } });
  var url = arq.getUrl();
  setConfig_('plano_pdf', url, 'Link do PDF do plano (gerado por gerarPlanoPdf). O app usa este link.');
  setConfig_('plano_pdf_id', arq.getId(), 'ID do arquivo do PDF do plano no Drive (usado para substituir a versão antiga).');
  Logger.log('PDF do plano: ' + url);
  return url;
}

function planoHtml_() {
  var html = HtmlService.createHtmlOutputFromFile('PlanoDoc').getContent();
  var b64 = (typeof SELO_EMAIL_B64 === 'string') ? SELO_EMAIL_B64 : '';
  if (b64) return html.split('{{LOGO}}').join('data:image/png;base64,' + b64);
  return html.replace(/<img[^>]*\{\{LOGO\}\}[^>]*>/g, '');
}

function setConfig_(chave, valor, uso) {
  var sh = sh_('Config'), n = Math.max(sh.getLastRow() - 1, 0);
  var chaves = n ? sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
  var i = chaves.indexOf(chave);
  CONFIG_CACHE_ = null;
  if (i >= 0) { sh.getRange(i + 2, 2).setValue(valor); return; }
  sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[chave, valor, uso || '']]);
}
