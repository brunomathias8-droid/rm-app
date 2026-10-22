/**
 * RM — Painel da semana (e-mail visual de domingo e tela no app)
 */
var MARCOS = [
  ['2026-10-18', 'Reabertura e primeiro cardápio'],
  ['2026-11-18', 'Dia 30: R$ 1.500/mês e 15 clientes ativos'],
  ['2026-12-18', 'Dia 60: R$ 2.800/mês e 30 clientes ativos'],
  ['2027-01-16', 'Revisão trimestral (2h)'],
  ['2027-01-17', 'Dia 90: R$ 4.000/mês, 45 clientes e 5 assinantes'],
  ['2027-03-27', 'Revisão trimestral e meta de 6 meses: R$ 5.000/mês'],
  ['2027-03-29', 'Início da pausa (viagem) até 18/04'],
  ['2027-04-19', 'Retomada com ~50% do volume']
];
var DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function painelSemana_(iso) {
  var ini = weekStart_(iso), fim = addDays_(ini, 6), w = weekOf_(ini);
  var fase = (w >= 1 && w <= 31) ? String(sh_('Semanal').getRange(w + 1, 4).getValue()) : 'Antes do plano';
  var meta = (w >= 1 && w <= 31) ? Number(sh_('Semanal').getRange(w + 1, 17).getValue()) || 0 : 0;

  // tarefas do plano
  var tarefas = [];
  var sh = sh_('Tarefas'), n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 1, n, 5).getValues().forEach(function (r) {
    var d = iso_(r[0]); if (!d || !r[2] || String(r[4]) === 'Feita') return;
    if (d <= fim) tarefas.push({ data: d, resp: String(r[1]), txt: String(r[2]), atrasada: d < ini, tipo: 'plano' });
  });
  var acoes = acoesAbertas_().filter(function (a) { return a.prazo && a.prazo <= fim; }).map(function (a) {
    return { data: a.prazo, resp: a.resp, txt: 'Ação: ' + a.acao, atrasada: a.prazo < ini, tipo: 'acao' };
  });
  var prio = tarefas.concat(acoes).sort(function (a, b) {
    if (a.atrasada !== b.atrasada) return a.atrasada ? -1 : 1;
    return a.data.localeCompare(b.data);
  });

  // agenda dia a dia
  var peds = readPedidos_().filter(function (p) { return p.status !== 'Cancelado' && p.status !== 'Retirado'; });
  var dias = [];
  for (var i = 0; i < 7; i++) {
    var d = addDays_(ini, i);
    var itens = tarefas.concat(acoes).filter(function (t) { return t.data === d && !t.atrasada; })
      .map(function (t) { return { resp: t.resp, txt: t.txt, tipo: t.tipo }; });
    ciclo_(d).forEach(function (c) { itens.push({ resp: c.resp, txt: c.tarefa, tipo: 'rotina' }); });
    var ret = peds.filter(function (p) { return p.retirada === d; });
    dias.push({ iso: d, label: DIAS[parseD_(d).getDay()] + ' ' + d.slice(8) + '/' + d.slice(5, 7), itens: itens,
      retiradas: ret.length, retTxt: ret.map(function (p) { return p.cliente; }).join(', ') });
  }

  // números da semana anterior
  var ant = indicadoresSemana_(addDays_(ini, -7));
  // marcos e última reunião
  var marcos = MARCOS.filter(function (m) { return m[0] >= ini && m[0] <= addDays_(ini, 45); }).slice(0, 3);
  var ult = readRows_('Reunioes', 9).filter(function (r) { return r[0]; }).slice(-1)[0];
  var reuniao = ult ? { data: iso_(ult[0]), tipo: String(ult[1]), decisoes: String(ult[6] || '') } : null;
  var pausa = inPause_(ini) && inPause_(fim);
  // versão 10: massa no congelador e margem de contribuição por produto
  var massa = null; if (typeof estoqueMassa_ === 'function') { try { massa = estoqueMassa_(); } catch (e) { Logger.log('massa no painel: ' + e.message); } }
  return { semana: w, ini: ini, fim: fim, fase: fase, meta: meta, prioridades: prio.slice(0, 6), totalPendentes: prio.length,
    dias: dias, anterior: ant, marcos: marcos, reuniao: reuniao, acoesAbertas: acoesAbertas_().length, pausa: pausa,
    massa: massa, margens: margemProdutosSeguro_().slice(0, 6) };
}

function dBr_(iso) { return iso ? DIAS[parseD_(iso).getDay()] + ' ' + iso.slice(8) + '/' + iso.slice(5, 7) : ''; }

function valorInd_(i) {
  if (i.valor === null || i.valor === undefined || i.valor === '') return '—';
  if (i.fmt === 'brl') return brl_(i.valor);
  if (i.fmt === 'pct') return Math.round(i.valor * 100) + '%';
  return String(i.valor);
}

/* HTML compatível com e-mail (tabelas e estilos inline), também usado no app */
function painelHtml_(p, appUrl) {
  var V = MARCA.vinho, R = MARCA.rosaClaro, RA = MARCA.rosa, T = MARCA.cacau, S = MARCA.sub, B = MARCA.creme, L = MARCA.linha, OK = '#2E6B4F', ER = '#A5281B', SERIF = 'font-family:Georgia,\'Times New Roman\',serif;';
  var h = '<div style="font-family:Arial,Helvetica,sans-serif;color:' + T + ';background:' + B + ';padding:0;margin:0">';
  h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:' + B + '">';
  // cabeçalho
  h += '<tr><td style="background:' + V + ';padding:22px 20px;color:#fff"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="middle">' + marcaEmail_() +
    '<div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:' + RA + ';font-weight:bold;margin-top:16px">Painel da semana</div>' +
    '<div style="' + SERIF + 'font-size:26px;margin:4px 0 2px">' + (p.semana >= 1 ? 'Semana ' + p.semana : 'Antes da semana 1') + ' · ' + esc_(p.fase) + '</div>' +
    '<div style="font-size:14px;color:' + RA + '">' + dBr_(p.ini) + ' a ' + dBr_(p.fim) + (p.meta ? ' · meta de receita ' + brl_(p.meta) : '') + '</div></td>' +
    '</tr></table></td></tr>';   // o carimbo "Fornada nº" saiu da marca em 03/10/2026
  if (p.pausa) {
    h += '<tr><td style="padding:20px"><div style="background:#fff;border:1px solid ' + L + ';border-radius:12px;padding:16px;font-size:15px">Semana de pausa (viagem). Retomada: cardápio em 18/04.</div></td></tr></table></div>';
    return h;
  }
  // prioridades
  h += '<tr><td style="padding:18px 20px 6px"><div style="' + SERIF + 'font-size:21px;color:' + V + '">Prioridades da semana</div>' +
    '<div style="font-size:13px;color:' + S + '">Atrasadas primeiro, depois por data. ' + p.totalPendentes + ' pendente(s) no total.</div></td></tr>';
  h += '<tr><td style="padding:6px 20px">' + (p.prioridades.length ? p.prioridades.map(function (t, k) {
    var cor = t.atrasada ? ER : V;
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid ' + L + ';border-radius:12px;margin:0 0 8px"><tr>' +
      '<td width="44" style="padding:12px 0 12px 14px;vertical-align:top"><div style="width:30px;height:30px;border-radius:15px;background:' + cor + ';color:#fff;font-weight:bold;font-size:15px;text-align:center;line-height:30px">' + (k + 1) + '</div></td>' +
      '<td style="padding:12px 14px 12px 8px;font-size:15px;line-height:1.35">' + esc_(t.txt) +
      '<div style="font-size:12px;color:' + (t.atrasada ? ER : S) + ';margin-top:4px;font-weight:bold">' + esc_(t.resp) + ' · ' + (t.atrasada ? 'atrasada desde ' : '') + dBr_(t.data) + '</div></td></tr></table>';
  }).join('') : '<div style="font-size:14px;color:' + S + '">Nenhuma tarefa do plano pendente para esta semana.</div>') + '</td></tr>';
  // agenda
  h += '<tr><td style="padding:14px 20px 6px"><div style="' + SERIF + 'font-size:21px;color:' + V + '">Agenda da semana</div></td></tr><tr><td style="padding:6px 20px">';
  p.dias.forEach(function (d) {
    var prod = /produção/i.test(d.itens.map(function (x) { return x.txt; }).join(' '));
    h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid ' + L + '"><tr>' +
      '<td width="76" style="padding:10px 0;vertical-align:top"><div style="font-weight:bold;font-size:14px;color:' + (prod ? '#fff' : V) + ';background:' + (prod ? V : R) + ';border-radius:8px;padding:6px 8px;text-align:center">' + d.label + '</div></td>' +
      '<td style="padding:10px 0 10px 12px;font-size:14px;line-height:1.4;vertical-align:top">' +
      (d.itens.length ? d.itens.map(function (x) {
        var tag = x.tipo === 'rotina' ? '' : '<b style="color:' + V + '">' + (x.tipo === 'acao' ? 'Ação' : 'Plano') + ' · </b>';
        return '<div style="margin:0 0 4px;color:' + (x.tipo === 'rotina' ? S : T) + '">' + tag + esc_(x.txt) + ' <span style="color:' + S + ';font-size:12px">(' + esc_(x.resp) + ')</span></div>';
      }).join('') : '<div style="color:' + S + '">—</div>') +
      (d.retiradas ? '<div style="margin-top:4px;font-size:13px;color:' + OK + ';font-weight:bold">' + d.retiradas + ' retirada(s): ' + esc_(d.retTxt) + '</div>' : '') +
      '</td></tr></table>';
  });
  h += '</td></tr>';
  // números da semana anterior
  var a = p.anterior;
  h += '<tr><td style="padding:18px 20px 6px"><div style="' + SERIF + 'font-size:21px;color:' + V + '">Como foi a semana passada</div><div style="font-size:13px;color:' + S + '">' + esc_(a.titulo) + '</div></td></tr><tr><td style="padding:6px 20px">';
  var rec = a.indicadores[0];
  if (rec.meta) {
    var pct = Math.max(0, Math.min(100, Math.round(rec.valor / rec.meta * 100)));
    h += '<div style="font-size:14px;margin:0 0 6px"><b>Receita ' + brl_(rec.valor) + '</b> de ' + brl_(rec.meta) + ' (' + Math.round(rec.valor / rec.meta * 100) + '% da meta)</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + L + ';border-radius:6px;height:12px"><tr><td width="' + pct + '%" style="background:' + (pct >= 90 ? OK : V) + ';border-radius:6px;height:12px;font-size:0">&nbsp;</td><td style="font-size:0">&nbsp;</td></tr></table>';
  }
  h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px">';
  var inds = a.indicadores.filter(function (i) { return i.id !== 'receita' || !rec.meta; });
  for (var k = 0; k < inds.length; k += 2) {
    h += '<tr>' + [inds[k], inds[k + 1]].map(function (i) {
      if (!i) return '<td width="50%"></td>';
      var st = i.st === 'ok' ? '<span style="color:' + OK + ';font-weight:bold">ok</span>' : (i.st && i.st.indexOf('atenção') === 0 ? '<span style="color:' + ER + ';font-weight:bold">atenção</span>' : '');
      return '<td width="50%" style="padding:4px"><div style="background:#fff;border:1px solid ' + L + ';border-radius:10px;padding:10px">' +
        '<div style="font-size:12px;color:' + S + '">' + esc_(i.nome) + '</div><div style="font-size:18px;font-weight:bold;margin:2px 0">' + valorInd_(i) + '</div>' +
        '<div style="font-size:12px;color:' + S + '">' + esc_(i.metaTxt || '') + ' ' + st + '</div></div></td>';
    }).join('') + '</tr>';
  }
  h += '</table></td></tr>';
  // massa no congelador (versão 10)
  if (p.massa && p.massa.sabores.length) {
    h += '<tr><td style="padding:18px 20px 6px"><div style="' + SERIF + 'font-size:21px;color:' + V + '">Massa no congelador</div><div style="font-size:13px;color:' + S + '">' + p.massa.total + ' bolinhas · mínimo ' + p.massa.cfg.minimo + ' por sabor</div></td></tr><tr><td style="padding:6px 20px">' +
      p.massa.sabores.map(function (x) {
        var al = x.alertas.map(function (a) { return a.texto; }).join(' · '), cor = x.saldo < p.massa.cfg.minimo ? ER : T;
        return '<div style="font-size:14px;margin:4px 0;color:' + cor + '"><b>' + esc_(x.produto) + '</b>: ' + x.saldo + ' bolinha(s)' + (x.diasEstoque !== null ? ' · ~' + x.diasEstoque + ' dia(s) de venda' : '') + (al ? '<br><span style="font-size:12px">' + esc_(al) + '</span>' : '') + '</div>';
      }).join('') + '</td></tr>';
  }
  if (p.margens && p.margens.length) {
    h += '<tr><td style="padding:18px 20px 6px"><div style="' + SERIF + 'font-size:21px;color:' + V + '">Margem de contribuição por produto</div><div style="font-size:13px;color:' + S + '">Preço − custo da ficha técnica, da maior para a menor</div></td></tr><tr><td style="padding:6px 20px">' +
      p.margens.map(function (x) { return '<div style="font-size:14px;margin:4px 0"><b>' + esc_(x.nome) + '</b>: ' + brl_(x.margem) + ' por unidade (' + Math.round(x.pct * 100) + '%)</div>'; }).join('') + '</td></tr>';
  }
  // decisões e marcos
  if (p.reuniao && p.reuniao.decisoes) h += '<tr><td style="padding:14px 20px 0"><div style="background:' + R + ';border-radius:12px;padding:14px;font-size:14px;line-height:1.4"><b style="color:' + V + '">Decidido na reunião ' + esc_(p.reuniao.tipo.toLowerCase()) + ' de ' + dBr_(p.reuniao.data) + ':</b><br>' + esc_(p.reuniao.decisoes) + '</div></td></tr>';
  if (p.marcos.length) h += '<tr><td style="padding:14px 20px 0"><div style="' + SERIF + 'font-size:21px;color:' + V + ';margin-bottom:6px">Próximos marcos</div>' +
    p.marcos.map(function (m) { return '<div style="font-size:14px;margin:4px 0"><b>' + dBr_(m[0]) + '</b> · ' + esc_(m[1]) + '</div>'; }).join('') + '</td></tr>';
  h += '<tr><td style="padding:16px 20px 24px;font-size:13px;color:' + S + '">' + p.acoesAbertas + ' ação(ões) aberta(s) no plano de ação.' +
    (appUrl ? '<br><br><a href="' + appUrl + '" style="background:' + V + ';color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold;display:inline-block">Abrir o app</a>' : '') + '</td></tr>' +
    '<tr><td style="padding:0 20px 26px;font-size:12px;letter-spacing:2px;color:' + MARCA.caramelo + ';font-weight:bold">RM CONFEITARIA ARTESANAL · POR RAQUEL MIRANDA</td></tr>';
  h += '</table></div>';
  return h;
}

/* Tela no app: semana atual (ou a próxima, a partir de sábado) */
function getPainel(pin, iso) {
  checkPin_(pin);
  var hoje = today_();
  iso = iso || (parseD_(hoje).getDay() === 0 || parseD_(hoje).getDay() === 6 ? addDays_(hoje, 2) : hoje);
  var p = painelSemana_(iso);
  return { html: painelHtml_(p, null), semana: p.semana };
}

/* E-mail de domingo 18h, com a semana que começa na segunda */
function emailPainel() {
  var c = config_(), hoje = today_();
  if (hoje > '2027-05-02') return;
  var p = painelSemana_(addDays_(hoje, 1));
  var html = painelHtml_(p, c.app_url);
  var n = p.prioridades.length;
  var assunto = 'RM · ' + (p.semana >= 1 ? 'Semana ' + p.semana : 'Semana') + ': ' + (p.pausa ? 'pausa' : n + ' prioridade(s)' + (n ? ' — ' + p.prioridades[0].txt.slice(0, 60) : ''));
  [c.email_raquel, c.email_bruno].filter(String).forEach(function (to) {
    MailApp.sendEmail({ to: to, subject: assunto, htmlBody: html, name: MARCA.nome });
  });
}

function testePainel() { emailPainel(); }

function setupPainel_() {
  ScriptApp.newTrigger('emailPainel').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(18).nearMinute(0).inTimezone(TZ).create();
}

/* ---------------- Roadmap (guia Plano do app) ---------------- */
var MESES_FOCO = {
  '2026-09': ['Preparação', 'Instalar o app'],
  '2026-10': ['Fundação e reabertura', '100% dos pedidos no app'],
  '2026-11': ['Ritmo', 'R$ 1.500'],
  '2026-12': ['Alavancas e Natal', 'R$ 2.800'],
  '2027-01': ['Revisão de 90 dias', 'R$ 4.000'],
  '2027-02': ['B2B e preparo da Páscoa', 'R$ 4.500'],
  '2027-03': ['Páscoa e meta de 6 meses', 'R$ 5.000'],
  '2027-04': ['Pausa e retomada', '~R$ 2.500'],
  '2027-05': ['Plano de maio em diante', '—']
};

function getRoadmap(pin) {
  checkPin_(pin);
  var itens = [], sh = sh_('Tarefas'), n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 1, n, 7).getValues().forEach(function (r, i) {
    if (!r[2]) return;
    itens.push({ tipo: 'plano', row: i + 2, data: iso_(r[0]), resp: String(r[1] || 'Ambos'), txt: String(r[2]), feita: String(r[4]) === 'Feita', porque: porque_(r[2], r[6]) });
  });
  readAcoes_().forEach(function (a) {
    itens.push({ tipo: 'acao', row: a.row, data: a.prazo, resp: a.resp || 'Ambos', txt: a.acao, feita: a.status === 'Concluída' || a.status === 'Cancelada', status: a.status,
      indicador: a.indicador, problema: a.problema, impacto: a.impacto, origem: a.origem, criada: a.criada });
  });
  MARCOS.forEach(function (m) { itens.push({ tipo: 'marco', data: m[0], txt: m[1], resp: 'Ambos', feita: m[0] < today_(), porque: MARCO_PORQUE[m[0]] || '' }); });
  return { hoje: today_(), itens: itens, meses: MESES_FOCO };
}

function confereLinha_(sh, row, col, texto) {
  if (String(sh.getRange(row, col).getValue()) !== String(texto)) throw new Error('A lista mudou desde que foi aberta. Atualize a tela e tente de novo.');
}

function editarTarefa(pin, row, original, t) {
  checkPin_(pin);
  if (!t.tarefa || !t.data) throw new Error('Informe a tarefa e a data');
  var sh = sh_('Tarefas');
  confereLinha_(sh, row, 3, original);
  sh.getRange(row, 1, 1, 4).setValues([[parseD_(t.data), t.resp || 'Ambos', t.tarefa, weekOf_(t.data)]]);
  sh.getRange(row, 1).setNumberFormat('dd/mm/yyyy');
  if (t.porque !== undefined) sh.getRange(row, 7).setValue(t.porque || '');
  return { ok: true };
}

function excluirTarefa(pin, row, original) {
  checkPin_(pin);
  var sh = sh_('Tarefas');
  confereLinha_(sh, row, 3, original);
  sh.deleteRow(row);
  return { ok: true };
}

function editarAcao(pin, row, original, a) {
  checkPin_(pin);
  if (!a.acao) throw new Error('Descreva a ação');
  var sh = sh_('Acoes');
  confereLinha_(sh, row, 5, original);
  sh.getRange(row, 5, 1, 3).setValues([[a.acao, a.resp || 'Ambos', a.prazo ? parseD_(a.prazo) : '']]);
  sh.getRange(row, 7).setNumberFormat('dd/mm/yyyy');
  return { ok: true };
}
