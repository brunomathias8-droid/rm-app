/**
 * RM — Módulo de custos, resultado e gestão
 * Abas: Insumos, Receitas, Despesas, DRE, Reunioes, Acoes
 */
var CATEGORIAS = ['Insumo', 'Embalagem', 'Taxas e outros variáveis', 'Gás e energia', 'Marketing', 'Equipamentos e manutenção', 'Imposto (DAS)', 'Outras fixas'];
var CAT_VARIAVEL = ['Insumo', 'Embalagem', 'Taxas e outros variáveis'];
var DRE_MESES = [[2026, 10, 'Out/26'], [2026, 11, 'Nov/26'], [2026, 12, 'Dez/26'], [2027, 1, 'Jan/27'], [2027, 2, 'Fev/27'], [2027, 3, 'Mar/27'], [2027, 4, 'Abr/27']];
var DRE_LINHAS = [
  'Receita bruta', '(−) Impostos (DAS do MEI)', 'Receita líquida', '(−) Insumos', '(−) Embalagem', '(−) Taxas e outros variáveis',
  'Margem de contribuição', 'Margem de contribuição %', '(−) Gás e energia', '(−) Marketing', '(−) Equipamentos e manutenção', '(−) Outras despesas fixas',
  'Resultado antes do pró-labore', '(−) Pró-labore', 'Resultado do negócio', '',
  'Horas trabalhadas', 'Margem de contribuição por hora', 'Custo teórico de insumo e embalagem (vendas × ficha técnica)',
  'Diferença real − teórico', 'Ponto de equilíbrio (receita mensal)', 'Faturamento acumulado no ano', '% do limite anual do MEI',
  // competência e contagem de estoque (03/10/2026)
  '', 'Compras de insumo e embalagem no mês (caixa, informativo)', 'Estoque no início do mês (itens contados)', 'Estoque no fim do mês (itens contados)',
  'Consumo real dos itens contados (início + compras − fim)', 'Consumo previsto dos itens contados (vendas × ficha técnica)',
  'Perda dos itens contados (real − previsto)', 'Perda % dos itens contados', 'Itens vendidos sem custo cadastrado (unidades)'
];
var DRE_NOTA = 'Regime de competência: Insumos e Embalagem = custo dos itens vendidos no mês (vendas × ficha técnica). Compras ficam em Despesas e aparecem só como informação. ' +
  'Perda = consumo real dos insumos marcados para contagem (estoque inicial + compras − estoque final) menos o previsto pela ficha. Valores calculados pelo script (não editar): atualizam a cada registro no app, no botão Recalcular agora e todo dia às 5h.';
var REPASSE_RE = /\b(entrega|frete|uber|motoboy|99\s*pop|corrida)\b/i;
var ACAO_STATUS = ['Aberta', 'Em andamento', 'Concluída', 'Cancelada'];
var METAS = { ticket: 85, sobra: 0.05, canal: 0.6, insumo: 0.5, perdaMassa: 0.05 };   // perdaMassa: perda na contagem da produção   // margem por hora saiu em 22/10/2026 (decisão 37)
/* Linhas da DRE que saíram de uso na versão 10 (ficam ocultas na planilha e o recálculo não escreve nelas) */
var DRE_SEM_USO = ['Horas trabalhadas', 'Margem de contribuição por hora'];

/* ---------------- Instalação ---------------- */
function setupGestao_(ss) {
  var hdr = function (sh, cols) { sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground(MARCA.vinho).setFontColor('#FFFFFF'); sh.setFrozenRows(1); };
  var cfg = ss.getSheetByName('Config');
  var keys = cfg.getRange(1, 1, cfg.getLastRow(), 1).getValues().map(function (r) { return r[0]; });
  [['prolabore_mensal', '', 'Pró-labore mensal da Raquel em R$ (a definir). Vazio = 0 na DRE'],
   ['rateio_gas_energia', '', 'Gás e energia da cozinha por mês em R$, quando não houver lançamento (premissa)'],
   ['limite_mei', 81000, 'Limite anual de faturamento do MEI em R$ — VALIDAR COM ANDRÉ']].forEach(function (k) {
    if (keys.indexOf(k[0]) < 0) cfg.appendRow(k);
  });

  // Insumos
  var ins = ss.getSheetByName('Insumos');
  if (!ins) {
    ins = ss.insertSheet('Insumos');
    hdr(ins, ['Insumo', 'Categoria', 'Unidade', 'Qtd. na embalagem de compra', 'Preço pago (R$)', 'Custo por unidade (R$)', 'Última compra', 'Fornecedor']);
    var base = [['Farinha de trigo', 'g'], ['Açúcar refinado', 'g'], ['Açúcar mascavo', 'g'], ['Ovos', 'un'], ['Manteiga', 'g'], ['Leite integral', 'ml'],
      ['Leite condensado', 'g'], ['Creme de leite', 'g'], ['Óleo', 'ml'], ['Fermento químico', 'g'], ['Chocolate em pó', 'g'], ['Chocolate em barra', 'g'],
      ['Gotas de chocolate', 'g'], ['Cenoura', 'g'], ['Milho verde', 'g'], ['Coco ralado', 'g'], ['Essência de baunilha', 'ml'], ['Sal', 'g']];
    var emb = [['Embalagem bolo médio', 'un'], ['Embalagem bolo pequeno', 'un'], ['Caixa de cookies 6 un', 'un'], ['Caixa de cookies 12 un', 'un'],
      ['Pote de pudim', 'un'], ['Rótulo', 'un'], ['Cartão de indicação', 'un'], ['Sacola', 'un']];
    var rows = base.map(function (b) { return [b[0], 'Ingrediente', b[1], '', '', '', '', '']; })
      .concat(emb.map(function (b) { return [b[0], 'Embalagem', b[1], '', '', '', '', '']; }));
    ins.getRange(2, 1, rows.length, 8).setValues(rows);
    formulasInsumos_(ins);
    ins.getRange('E2:E200').setNumberFormat('"R$" #,##0.00');
    ins.getRange('G2:G200').setNumberFormat('dd/mm/yyyy');
    ins.getRange('B2:B200').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Ingrediente', 'Embalagem'], true).build());
    ins.getRange('C2:C200').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['g', 'ml', 'un'], true).build());
    ins.setColumnWidth(1, 220); ins.setColumnWidth(4, 170);
  }

  // Receitas (ficha técnica por ingrediente)
  var rec = ss.getSheetByName('Receitas');
  if (!rec) {
    rec = ss.insertSheet('Receitas');
    hdr(rec, ['Produto', 'Insumo ou produto componente', 'Quantidade por lote', 'Categoria', 'Custo no lote (R$)', 'Observação']);
    rec.getRange('A2').setNote('Uma linha por ingrediente ou embalagem de cada produto, com a quantidade usada NUM LOTE (na unidade da aba Insumos). O tamanho do lote fica em Fichas técnicas, coluna "Unidades por lote". Para caixas e kits, use o nome de outro produto como componente (quantidade = unidades dele).');
    formulasReceitas_(rec);
    rec.getRange('E2:E400').setNumberFormat('"R$" #,##0.00');
    var nomes = SpreadsheetApp.newDataValidation().requireValueInRange(ss.getSheetByName('Fichas técnicas').getRange('A2:A20'), true).setAllowInvalid(false).build();
    rec.getRange('A2:A400').setDataValidation(nomes);
    rec.setColumnWidth(1, 300); rec.setColumnWidth(2, 260); rec.setColumnWidth(6, 300);
  }

  // Fichas técnicas: custo passa a vir das Receitas; coluna M = custo total por unidade
  var ft = ss.getSheetByName('Fichas técnicas');
  ft.getRange('M1').setValue('Custo total por unidade (R$)').setFontWeight('bold').setBackground(MARCA.vinho).setFontColor('#FFFFFF');
  // C, D, E e M: valores calculados por recalcFichas_() (sem fórmulas entre abas)
  ft.getRange(2, 3, 8, 2).clearContent(); ft.getRange(2, 5, 8, 1).clearContent(); ft.getRange(2, 13, 8, 1).clearContent();
  ft.getRange('C1').setValue('Custo de insumo por unidade (R$) — automático');
  ft.getRange('D1').setValue('Custo de embalagem por unidade (R$) — automático');
  ft.getRange('A11').setValue('Custo automático a partir da aba Receitas. Preencha "Unidades por lote" (1 para caixas, kits e assinatura) e "Bolinhas por unidade vendida" nos produtos com massa congelada.');

  // Despesas
  var des = ss.getSheetByName('Despesas');
  if (!des) {
    des = ss.insertSheet('Despesas');
    hdr(des, ['Data', 'Categoria', 'Descrição', 'Valor (R$)', 'Tipo', 'Insumo', 'Qtd. comprada', 'Pago com', 'ID', 'Registrado em']);
    des.getRange('A2:A2000').setNumberFormat('dd/mm/yyyy');
    des.getRange('D2:D2000').setNumberFormat('"R$" #,##0.00');
    des.getRange('B2:B2000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CATEGORIAS, true).build());
    des.getRange('H2:H2000').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Conta PJ', 'Conta pessoal', 'Dinheiro'], true).build());
    des.setColumnWidth(3, 260);
  }

  // Semanal: custo de insumo passa a vir das Despesas
  var sem = ss.getSheetByName('Semanal');
  sem.getRange(2, 6, 31, 1).clearContent();   // F: valor calculado por recalcSemanal_()
  sem.getRange('F1').setValue('Custo de insumo e embalagem (R$) — das Despesas');

  // DRE
  var dre = ss.getSheetByName('DRE') || ss.insertSheet('DRE');
  dre.clear();
  dre.getRange(1, 1, 1, 8).setValues([['DRE simplificada'].concat(DRE_MESES.map(function (m) { return m[2]; }))]).setFontWeight('bold').setBackground(MARCA.vinho).setFontColor('#FFFFFF');
  dre.getRange(2, 1, 1, 8).setValues([['Início do mês'].concat(DRE_MESES.map(function (m) { return new Date(m[0], m[1] - 1, 1); }))]).setNumberFormat('dd/mm/yyyy').setFontColor('#999999');
  dre.getRange(3, 1, DRE_LINHAS.length, 1).setValues(DRE_LINHAS.map(function (l) { return [l]; }));
  dre.getRange(3, 2, DRE_LINHAS.length, DRE_MESES.length).setNumberFormat('"R$" #,##0.00');
  [10, 25].forEach(function (r) { dre.getRange(r, 2, 1, 7).setNumberFormat('0.0%'); });
  dre.getRange(19, 2, 1, 7).setNumberFormat('0.0');
  [5, 9, 15, 17].forEach(function (r) { dre.getRange(r, 1, 1, 8).setFontWeight('bold').setBackground(MARCA.rosa); });
  dre.setColumnWidth(1, 430); dre.setFrozenColumns(1); dre.setFrozenRows(1);
  dre.getRange(27, 1).setValue('Valores calculados pelo script (não editar): atualizam a cada registro no app, a cada edição nas abas de origem e todo dia às 5h. Despesas lançadas pelo app. Pró-labore, rateio de gás/energia e limite do MEI ficam na aba Config.');

  // Reuniões e Ações
  if (!ss.getSheetByName('Reunioes')) {
    var reu = ss.insertSheet('Reunioes');
    hdr(reu, ['Data', 'Tipo', 'Período', 'Indicadores no momento', 'O que funcionou', 'O que não funcionou e por quê', 'Decisões', 'Participantes', 'ID']);
    reu.getRange('A2:A500').setNumberFormat('dd/mm/yyyy');
    reu.setColumnWidth(4, 360); reu.setColumnWidth(5, 280); reu.setColumnWidth(6, 280); reu.setColumnWidth(7, 280);
  }
  if (!ss.getSheetByName('Acoes')) {
    var ac = ss.insertSheet('Acoes');
    hdr(ac, ['ID', 'Criada em', 'Origem', 'Problema ou oportunidade', 'Ação', 'Responsável', 'Prazo', 'Indicador', 'Impacto esperado', 'Status', 'Concluída em', 'Resultado']);
    ac.getRange('B2:B500').setNumberFormat('dd/mm/yyyy'); ac.getRange('G2:G500').setNumberFormat('dd/mm/yyyy'); ac.getRange('K2:K500').setNumberFormat('dd/mm/yyyy');
    ac.getRange('F2:F500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Raquel', 'Bruno', 'Ambos'], true).build());
    ac.getRange('J2:J500').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(ACAO_STATUS, true).build());
    ac.setColumnWidth(4, 280); ac.setColumnWidth(5, 320); ac.setColumnWidth(9, 220); ac.setColumnWidth(12, 260);
  }
  ScriptApp.newTrigger('atualizarCustoTeorico').timeBased().everyDays(1).atHour(5).nearMinute(0).inTimezone(TZ).create();
  gatilhoEdicao_();
  SpreadsheetApp.flush();
  recalcular();
}


function formulasInsumos_(ins) {
  var f = []; for (var r = 2; r <= 200; r++) f.push(['=IF(OR(D' + r + '="",E' + r + '="",D' + r + '=0),"",E' + r + '/D' + r + ')']);
  ins.getRange(2, 6, 199, 1).setFormulas(f).setNumberFormat('"R$" #,##0.0000');
}

function formulasReceitas_(rec) {
  var fr = [];
  for (var i = 2; i <= 400; i++) {
    fr.push([
      '=IF(B' + i + '="","",IFERROR(VLOOKUP(B' + i + ',Insumos!$A$2:$B$200,2,0),"Produto"))',
      '=IF(OR(B' + i + '="",C' + i + '=""),"",IF(ISNUMBER(MATCH(B' + i + ',Insumos!$A$2:$A$200,0)),IF(N(VLOOKUP(B' + i + ',Insumos!$A$2:$F$200,6,0))=0,"sem preço",C' + i + '*VLOOKUP(B' + i + ',Insumos!$A$2:$F$200,6,0)),IF(ISNUMBER(IFERROR(VLOOKUP(B' + i + ',\'Fichas técnicas\'!$A$2:$M$20,13,0),"")),C' + i + '*VLOOKUP(B' + i + ',\'Fichas técnicas\'!$A$2:$M$20,13,0),"sem preço")))'
    ]);
  }
  rec.getRange(2, 4, 399, 2).setFormulas(fr);
}

/* Corrige fórmulas (#ERROR!) e datas de uma instalação feita em planilha com idioma português.
   Rodar uma vez no editor: escolher corrigirPlanilha e Executar. */
function corrigirPlanilha() {
  var ss = ss_();
  ss.setSpreadsheetTimeZone(TZ);
  // remove as fórmulas que davam #ERROR! e passa a gravar valores calculados
  sh_('Fichas técnicas').getRange(2, 3, 8, 2).clearContent();
  sh_('Fichas técnicas').getRange(2, 5, 8, 1).clearContent();
  sh_('Fichas técnicas').getRange(2, 13, 8, 1).clearContent();
  sh_('Semanal').getRange(2, 6, 31, 1).clearContent();
  sh_('DRE').getRange(3, 2, DRE_LINHAS.length, DRE_MESES.length).clearContent();
  SpreadsheetApp.flush();
  gatilhoEdicao_();
  recalcular();
  SpreadsheetApp.flush();
  // confere se sobrou algum erro nas abas calculadas
  var erros = [];
  ['Fichas técnicas', 'Semanal', 'Mensal', 'DRE', 'Receitas', 'Insumos'].forEach(function (n) {
    var v = sh_(n).getDataRange().getDisplayValues();
    v.forEach(function (r, i) { r.forEach(function (x, j) { if (/^#(ERROR|REF|VALUE|N\/A|NAME|DIV)/.test(x)) erros.push(n + '!' + String.fromCharCode(65 + j) + (i + 1) + ' ' + x); }); });
  });
  var msg = erros.length ? 'Ainda com erro (' + erros.length + '): ' + erros.slice(0, 15).join(' | ') : 'Planilha corrigida: nenhum erro encontrado';
  Logger.log(msg);
  return msg;
}

/* ---------------- Leitura de dados ---------------- */
function readRows_(name, ncol) {
  var sh = sh_(name), n = sh ? sh.getLastRow() - 1 : 0;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, ncol).getValues().map(function (r, i) { r.row = i + 2; return r; });
}

function readDespesas_() {
  return readRows_('Despesas', 10).filter(function (r) { return r[0] && r[3] !== ''; }).map(function (r) {
    return { row: r.row, data: iso_(r[0]), cat: String(r[1]), desc: String(r[2]), valor: Number(r[3]) || 0, tipo: String(r[4]), insumo: String(r[5]), qtd: Number(r[6]) || 0, pago: String(r[7]) };
  });
}

/* Lê todos os produtos de Fichas técnicas (antes lia só 8 linhas e os cookies ficavam de fora). */
function fichas_() {
  var out = {};
  sh_('Fichas técnicas').getRange(2, 1, 19, 13).getValues().forEach(function (r) {
    if (!r[0]) return;
    out[String(r[0]).trim()] = { preco: Number(r[1]) || 0, custo: typeof r[12] === 'number' ? r[12] : null,
      ins: typeof r[2] === 'number' ? r[2] : null, emb: typeof r[3] === 'number' ? r[3] : null };
  });
  return out;
}
function chave_(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
/* Procura a ficha sem diferenciar maiúscula, acento ou espaço ("Cookie ouro branco" = "Cookie Ouro Branco") */
function fichaDe_(fichas, nome) {
  if (fichas[nome]) return fichas[nome];
  if (!fichas.__idx) { var idx = {}; Object.keys(fichas).forEach(function (k) { if (k !== '__idx') idx[chave_(k)] = fichas[k]; }); Object.defineProperty(fichas, '__idx', { value: idx, enumerable: false }); }
  return fichas.__idx[chave_(nome)] || null;
}

function parseItens_(txt) {
  return String(txt || '').split(';').map(function (s) {
    var m = s.trim().match(/^(\d+)\s*x\s*(.+)$/i);
    return m ? { q: +m[1], nome: m[2].trim() } : (s.trim() ? { q: 1, nome: s.trim() } : null);
  }).filter(Boolean);
}

function listaInsumos_() {
  return readRows_('Insumos', 6).filter(function (r) { return r[0]; }).map(function (r) { return { nome: String(r[0]), cat: String(r[1]), un: String(r[2]) }; });
}

/* ---------------- Despesas ---------------- */
function salvarDespesa(pin, d) {
  checkPin_(pin);
  if (CATEGORIAS.indexOf(d.cat) < 0) throw new Error('Escolha a categoria');
  var valor = Number(String(d.valor).replace(',', '.'));
  if (!(valor > 0)) throw new Error('Informe o valor');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sh_('Despesas'), r = primeiraLinhaVazia_(sh);
    var qtd = Number(String(d.qtd || '').replace(',', '.')) || '';
    var tipo = CAT_VARIAVEL.indexOf(d.cat) >= 0 ? 'Variável' : 'Fixa';
    sh.getRange(r, 1, 1, 10).setValues([[parseD_(d.data || today_()), d.cat, d.desc || d.insumo || '', valor, tipo, d.insumo || '', qtd, d.pago || 'Conta PJ', 'D' + fmt_(new Date(), 'yyMMddHHmmss'), new Date()]]);
    sh.getRange(r, 1).setNumberFormat('dd/mm/yyyy'); sh.getRange(r, 4).setNumberFormat('"R$" #,##0.00');
    if (d.insumo && qtd > 0 && (d.cat === 'Insumo' || d.cat === 'Embalagem')) atualizarPrecoInsumo_(d.insumo, d.cat, d.un, qtd, valor, d.data || today_());
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function atualizarPrecoInsumo_(nome, cat, un, qtd, valor, data) {
  var sh = sh_('Insumos'), n = Math.max(sh.getLastRow() - 1, 0);
  var nomes = n ? sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]).trim().toLowerCase(); }) : [];
  var idx = nomes.indexOf(String(nome).trim().toLowerCase());
  var row = idx >= 0 ? idx + 2 : primeiraLinhaVazia_(sh);
  if (idx < 0) sh.getRange(row, 1, 1, 3).setValues([[nome, cat === 'Embalagem' ? 'Embalagem' : 'Ingrediente', un || 'g']]);
  sh.getRange(row, 4, 1, 2).setValues([[qtd, valor]]);
  sh.getRange(row, 7).setValue(parseD_(data)).setNumberFormat('dd/mm/yyyy');
}

/* ---------------- Custo teórico (vendas × ficha técnica) = custo por competência ----------------
 * ins/emb: custo dos itens com ficha completa. semCusto: nomes sem ficha ou com "falta preço" (repasse de entrega não conta). */
function custoTeorico_(pedidos, fichas) {
  var ins = 0, emb = 0, semCusto = {}, semUn = 0, comCusto = 0;
  pedidos.forEach(function (p) {
    parseItens_(p.itens).forEach(function (it) {
      if (REPASSE_RE.test(it.nome)) return;
      var f = fichaDe_(fichas, it.nome);
      if (f && f.custo !== null) { ins += it.q * (f.ins !== null ? f.ins : f.custo); emb += it.q * (f.emb || 0); comCusto++; }
      else { semCusto[chave_(it.nome)] = semCusto[chave_(it.nome)] || it.nome; semUn += it.q; }
    });
  });
  return { valor: comCusto ? round2_(ins + emb) : null, ins: round2_(ins), emb: round2_(emb), semCusto: Object.keys(semCusto).map(function (k) { return semCusto[k]; }), semCustoUn: semUn };
}

function atualizarCustoTeorico() { recalcular(); }   // nome mantido por causa do gatilho diário das 5h

/* ---------------- Indicadores ---------------- */
function status_(ok, parcial) { return ok === null ? 'sem dado' : (ok ? 'ok' : (parcial ? 'atenção (parcial)' : 'atenção')); }

function indicadoresSemana_(iso) {
  var ini = weekStart_(iso), fim = addDays_(ini, 6), w = weekOf_(iso), hoje = today_();
  var parcial = hoje <= fim;
  var peds = readPedidos_().filter(function (p) { return p.status !== 'Cancelado' && p.data >= ini && p.data <= fim; });
  var rec = peds.reduce(function (s, p) { return s + p.receita; }, 0);
  var sem = (w >= 1 && w <= 31) ? sh_('Semanal').getRange(w + 1, 1, 1, 18).getValues()[0] : [];
  var unid = Number(sem[6]) || 0, sobra = (Number(sem[7]) || 0) + (Number(sem[8]) || 0), meta = Number(sem[16]) || 0;
  var ctS = custoTeorico_(peds, fichas_()), custo = ctS.ins + ctS.emb;   // competência: custo dos itens vendidos na semana
  var canais = {}; peds.forEach(function (p) { var c = p.canal || 'Sem canal'; canais[c] = (canais[c] || 0) + 1; });
  var topCanal = Object.keys(canais).sort(function (a, b) { return canais[b] - canais[a]; })[0];
  var topShare = peds.length ? canais[topCanal] / peds.length : null;
  var ticket = peds.length ? rec / peds.length : null;
  var pixPend = readPedidos_().filter(function (p) { return p.status !== 'Cancelado' && p.pix !== 'Sim'; }).length;
  var ind = [
    { id: 'receita', nome: 'Receita da semana', valor: rec, fmt: 'brl', meta: meta || null, metaTxt: meta ? 'meta ' + brl_(meta) : 'sem meta', st: meta ? status_(rec >= meta * 0.9, parcial) : 'sem dado' },
    { id: 'pedidos', nome: 'Pedidos', valor: peds.length, fmt: 'int', metaTxt: '', st: 'info' },
    { id: 'ticket', nome: 'Ticket médio', valor: ticket, fmt: 'brl', metaTxt: 'meta ≥ R$ 85', st: status_(ticket === null ? null : ticket >= METAS.ticket) },
    { id: 'sobra', nome: 'Sobra e quebra', valor: unid ? sobra / unid : null, fmt: 'pct', metaTxt: 'meta < 5%', st: status_(unid ? sobra / unid < METAS.sobra : null) },
    { id: 'canal', nome: 'Maior canal', valor: topShare, fmt: 'pct', extra: topCanal || '', metaTxt: 'meta ≤ 60%', st: status_(topShare === null ? null : topShare <= METAS.canal) },
    { id: 'pix', nome: 'Pix pendente (total)', valor: pixPend, fmt: 'int', metaTxt: 'meta 0', st: status_(pixPend === 0) }
  ];
  var mx = massaGestao_(ini, fim); ind = ind.concat(mx.indicadores);
  return { massa: mx.massa, margemProdutos: margemProdutosSeguro_(), tipo: 'semana', titulo: 'Semana ' + w + ' · ' + ini.slice(8) + '/' + ini.slice(5, 7) + ' a ' + fim.slice(8) + '/' + fim.slice(5, 7), semana: w, parcial: parcial, indicadores: ind,
    base: { unidades: sem[6], sobra: sem[7], quebra: sem[8], notas: sem[17], custo: custo, receita: rec, semCusto: ctS.semCusto } };
}

function mesIdx_(iso) {
  for (var i = 0; i < DRE_MESES.length; i++) { var m = DRE_MESES[i]; if (+iso.slice(0, 4) === m[0] && +iso.slice(5, 7) === m[1]) return i; }
  return -1;
}

function indicadoresMes_(iso) {
  var i = mesIdx_(iso);
  if (i < 0) i = iso < '2026-10-01' ? 0 : DRE_MESES.length - 1;
  var m = DRE_MESES[i], ini = fmt_(new Date(m[0], m[1] - 1, 1)), fim = fmt_(new Date(m[0], m[1], 0));
  var parcial = today_() <= fim;
  var col = sh_('DRE').getRange(3, 2 + i, DRE_LINHAS.length, 1).getValues().map(function (r) { return r[0]; });
  var dre = DRE_LINHAS.map(function (l, k) { return { linha: l, valor: col[k] }; }).filter(function (x) { return x.linha; });
  var metaMes = Number(sh_('Mensal').getRange(2 + i, 4).getValue()) || null;
  var metaCli = Number(sh_('Mensal').getRange(2 + i, 18).getValue()) || null;
  var metaAss = Number(sh_('Mensal').getRange(2 + i, 20).getValue());
  var peds = readPedidos_().filter(function (p) { return p.status !== 'Cancelado'; });
  var refAtivo = parcial ? today_() : fim, lim60 = addDays_(refAtivo, -60);
  var ativos = {}; peds.forEach(function (p) { if (p.data > lim60 && p.data <= refAtivo) ativos[p.cliente.toLowerCase()] = 1; });
  var assin = {}; peds.forEach(function (p) { if (p.assinatura === 'Sim' && p.data > addDays_(refAtivo, -35) && p.data <= refAtivo) assin[p.cliente.toLowerCase()] = 1; });
  var pIni = fmt_(new Date(m[0], m[1] - 2, 1));
  var doMes = {}, doAnt = {};
  peds.forEach(function (p) { if (p.data >= ini && p.data <= fim) doMes[p.cliente.toLowerCase()] = 1; if (p.data >= pIni && p.data < ini) doAnt[p.cliente.toLowerCase()] = 1; });
  var ant = Object.keys(doAnt), recompra = ant.length ? ant.filter(function (c) { return doMes[c]; }).length / ant.length : null;
  var num = function (v) { return typeof v === 'number' ? v : null; };
  var rec = num(col[0]) || 0, res = num(col[14]), mc = num(col[7]), insR = rec ? ((num(col[3]) || 0) + (num(col[4]) || 0)) / rec : null;
  var pe = num(col[20]), lim = num(col[22]), perdaPct = num(col[30]), compras = num(col[24]);
  var nAtivos = Object.keys(ativos).length, nAss = Object.keys(assin).length;
  var semCusto = custoTeorico_(peds.filter(function (p) { return p.data >= ini && p.data <= fim; }), fichas_()).semCusto;
  var incompleto = semCusto.length ? 'atenção (custo incompleto)' : null, faltaTxt = semCusto.length ? 'falta custo de ' + semCusto.length + ' item(ns)' : '';
  var ind = [
    { id: 'receita', nome: 'Receita do mês', valor: rec, fmt: 'brl', metaTxt: metaMes ? 'meta ' + brl_(metaMes) : 'meta: registrar 100%', st: metaMes ? status_(rec >= metaMes * 0.9, parcial) : 'info' },
    { id: 'resultado', nome: 'Resultado do negócio', valor: res, fmt: 'brl', metaTxt: 'após pró-labore', st: res === null ? 'sem dado' : status_(res >= 0, parcial) },
    { id: 'mc', nome: 'Margem de contribuição', valor: mc, fmt: 'pct', metaTxt: faltaTxt || 'referência ≥ 50%', st: incompleto || status_(mc === null ? null : mc >= 0.5) },
    { id: 'insumo', nome: 'Custo dos vendidos / receita', valor: insR, fmt: 'pct', metaTxt: faltaTxt || 'perto de 50%', st: incompleto || status_(insR === null ? null : insR <= 0.55) },
    { id: 'pe', nome: 'Ponto de equilíbrio', valor: pe, fmt: 'brl', metaTxt: 'receita mínima do mês', st: pe === null ? 'sem dado' : status_(rec >= pe, parcial) },
    { id: 'ativos', nome: 'Clientes ativos (60 dias)', valor: nAtivos, fmt: 'int', metaTxt: metaCli ? 'meta ' + metaCli : '', st: metaCli ? status_(nAtivos >= metaCli, parcial) : 'info' },
    { id: 'recompra', nome: 'Recompra', valor: recompra, fmt: 'pct', metaTxt: 'meta > 35%', st: status_(recompra === null ? null : recompra > 0.35) },
    { id: 'assinantes', nome: 'Assinantes ativos', valor: nAss, fmt: 'int', metaTxt: 'meta ' + (metaAss || 0), st: metaAss ? status_(nAss >= metaAss, parcial) : 'info' },
    { id: 'desperdicio', nome: 'Perda dos itens contados', valor: perdaPct, fmt: 'pct', metaTxt: perdaPct === null ? 'depende da contagem do fim do mês' : 'até 10% acima do previsto', st: perdaPct === null ? 'sem dado' : status_(perdaPct <= 0.1) },
    { id: 'compras', nome: 'Compras de insumo e embalagem', valor: compras, fmt: 'brl', metaTxt: 'caixa do mês (informativo)', st: 'info' },
    { id: 'mei', nome: 'Limite anual do MEI usado', valor: lim, fmt: 'pct', metaTxt: 'alerta a partir de 80%', st: status_(lim === null ? null : lim < 0.8) }
  ];
  var mx = massaGestao_(ini, fim, true); ind = ind.concat(mx.indicadores);
  // produtos do mês
  var fichas = fichas_(), prod = {};
  peds.filter(function (p) { return p.data >= ini && p.data <= fim; }).forEach(function (p) {
    parseItens_(p.itens).forEach(function (it) {
      if (REPASSE_RE.test(it.nome)) return;                     // taxa de entrega não é produto
      var f = fichaDe_(fichas, it.nome), nome = f ? Object.keys(fichas).filter(function (k) { return fichas[k] === f; })[0] : it.nome;
      prod[nome] = (prod[nome] || 0) + it.q;                     // grafias diferentes do mesmo produto somam juntas
    });
  });
  var produtos = Object.keys(prod).map(function (n) {
    var f = fichaDe_(fichas, n) || {};
    return { nome: n, qtd: prod[n], receita: f.preco ? f.preco * prod[n] : null };
  }).sort(function (a, b) { return (b.receita || 0) - (a.receita || 0); });
  return { tipo: 'mes', titulo: m[2], mesIdx: i, parcial: parcial, indicadores: ind, dre: dre.filter(function (x) { return DRE_SEM_USO.indexOf(x.linha) < 0; }), produtos: produtos, semCusto: semCusto,
    massa: mx.massa, margemProdutos: margemProdutosSeguro_() };
}

/* Versão 10: estoque de produção (Producao.gs), dias de estoque e perda na contagem para Números e Reunião.
   Pontos de atenção: produto sem livres (ou faltando para os pedidos) e, no mês, perda na contagem acima de 5% do produzido. */
function massaGestao_(ini, fim, doMes) {
  var out = { indicadores: [], massa: null };
  if (typeof estoqueProducao_ !== 'function') return out;
  try {
    var est = estoqueProducao_(), per = producaoPeriodo_(ini, fim);
    var zerados = est.itens.filter(function (x) { return x.lancado && x.livre <= 0; });
    out.massa = { total: est.total, minimo: est.cfg.minimo, perda: per.perda, produzidoMes: per.produzido, perdidoMes: per.perdido,
      itens: est.itens.map(function (x) { return { produto: x.produto, estoque: x.estoque, reservado: x.reservado, livre: x.livre, lancado: x.lancado, diasEstoque: x.diasEstoque }; }) };
    if (!est.itens.length) return out;
    out.indicadores.push({ id: 'estoque', nome: 'Produção no estoque', valor: est.total, fmt: 'int', metaTxt: zerados.length ? 'sem livres: ' + zerados.map(function (x) { return v10Curto_(x.produto); }).join(', ') : 'unidades · mínimo ' + est.cfg.minimo + ' livres por produto', st: zerados.length ? 'atenção' : 'ok' });
    if (doMes) out.indicadores.push({ id: 'perdaProducao', nome: 'Perda na contagem', valor: per.perda, fmt: 'pct', metaTxt: per.produzido ? per.perdido + ' de ' + per.produzido + ' produzidas · meta < 5%' : 'sem produção lançada no mês', st: per.perda === null ? 'sem dado' : status_(per.perda < METAS.perdaMassa) });
  } catch (e) { Logger.log('massaGestao_: ' + e.message); }
  return out;
}
function margemProdutosSeguro_() { try { return typeof margemPorProduto_ === 'function' ? margemPorProduto_() : []; } catch (e) { return []; } }

function getIndicadores(pin, tipo, iso) {
  checkPin_(pin);
  iso = iso || today_();
  return tipo === 'mes' ? indicadoresMes_(iso) : indicadoresSemana_(iso);
}

/* ---------------- Reuniões ---------------- */
var PAUTAS = {
  Semanal: ['Números da semana (5 min): receita x meta, ticket, produção no estoque, Pix pendente',
    'Lançar unidades, sobra e quebra',
    'O que funcionou e o que não funcionou (causa, não culpa)',
    'Revisar as ações abertas: concluir, ajustar prazo ou cancelar',
    'Decidir: o que produzir na próxima semana e até 2 ações novas'],
  Mensal: ['DRE do mês: receita, margem de contribuição, resultado após pró-labore',
    'Indicadores x metas: o que ficou em atenção e por quê',
    'Produtos: quanto vendeu cada um e a margem de contribuição por produto — qual sai, qual testar',
    'Produção: perda na contagem (meta < 5%) e dias de estoque por produto',
    'Clientes e canais: ativos, recompra, assinantes, origem dos pedidos',
    'Preço e custo: custo real x teórico; algum preço precisa mudar?',
    'Plano de ação: fechar as do mês, criar até 3 novas com dono e prazo'],
  Trimestral: ['Metas do plano: estão sendo batidas?',
    'Gatilhos de expansão: sexta como produção, ajudante, cozinha',
    'Preços frente ao custo de insumo', 'Premissas do calendário: o que revisar', 'Plano de ação do trimestre']
};

function getReuniao(pin, tipo) {
  checkPin_(pin);
  var hoje = today_();
  var ref = tipo === 'Semanal' ? ((parseD_(hoje).getDay() === 1 || parseD_(hoje).getDay() === 2) ? addDays_(hoje, -7) : hoje) : hoje;
  if (tipo !== 'Semanal' && +hoje.slice(8) <= 10) ref = addDays_(fmt_(new Date(+hoje.slice(0, 4), +hoje.slice(5, 7) - 1, 1)), -1);
  var ind = tipo === 'Semanal' ? indicadoresSemana_(ref) : indicadoresMes_(ref);
  return { tipo: tipo, pauta: PAUTAS[tipo], ind: ind, acoes: acoesAbertas_(), ultimas: ultimasReunioes_(tipo) };
}

function ultimasReunioes_(tipo) {
  return readRows_('Reunioes', 9).filter(function (r) { return String(r[1]) === tipo; }).slice(-2).reverse().map(function (r) {
    return { data: iso_(r[0]), periodo: String(r[2]), decisoes: String(r[6] || '') };
  });
}

function salvarReuniao(pin, r) {
  checkPin_(pin);
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (r.tipo === 'Semanal' && r.semana >= 1 && r.semana <= 31) {
      var sem = sh_('Semanal');   // versão 10: horas não são mais registradas
      sem.getRange(r.semana + 1, 7, 1, 3).setValues([[num_(r.unidades), num_(r.sobra), num_(r.quebra)]]);
      if (r.decisoes) sem.getRange(r.semana + 1, 18).setValue(r.decisoes);
    }
    var sh = sh_('Reunioes'), row = primeiraLinhaVazia_(sh), id = 'R' + fmt_(new Date(), 'yyMMddHHmmss');
    sh.getRange(row, 1, 1, 9).setValues([[new Date(), r.tipo, r.periodo || '', r.snapshot || '', r.funcionou || '', r.naoFuncionou || '', r.decisoes || '', r.participantes || 'Raquel, Bruno', id]]);
    sh.getRange(row, 1).setNumberFormat('dd/mm/yyyy');
    (r.novasAcoes || []).forEach(function (a) { a.origem = r.tipo + ' ' + (r.periodo || ''); salvarAcao_(a); });
    return { ok: true, id: id };
  } finally { lock.releaseLock(); }
}

/* ---------------- Plano de ação ---------------- */
function readAcoes_() {
  return readRows_('Acoes', 12).filter(function (r) { return r[4]; }).map(function (r) {
    return { row: r.row, id: String(r[0]), criada: iso_(r[1]), origem: String(r[2]), problema: String(r[3]), acao: String(r[4]), resp: String(r[5]),
      prazo: iso_(r[6]), indicador: String(r[7]), impacto: String(r[8]), status: String(r[9] || 'Aberta'), concluida: iso_(r[10]), resultado: String(r[11]) };
  });
}
function acoesAbertas_() { return readAcoes_().filter(function (a) { return a.status === 'Aberta' || a.status === 'Em andamento'; }).sort(function (a, b) { return (a.prazo || '9').localeCompare(b.prazo || '9'); }); }

function getAcoes(pin) {
  checkPin_(pin);
  var todas = readAcoes_();
  return { abertas: acoesAbertas_(), fechadas: todas.filter(function (a) { return a.status === 'Concluída' || a.status === 'Cancelada'; }).slice(-10).reverse() };
}

function salvarAcao_(a) {
  if (!a.acao) throw new Error('Descreva a ação');
  var sh = sh_('Acoes'), row = primeiraLinhaVazia_(sh);
  sh.getRange(row, 1, 1, 12).setValues([['A' + fmt_(new Date(), 'yyMMddHHmmss') + row, new Date(), a.origem || 'Avulsa', a.problema || '', a.acao, a.resp || 'Ambos',
    a.prazo ? parseD_(a.prazo) : '', a.indicador || '', a.impacto || '', 'Aberta', '', '']]);
  sh.getRange(row, 2).setNumberFormat('dd/mm/yyyy'); sh.getRange(row, 7).setNumberFormat('dd/mm/yyyy');
}

function salvarAcao(pin, a) { checkPin_(pin); salvarAcao_(a); return { ok: true }; }

function atualizarAcao(pin, row, status, resultado) {
  checkPin_(pin);
  if (ACAO_STATUS.indexOf(status) < 0) throw new Error('Status inválido');
  var sh = sh_('Acoes');
  sh.getRange(row, 10, 1, 2).setValues([[status, status === 'Concluída' || status === 'Cancelada' ? new Date() : '']]);
  sh.getRange(row, 11).setNumberFormat('dd/mm/yyyy');
  if (resultado) sh.getRange(row, 12).setValue(resultado);
  return { ok: true };
}

/* Ações vencendo, para tarefas e e-mail */
function acoesDe_(pessoa, iso) {
  return acoesAbertas_().filter(function (a) {
    return (!pessoa || a.resp === pessoa || a.resp === 'Ambos') && a.prazo && a.prazo <= addDays_(iso, 2);
  });
}

/* ---------------- Recalcular (valores calculados pelo script, sem fórmulas entre abas) ----------------
 * As fórmulas SUMIFS/COUNTIFS gravadas pelo script davam #ERROR! na planilha em pt_BR.
 * Estes números passam a ser calculados aqui e gravados como valores:
 *   Fichas técnicas C, D, E, M · Semanal F · DRE inteira.
 * Roda: após cada registro no app, a cada edição manual nas abas de origem (gatilho aoEditar) e todo dia às 5h. */
var ABAS_ORIGEM = ['Insumos', 'Receitas', 'Fichas técnicas', 'Despesas', 'Pedidos', 'Semanal', 'Config'];

function recalcular() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return 'Recalculo já em andamento';
  try {
    recalcFichas_();
    recalcSemanal_();
    SpreadsheetApp.flush();
    recalcDRE_();
    return 'Recalculado';
  } finally { lock.releaseLock(); }
}
function recalcularSilencioso_() { try { recalcular(); } catch (e) { Logger.log('recalcular: ' + e.message); } }

function aoEditar(e) {
  try {
    var nome = e && e.range ? e.range.getSheet().getName() : '';
    if (ABAS_ORIGEM.indexOf(nome) >= 0) recalcular();
  } catch (x) { Logger.log(x.message); }
}

function gatilhoEdicao_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'aoEditar') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('aoEditar').forSpreadsheet(ss_()).onEdit().create();
}

function numG_(v) { return typeof v === 'number' ? v : (v === '' || v === null ? NaN : Number(String(v).replace(/[R$\s.]/g, '').replace(',', '.'))); }   // num_ (Code.gs) é outra função: não renomear

function recalcFichas_() {
  var ft = sh_('Fichas técnicas');
  var linhas = ft.getRange(2, 1, 19, 8).getValues();
  var prods = [];
  for (var i = 0; i < linhas.length; i++) { if (!linhas[i][0]) break; prods.push({ row: i + 2, nome: String(linhas[i][0]).trim(), preco: numG_(linhas[i][1]), lote: numG_(linhas[i][6]) }); }
  // insumos: custo por unidade e categoria
  var ins = {};
  var ni = sh_('Insumos').getLastRow() - 1;
  if (ni > 0) sh_('Insumos').getRange(2, 1, ni, 5).getValues().forEach(function (r) {
    if (!r[0]) return;
    var q = numG_(r[3]), p = numG_(r[4]);
    ins[String(r[0]).trim()] = { cat: String(r[1] || ''), custo: (q > 0 && p >= 0 && !isNaN(p)) ? p / q : null };
  });
  // receitas por produto
  var rec = {};
  var nr = sh_('Receitas').getLastRow() - 1;
  if (nr > 0) sh_('Receitas').getRange(2, 1, nr, 3).getValues().forEach(function (r) {
    var prod = String(r[0] || '').trim(), comp = String(r[1] || '').trim(), q = numG_(r[2]);
    if (!prod || !comp || isNaN(q)) return;
    (rec[prod] = rec[prod] || []).push({ comp: comp, q: q });
  });
  var porNome = {}; prods.forEach(function (p) { porNome[p.nome] = p; });
  var memo = {};
  function custo(nome, pilha) {           // {ins, emb} por unidade; null = sem receita/lote; 'falta' = falta preço
    if (memo[nome] !== undefined) return memo[nome];
    var p = porNome[nome];
    if (!p || !rec[nome] || !(p.lote > 0)) return (memo[nome] = null);
    if (pilha[nome]) return 'falta';
    pilha[nome] = true;
    var si = 0, se = 0, falta = false;
    rec[nome].forEach(function (x) {
      if (ins[x.comp]) {
        if (ins[x.comp].custo === null) { falta = true; return; }
        if (ins[x.comp].cat === 'Embalagem') se += x.q * ins[x.comp].custo; else si += x.q * ins[x.comp].custo;
      } else {
        var c = custo(x.comp, pilha);
        if (c === null || c === 'falta') { falta = true; return; }
        si += x.q * (c.ins + c.emb);    // produto usado como componente entra como insumo (igual à aba Receitas)
      }
    });
    delete pilha[nome];
    return (memo[nome] = falta ? 'falta' : { ins: si / p.lote, emb: se / p.lote });
  }
  var cd = [], e = [], m = [];
  prods.forEach(function (p) {
    var c = custo(p.nome, {});
    if (c === null) { cd.push(['', '']); m.push(['']); e.push(['']); return; }
    if (c === 'falta') { cd.push(['falta preço', 'falta preço']); m.push(['']); e.push(['']); return; }
    var tot = c.ins + c.emb;
    cd.push([round2_(c.ins), round2_(c.emb)]); m.push([round2_(tot)]); e.push([isNaN(p.preco) ? '' : round2_(p.preco - tot)]);
  });
  if (!prods.length) return;
  ft.getRange(2, 3, prods.length, 2).setValues(cd).setNumberFormat('"R$" #,##0.00');
  ft.getRange(2, 5, prods.length, 1).setValues(e).setNumberFormat('"R$" #,##0.00');
  ft.getRange(2, 13, prods.length, 1).setValues(m).setNumberFormat('"R$" #,##0.00');
}
function round2_(x) { return Math.round(x * 100) / 100; }

/* Semanal F: custo por competência (itens vendidos na semana × ficha técnica) */
function recalcSemanal_() {
  var sem = sh_('Semanal');
  sem.getRange('F1').setValue('Custo de insumo e embalagem (R$) — dos itens vendidos');
  var datas = sem.getRange(2, 2, 31, 2).getValues();
  var peds = readPedidos_().filter(function (p) { return p.status !== 'Cancelado' && p.data; }), fichas = fichas_();
  var out = datas.map(function (r) {
    if (!isDate_(r[0]) || !isDate_(r[1])) return [''];
    var a = fmt_(r[0]), b = fmt_(r[1]);
    var ct = custoTeorico_(peds.filter(function (p) { return p.data >= a && p.data <= b; }), fichas);
    return [round2_(ct.ins + ct.emb)];
  });
  sem.getRange(2, 6, 31, 1).setValues(out).setNumberFormat('"R$" #,##0.00');
}

/* ---------------- Base de custos: insumos, receitas e lotes ----------------
 * Usada para saber quanto de cada insumo as vendas deveriam ter consumido (consumo previsto). */
function baseCustos_() {
  var ins = {}, sh = sh_('Insumos'), n = sh.getLastRow() - 1;
  if (n > 0) sh.getRange(2, 1, n, 9).getValues().forEach(function (r) {
    if (!r[0]) return;
    var q = numG_(r[3]), p = numG_(r[4]);
    ins[chave_(r[0])] = { nome: String(r[0]).trim(), cat: String(r[1] || ''), un: String(r[2] || ''), custo: (q > 0 && p >= 0 && !isNaN(p)) ? p / q : null,
      contar: /^s/i.test(String(r[8] || '').trim()) };
  });
  var rec = {}, rs = sh_('Receitas'), nr = rs.getLastRow() - 1;
  if (nr > 0) rs.getRange(2, 1, nr, 3).getValues().forEach(function (r) {
    var prod = chave_(r[0]), comp = String(r[1] || '').trim(), q = numG_(r[2]);
    if (!prod || !comp || isNaN(q)) return;
    (rec[prod] = rec[prod] || []).push({ comp: comp, q: q });
  });
  var lote = {};
  sh_('Fichas técnicas').getRange(2, 1, 19, 7).getValues().forEach(function (r) { if (r[0]) lote[chave_(r[0])] = numG_(r[6]); });
  return { ins: ins, rec: rec, lote: lote };
}
/* Soma em acc[insumo] a quantidade de insumo consumida por q unidades do produto (caixas e kits abrem nos produtos componentes) */
function expandir_(base, nome, q, acc, pilha) {
  var k = chave_(nome), receita = base.rec[k], lote = base.lote[k];
  if (!receita || !(lote > 0) || pilha[k]) return false;
  pilha[k] = true;
  receita.forEach(function (x) {
    var ki = chave_(x.comp);
    if (base.ins[ki]) acc[ki] = (acc[ki] || 0) + q * x.q / lote;
    else expandir_(base, x.comp, q * x.q / lote, acc, pilha);
  });
  delete pilha[k];
  return true;
}
function consumoPrevisto_(base, pedidos) {
  var acc = {};
  pedidos.forEach(function (p) { parseItens_(p.itens).forEach(function (it) { if (!REPASSE_RE.test(it.nome)) expandir_(base, it.nome, it.q, acc, {}); }); });
  return acc;
}

/* ---------------- Contagem de estoque (aprovada em 03/10/2026) ----------------
 * Aba Estoque: uma linha por insumo contado. "Mês de referência" (aaaa-mm) = estoque no FIM daquele mês.
 * Só entram os insumos marcados com "Sim" na coluna I da aba Insumos ("Contar no estoque"). */
var ESTOQUE_INICIO = '2026-09';   // fim de setembro = início de outubro: estoque zero (compras começaram em 29/09 e foram lançadas em outubro)
var ESTOQUE_CONTAR = ['Chocolate branco em barra', 'Chocolate em barra', 'Gotas de chocolate', 'Bombom Ouro Branco', 'Nutella', 'Recheio Caribe Bueno'];

function refMes_(ano, mes) { return ano + '-' + (mes < 10 ? '0' : '') + mes; }
function refAnterior_(ref) { var a = +ref.slice(0, 4), m = +ref.slice(5, 7) - 1; if (m < 1) { m = 12; a--; } return refMes_(a, m); }
function nomeRef_(ref) { return ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][+ref.slice(5, 7) - 1] + ' de ' + ref.slice(0, 4); }

function abaEstoque_() {
  var ss = ss_(), sh = ss.getSheetByName('Estoque');
  if (!sh) {
    sh = ss.insertSheet('Estoque');
    sh.getRange(1, 1, 1, 9).setValues([['Mês de referência (fim do mês)', 'Insumo', 'Quantidade contada', 'Unidade', 'Custo unitário na contagem (R$)', 'Valor (R$)', 'Contado em', 'Por', 'Tipo']])
      .setFontWeight('bold').setBackground(MARCA.vinho).setFontColor('#FFFFFF');
    sh.setFrozenRows(1); sh.setColumnWidth(1, 200); sh.setColumnWidth(2, 240);
    sh.getRange('A2:A2000').setNumberFormat('@');
  }
  return sh;
}
/* Insumos contados: { ref: { chaveInsumo: q } }. Linhas de Tipo "Produção" (versão 10) ficam de fora: são lidas por readEstoqueMassa_. */
function readEstoque_() { return lerEstoque_(false); }
/* Produção contada no fim do mês: { ref: { produto: unidades } } */
function readEstoqueMassa_() { return lerEstoque_(true); }
function lerEstoque_(massa) {
  var sh = ss_().getSheetByName('Estoque'), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues().forEach(function (r) {
    var ref = isDate_(r[0]) ? fmt_(r[0], 'yyyy-MM') : String(r[0] || '').trim().slice(0, 7), q = numG_(r[2]);
    if (!/^\d{4}-\d{2}$/.test(ref) || !r[1] || isNaN(q)) return;
    if (/^(Produção|Massa)$/.test(String(r[8] || '').trim()) !== massa) return;
    (out[ref] = out[ref] || {})[massa ? String(r[1]).trim() : chave_(r[1])] = q;
  });
  return out;
}

/* Resultado de um mês para os insumos contados. Estoque inicial desconhecido ou sem contagem final = sem consumo real. */
function estoqueMes_(ref, ctx) {
  ctx = ctx || {};
  var base = ctx.base || baseCustos_(), est = ctx.est || readEstoque_(), des = ctx.des || readDespesas_();
  var peds = ctx.peds || readPedidos_().filter(function (p) { return p.status !== 'Cancelado' && p.data; });
  var ini = ref + '-01', fimEx = fmt_(new Date(+ref.slice(0, 4), +ref.slice(5, 7), 1));   // 1º dia do mês seguinte
  var pm = peds.filter(function (p) { return p.data >= ini && p.data < fimEx; });
  var prev = consumoPrevisto_(base, pm);
  var refIni = refAnterior_(ref), temIni = !!est[refIni] || refIni <= ESTOQUE_INICIO, temFim = !!est[ref];
  // versão 10: insumo guardado no estoque de produção (massa congelada, produto pronto) também é estoque, pela receita
  var estM = ctx.estMassa || readEstoqueMassa_(), avisosMassa = [], guardIni = {}, guardFim = {};
  if ((estM[ref] || estM[refIni]) && typeof v10InsumosGuardados_ === 'function') {
    var gi = v10InsumosGuardados_(estM[refIni] || {}, base), gf = v10InsumosGuardados_(estM[ref] || {}, base);
    guardIni = gi.porInsumo; guardFim = gf.porInsumo; avisosMassa = gf.avisos;
  }
  var itens = [], tot = { ini: 0, compras: 0, fim: 0, real: 0, prev: 0 }, semPreco = [];
  Object.keys(base.ins).forEach(function (k) {
    var i = base.ins[k]; if (!i.contar) return;
    var compras = des.filter(function (d) { return d.data >= ini && d.data < fimEx && chave_(d.insumo) === k; }).reduce(function (s, d) { return s + d.qtd; }, 0);
    var qIni = temIni ? ((est[refIni] || {})[k] || 0) + (guardIni[k] || 0) : null, qFim = temFim ? ((est[ref] || {})[k] || 0) + (guardFim[k] || 0) : null;
    var real = qIni !== null && qFim !== null ? qIni + compras - qFim : null, pv = prev[k] || 0;
    itens.push({ nome: i.nome, un: i.un, custo: i.custo, naMassa: Math.round((guardFim[k] || 0) * 10) / 10, ini: qIni, compras: compras, fim: qFim, real: real, previsto: Math.round(pv * 10) / 10, dif: real === null ? null : Math.round((real - pv) * 10) / 10 });
    if (i.custo === null) { semPreco.push(i.nome); return; }
    tot.prev += pv * i.custo; tot.compras += compras * i.custo;
    if (qIni !== null) tot.ini += qIni * i.custo;
    if (qFim !== null) tot.fim += qFim * i.custo;
    if (real !== null) tot.real += real * i.custo;
  });
  var completo = temIni && temFim;
  return { ref: ref, nome: nomeRef_(ref), temIni: temIni, temFim: temFim, completo: completo, itens: itens, semPreco: semPreco, avisosMassa: avisosMassa,
    massa: estM[ref] || null,
    ini: temIni ? round2_(tot.ini) : null, fim: temFim ? round2_(tot.fim) : null, real: completo ? round2_(tot.real) : null, previsto: round2_(tot.prev),
    perda: completo ? round2_(tot.real - tot.prev) : null, perdaPct: completo && tot.prev > 0 ? Math.round((tot.real - tot.prev) / tot.prev * 10000) / 10000 : null };
}

/* Tela de contagem no app */
function getEstoque(pin) {
  checkPin_(pin);
  var base = baseCustos_(), est = readEstoque_(), hoje = today_();
  var atual = hoje.slice(0, 7), anterior = refAnterior_(atual), padrao = +hoje.slice(8) <= 7 ? anterior : atual;
  var itens = Object.keys(base.ins).filter(function (k) { return base.ins[k].contar; }).map(function (k) { var i = base.ins[k]; return { nome: i.nome, un: i.un || 'g', temPreco: i.custo !== null, salvo: { atual: (est[atual] || {})[k], anterior: (est[anterior] || {})[k] } }; })
    .sort(function (a, b) { return a.nome.localeCompare(b.nome); });
  var refs = Object.keys(est).sort(), ultimo = refs.length ? refs[refs.length - 1] : null;
  // versão 10: estoque de produção, preenchido com o que o app conta (a Raquel confirma ou corrige)
  var estM = readEstoqueMassa_(), massa = [];
  if (typeof estoqueProducao_ === 'function') { try { massa = estoqueProducao_().itens.filter(function (x) { return x.lancado; }).map(function (x) { return { produto: x.produto, saldo: x.estoque, salvo: { atual: (estM[atual] || {})[x.produto], anterior: (estM[anterior] || {})[x.produto] } }; }); } catch (e) { Logger.log('produção na contagem: ' + e.message); } }
  return { massa: massa, itens: itens, refs: [{ ref: anterior, nome: nomeRef_(anterior), contado: !!est[anterior] }, { ref: atual, nome: nomeRef_(atual), contado: !!est[atual] }], padrao: padrao,
    resultado: ultimo ? estoqueMes_(ultimo, { base: base, est: est, estMassa: estM }) : null };
}

/* massa (versão 10) = [{ produto, q }]: unidades do estoque de produção contadas no congelador. Gravadas no Estoque com
   Tipo "Produção" e, se a contagem for diferente do que o app conta, a diferença vai para a aba Producao (Contagem). */
function salvarContagem(pin, ref, itens, pessoa, massa) {
  checkPin_(pin);
  ref = String(ref || '');
  if (!/^\d{4}-\d{2}$/.test(ref)) throw new Error('Mês de referência inválido');
  itens = itens || []; massa = Array.isArray(massa) ? massa : [];
  if (!itens.length && !massa.length) throw new Error('Informe pelo menos um item');
  var base = baseCustos_();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = abaEstoque_(), n = Math.max(sh.getLastRow() - 1, 0);
    var atuais = n ? sh.getRange(2, 1, n, 2).getValues().map(function (r) { return (isDate_(r[0]) ? fmt_(r[0], 'yyyy-MM') : String(r[0]).trim().slice(0, 7)) + '|' + chave_(r[1]); }) : [];
    var gravados = 0;
    itens.forEach(function (it) {
      var q = Number(String(it.q).replace(',', '.'));
      if (it.q === '' || it.q === null || isNaN(q) || q < 0) return;
      var i = base.ins[chave_(it.nome)]; if (!i) return;
      var linha = [ref, i.nome, q, i.un, i.custo === null ? '' : Math.round(i.custo * 10000) / 10000, i.custo === null ? '' : round2_(q * i.custo), new Date(), pessoa || ''];
      var pos = atuais.indexOf(ref + '|' + chave_(i.nome));
      var row = pos >= 0 ? pos + 2 : sh.getLastRow() + 1;
      sh.getRange(row, 1, 1, 8).setValues([linha]);
      sh.getRange(row, 1).setNumberFormat('@'); sh.getRange(row, 6).setNumberFormat('"R$" #,##0.00'); sh.getRange(row, 7).setNumberFormat('dd/mm/yyyy HH:mm');
      if (pos < 0) atuais.push(ref + '|' + chave_(i.nome));
      gravados++;
    });
    var ajustes = massa.length ? salvarContagemMassa_(sh, ref, massa, pessoa) : 0;
    gravados += massa.length ? massa.filter(function (m) { return m && m.q !== '' && m.q !== null && !isNaN(Number(m.q)); }).length : 0;
    if (!gravados) throw new Error('Nenhuma quantidade válida');
    return { ok: true, gravados: gravados, ajustes: ajustes };
  } finally { lock.releaseLock(); }
}

function salvarContagemMassa_(sh, ref, massa, pessoa) {
  if (typeof prodContagem_ !== 'function') throw new Error('Falta o arquivo Massa.gs no servidor.');
  var nomes = {}, ajustes = 0;
  estoqueProducao_().itens.forEach(function (x) { nomes[prodChave_(x.produto)] = x.produto; });
  var n = Math.max(sh.getLastRow() - 1, 0);
  var atuais = n ? sh.getRange(2, 1, n, 9).getValues().map(function (r) { return String(r[0]).trim().slice(0, 7) + '|' + String(r[1]).trim() + '|' + (/^(Produção|Massa)$/.test(String(r[8]).trim()) ? 'P' : ''); }) : [];
  massa.forEach(function (m) {
    var q = Number(String(m && m.q).replace(',', '.')), nome = m && nomes[prodChave_(m.produto)];
    if (!m || m.q === '' || m.q === null || isNaN(q) || q < 0 || q !== Math.round(q) || !nome) return;
    var pos = atuais.indexOf(ref + '|' + nome + '|P'), row = pos >= 0 ? pos + 2 : sh.getLastRow() + 1;
    sh.getRange(row, 1, 1, 9).setValues([[ref, nome, q, 'unidades', '', '', new Date(), pessoa || '', 'Produção']]);
    sh.getRange(row, 1).setNumberFormat('@'); sh.getRange(row, 7).setNumberFormat('dd/mm/yyyy HH:mm');
    if (pos < 0) atuais.push(ref + '|' + nome + '|P');
    if (prodContagem_(nome, q, pessoa, 'Contagem do fim de ' + nomeRef_(ref))) ajustes++;
  });
  return ajustes;
}

/* ---------------- DRE em regime de competência (03/10/2026) ---------------- */
function recalcDRE_() {
  var dre = sh_('DRE'); if (!dre) return;
  var c = config_();
  var peds = readPedidos_().filter(function (p) { return p.status !== 'Cancelado' && p.data; });
  var des = readDespesas_();
  var fichas = fichas_(), base = baseCustos_(), est = readEstoque_(), estMassa = readEstoqueMassa_();
  var rateio = Number(c.rateio_gas_energia) || 0, prol = Number(c.prolabore_mensal) || 0, lim = Number(c.limite_mei) || 0;
  var soma = function (arr) { return arr.reduce(function (s, x) { return s + x.valor; }, 0); };
  var somaRec = function (arr) { return arr.reduce(function (s, p) { return s + p.receita; }, 0); };
  var cols = DRE_MESES.map(function (mm) {
    var ini = fmt_(new Date(mm[0], mm[1] - 1, 1)), fim = fmt_(new Date(mm[0], mm[1], 1)), anoIni = fmt_(new Date(mm[0], 0, 1));
    var pm = peds.filter(function (p) { return p.data >= ini && p.data < fim; });
    var dm = des.filter(function (d) { return d.data >= ini && d.data < fim; });
    var cat = function (k) { return soma(dm.filter(function (d) { return d.cat === k; })); };
    var ct = custoTeorico_(pm, fichas);
    var r3 = somaRec(pm), r4 = cat('Imposto (DAS)'), r5 = r3 - r4;
    var r6 = ct.ins, r7 = ct.emb, r8 = cat('Taxas e outros variáveis');   // competência: custo dos itens vendidos
    var r9 = r5 - r6 - r7 - r8, r10 = r3 ? r9 / r3 : '';
    var r11 = Math.max(cat('Gás e energia'), rateio), r12 = cat('Marketing'), r13 = cat('Equipamentos e manutenção'), r14 = cat('Outras fixas');
    var r15 = r9 - r11 - r12 - r13 - r14, r16 = prol, r17 = r15 - r16;
    var r19 = '', r20 = '';   // horas e margem por hora: sem uso desde a versão 10 (não são gravadas)
    var r21 = ct.valor === null ? '' : ct.valor;
    var em = estoqueMes_(refMes_(mm[0], mm[1]), { base: base, est: est, estMassa: estMassa, des: des, peds: peds });
    var r22 = em.perda === null ? '' : em.perda;
    var r23 = (r10 === '' || r10 <= 0) ? '' : (r11 + r12 + r13 + r14 + r16) / r10;
    var r24 = somaRec(peds.filter(function (p) { return p.data >= anoIni && p.data < fim; }));
    var r25 = lim ? r24 / lim : '';
    var compras = cat('Insumo') + cat('Embalagem');
    var nz = function (v) { return v === null ? '' : v; };
    return [r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13, r14, r15, r16, r17, '', r19, r20, r21, r22, r23, r24, r25,
      '', compras, nz(em.ini), nz(em.fim), nz(em.real), em.previsto, nz(em.perda), nz(em.perdaPct), pm.length ? ct.semCustoUn : '']
      .map(function (v) { return typeof v === 'number' ? Math.round(v * 10000) / 10000 : v; });
  });
  var linhas = DRE_LINHAS.map(function (_, i) { return cols.map(function (col) { return col[i]; }); });
  // escreve em blocos, pulando as linhas sem uso (horas e margem por hora ficam como estão, ocultas)
  var nL = DRE_LINHAS.length, k = 0;
  while (k < nL) {
    if (DRE_SEM_USO.indexOf(DRE_LINHAS[k]) >= 0) { k++; continue; }
    var f = k; while (f < nL && DRE_SEM_USO.indexOf(DRE_LINHAS[f]) < 0) f++;
    dre.getRange(3 + k, 1, f - k, 1).setValues(DRE_LINHAS.slice(k, f).map(function (l) { return [l]; }));
    dre.getRange(3 + k, 2, f - k, DRE_MESES.length).setValues(linhas.slice(k, f));
    k = f;
  }
  // formatos das linhas novas (26 a 34) e nota abaixo da tabela
  dre.getRange(27, 2, 6, DRE_MESES.length).setNumberFormat('"R$" #,##0.00');
  dre.getRange(33, 2, 1, DRE_MESES.length).setNumberFormat('0.0%');
  dre.getRange(34, 2, 1, DRE_MESES.length).setNumberFormat('0');
  dre.getRange(36, 1).setValue(DRE_NOTA).setWrap(true).setFontColor('#6B5560');
}

/* ---------------- Atualização v9 (03/10/2026): rodar UMA vez no editor ----------------
 * Cria a coluna "Repasse (R$)" em Pedidos, a coluna "Contar no estoque" em Insumos (marca os insumos caros),
 * a aba Estoque, limpa a nota antiga da DRE e recalcula. Pode rodar de novo sem duplicar nada. */
function atualizarV9() {
  var ss = ss_();
  var ped = sh_('Pedidos');
  ped.getRange(1, 15).setValue('Repasse (R$)').setFontWeight('bold').setBackground(MARCA.vinho).setFontColor('#FFFFFF');
  ped.getRange(1, 15).setNote('Taxa de entrega (motoboy, Uber) cobrada da cliente e repassada. Entra no valor cobrado, mas não é receita da RM.');
  ped.getRange('O2:O2000').setNumberFormat('"R$" #,##0.00');
  var ins = sh_('Insumos');
  ins.getRange(1, 9).setValue('Contar no estoque').setFontWeight('bold').setBackground(MARCA.vinho).setFontColor('#FFFFFF');
  ins.getRange(1, 9).setNote('"Sim" = entra na contagem do fim do mês (insumos caros). A contagem é feita no app: + › Contar o estoque.');
  ins.getRange('I2:I200').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Sim', 'Não'], true).build());
  var n = ins.getLastRow() - 1, marcados = 0;
  if (n > 0) {
    var v = ins.getRange(2, 1, n, 9).getValues(), alvo = ESTOQUE_CONTAR.map(chave_);
    var col = v.map(function (r) { var atual = String(r[8] || ''); if (!atual && r[0] && alvo.indexOf(chave_(r[0])) >= 0) { marcados++; return ['Sim']; } return [atual]; });
    ins.getRange(2, 9, n, 1).setValues(col);
  }
  abaEstoque_();
  var dre = sh_('DRE');
  dre.getRange(26, 1, 12, 1).clearContent();   // nota antiga (linha 27) sai; as linhas novas são escritas pelo recálculo
  SpreadsheetApp.flush();
  recalcular();
  var msg = 'Atualização v9 concluída: ' + marcados + ' insumo(s) marcado(s) para contagem; aba Estoque pronta; DRE em regime de competência.';
  Logger.log(msg);
  return msg;
}

/* Chamado pelo app logo depois de registrar pedido, despesa ou fechamento da semana */
function posAlteracao(pin) { checkPin_(pin); return recalcular(); }
