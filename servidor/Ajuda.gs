/**
 * RM — Pedidos (edição e histórico) e Ajuda (perguntas frequentes + assistente de IA opcional)
 * 26/09/2026
 */

/* ---------------- Pedidos: editar ---------------- */
// orig = { id, cliente } do pedido como estava na tela; protege contra linha trocada na planilha
function editarPedido(pin, row, orig, p) {
  checkPin_(pin);
  if (!p.cliente) throw new Error('Informe o cliente');
  if (!p.itens) throw new Error('Escolha pelo menos um item');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sh_('Pedidos');
    var atual = sh.getRange(row, 1, 1, 15).getValues()[0];
    var ok = orig.id ? String(atual[12]) === String(orig.id) : String(atual[1]).trim() === String(orig.cliente || '').trim();
    if (!ok) throw new Error('A lista mudou desde que foi aberta. Atualize a tela e tente de novo.');
    var cT = colTipoPedido_(sh), tipo = p.tipo === undefined ? null : validarTipoPedido_(p.tipo, 'Encomenda');   // sem Tipo (app antigo): fica como está
    garantirCliente_(p.cliente, p.whats, p.canal);
    sh.getRange(row, 2, 1, 11).setValues([[p.cliente, p.itens, Number(p.valor) || 0, p.canal || '', p.codigo || '', p.janela || '',
      p.retirada ? parseD_(p.retirada) : '', p.pix ? 'Sim' : 'Não', p.assinatura ? 'Sim' : 'Não', p.status || atual[10] || 'Confirmado', p.obs || '']]);
    sh.getRange(row, 15).setValue(Number(p.repasse) || '').setNumberFormat('"R$" #,##0.00');   // taxa de entrega repassada (não é receita)
    sh.getRange(row, 8).setNumberFormat('dd/mm/yyyy');
    sh.getRange(row, 4).setNumberFormat('"R$" #,##0.00');
    if (tipo && cT >= 0) sh.getRange(row, cT + 1).setValue(tipo);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---------------- Pedidos: histórico (retirados e cancelados) ---------------- */
function getPedidosHistorico(pin) {
  checkPin_(pin);
  return readPedidos_().filter(function (p) { return p.status === 'Retirado' || p.status === 'Cancelado'; })
    .sort(function (a, b) { return (b.retirada || b.data || '').localeCompare(a.retirada || a.data || '') || b.row - a.row; })
    .slice(0, 400);
}

/* ---------------- Ajuda: perguntas frequentes ---------------- */
// c = assunto, p = pergunta, r = resposta, k = outras palavras que a pessoa pode usar
var AJUDA_FAQ = [
  { c: 'Pedidos', p: 'Como registro um pedido?', k: 'novo pedido encomenda venda cadastrar',
    r: 'Toque no botão + no centro da barra de baixo e escolha Pedido. No topo, o Tipo já vem escolhido pelos itens (Pronta-entrega para cookie, Encomenda quando tem bolo); dá para trocar. Digite o nome da cliente (o app sugere quem já comprou), marque os itens com o + de cada produto, escolha o dia e o horário da retirada e como a cliente chegou. O Pix recebido já vem ligado: desligue se ainda não caiu. Toque em Salvar. Na tela seguinte dá para mandar a confirmação no WhatsApp.' },
  { c: 'Pedidos', p: 'Como incluo um item que não está no cardápio?', k: 'outro item fora do cardápio personalizado quantidade avulso',
    r: 'No pedido, abaixo da lista de produtos, toque em "+ Item fora do cardápio". Escreva a descrição, ajuste a quantidade no + e − e informe o preço de uma unidade. O total soma sozinho. Pode incluir quantos itens quiser. Esses itens entram na receita, mas não têm custo automático, porque não têm ficha técnica.' },
  { c: 'Pedidos', p: 'Como edito um pedido já registrado?', k: 'alterar mudar corrigir errado trocar item valor data',
    r: 'Na aba Pedidos, toque nos três pontinhos do pedido e escolha "Editar pedido". Dá para mudar cliente, itens, quantidades, valor, retirada, canal, Pix e observação. Pedidos já entregues também podem ser editados: abra Pedidos, toque em Entregues e depois no pedido.' },
  { c: 'Pedidos', p: 'Onde vejo os pedidos já entregues ou cancelados?', k: 'histórico antigos retirados passados entregues cancelados',
    r: 'Na aba Pedidos, troque de "Em aberto" para "Entregues". Os pedidos aparecem por mês, com total e busca por cliente ou item. Tocando em um pedido dá para editar, voltar para em aberto ou fazer o mesmo pedido de novo.' },
  { c: 'Pedidos', p: 'Como faço o mesmo pedido de novo para uma cliente?', k: 'repetir pedir de novo recompra mesmo pedido',
    r: 'Em Pedidos › Entregues, toque no pedido antigo e escolha "Pedir de novo". O formulário abre com a cliente, os itens e o canal preenchidos. Confira a retirada e o Pix e salve.' },
  { c: 'Pedidos', p: 'Como funcionam as etapas do pedido (Recebido, Assado ou Produzido, Retirado)?', k: 'status etapa próximo passo botão produzido assado retirado recebido mudar voltar',
    r: 'Todo pedido tem 3 etapas, mostradas no cartão. Pronta-entrega: Recebido, Assado (o cookie saiu do forno) e Retirado. Encomenda: Recebido, Produzido e Retirado. O botão do cartão avança uma etapa ("Marcar como assado" ou "Marcar como produzido", depois "Marcar como retirado"). Para mudar para qualquer etapa, inclusive voltar, toque nos três pontinhos e escolha em "Etapa do pedido". Toda mudança mostra "Desfazer" por alguns segundos. Retirado sai da lista de abertos e vai para Entregues.' },
  { c: 'Pedidos', p: 'Como mudo o texto das mensagens do WhatsApp?', k: 'mensagem whatsapp texto editar mudar confirmação lembrete modelo',
    r: 'Só uma vez: ao tocar em qualquer botão do WhatsApp, o app mostra o texto pronto numa caixa editável. Mude o que quiser e toque em "Abrir no WhatsApp". De vez: em Pedidos, role até o fim e toque em "Mensagens do WhatsApp" (ou em "Mudar o texto padrão" na própria caixa). Os campos entre chaves, como {nome}, {itens}, {valor}, {retirada}, {pagamento} e {cobranca}, são trocados pelos dados do pedido; toque num campo para inseri-lo. A prévia mostra como fica com Pix pendente e com Pix recebido. Salvar vale na hora para os dois celulares, e "Voltar ao original" desfaz.' },
  { c: 'Pedidos', p: 'Como a chave Pix entra nas mensagens?', k: 'chave pix pendente cobrança cobrar pagamento conta mensagem',
    r: 'Enquanto o Pix do pedido estiver pendente, a confirmação (campo {pagamento}) e o lembrete (campo {cobranca}) incluem o valor e a chave Pix. Pedido retirado sem Pix usa a mensagem "Depois da entrega (Pix pendente)", que pede o pagamento com a chave. Quando o Pix é marcado como recebido, a cobrança some sozinha. A chave e o nome do titular ficam na aba Config da planilha (pix_chave e pix_titular): ao trocar lá, todas as mensagens mudam.' },
  { c: 'Pedidos', p: 'Como marco que o Pix caiu?', k: 'pix pagamento pago recebido pendente',
    r: 'O pagamento é separado da etapa. Toque no selo vermelho "Pix pendente" do cartão, ou nos três pontinhos › Pagamento › Pix recebido. Para voltar, escolha Pix pendente no mesmo lugar. Se marcar como retirado com o Pix pendente, o app pergunta antes e o pedido continua na lista de Pix pendente.' },
  { c: 'Pedidos', p: 'Como cancelo um pedido?', k: 'cancelar desistiu excluir apagar',
    r: 'Toque nos três pontinhos do pedido e em "Cancelar pedido". Ele sai da lista e da receita. Se foi engano, abra Pedidos › Entregues, toque no pedido cancelado e escolha "Voltar para em aberto".' },
  { c: 'Pedidos', p: 'Pronta-entrega ou encomenda?', k: 'tipo pronta entrega encomenda prazo retirada dia horário quinta sexta terça bolo cookie antecedência',
    r: 'Cookie é pronta-entrega: sai da massa congelada (lançada como produção) e é assado no dia, então a retirada pode ser no mesmo dia ou quando a cliente combinar. O Pix pode ficar para a retirada. Bolo é encomenda: precisa de pelo menos 2 dias de antecedência (Config › antecedencia_bolo_dias) e Pix antecipado. Não existe mais prazo semanal de pedido nem janela fixa: dia e horário da retirada são combinados com cada cliente. O app escolhe o Tipo pelos itens (bolo ou pudim = encomenda) e você pode trocar no topo do pedido.' },
  { c: 'Pedidos', p: 'Por que aparece "abaixo do mínimo de R$ 45"?', k: 'mínimo pedido pequeno valor baixo',
    r: 'O plano define pedido mínimo de R$ 45, porque abaixo disso o tempo de atender, embalar e entregar não se paga. O app só avisa, não bloqueia: dá para salvar se for uma exceção combinada.' },
  { c: 'Pedidos', p: 'Como lembro a cliente da retirada?', k: 'whatsapp lembrete mensagem avisar',
    r: 'O lembrete é para encomendas: no cartão do pedido, toque no ícone do WhatsApp. A mensagem já vem pronta com os itens, o dia, o horário e, se o Pix estiver pendente, a chave Pix. Em pronta-entrega, o mesmo botão manda "Seu pedido está separado". Dá para ajustar o texto antes de abrir o WhatsApp. Se o pedido já foi retirado sem Pix, o botão prepara a cobrança. O ícone só aparece se a cliente tiver WhatsApp cadastrado.' },
  { c: 'Clube', p: 'Como funciona o Clube da Raquel?', k: 'fidelidade mimo cookies frequente assinatura reserva',
    r: 'Toda cliente entra automaticamente. A cada 5 pedidos, ela ganha 2 cookies de mimo: o app avisa ao salvar o pedido e escreve na observação. Quem faz 3 ou mais pedidos em 60 dias vira frequente: recebe primeiro os sabores disponíveis e é convidada para a assinatura. A lista de frequentes aparece na tela Hoje aos sábados.' },
  { c: 'Despesas', p: 'Como lanço uma compra ou despesa?', k: 'despesa compra gasto conta mercado nota',
    r: 'Toque no + e escolha "Despesa ou compra". Escolha a categoria, informe o valor e a data. Para ingrediente ou embalagem, informe também qual insumo e a quantidade comprada: assim o app atualiza o preço do insumo e recalcula o custo dos produtos.' },
  { c: 'Despesas', p: 'Qual a diferença entre despesa variável e fixa?', k: 'variável fixa categoria tipo',
    r: 'Variável é o que cresce com as vendas: ingrediente (Insumo), Embalagem e Taxas. Fixa é o que existe mesmo sem vender: gás e energia, marketing, equipamentos e manutenção, imposto do MEI (DAS) e outras. A variável entra na margem de contribuição; a fixa entra depois, no resultado do negócio.' },
  { c: 'Despesas', p: 'Paguei com dinheiro pessoal. Como registro?', k: 'conta pessoal pj separar dinheiro pago com',
    r: 'Na despesa, em "Pago com", escolha Conta pessoal ou Dinheiro. Ela conta normalmente nos custos do negócio. O campo serve para acertar depois entre a conta pessoal e a conta do negócio e manter as duas separadas.' },
  { c: 'Custos e margem', p: 'Como o app calcula o custo de um bolo?', k: 'custo produto ficha técnica receita insumo preço cálculo',
    r: 'São três abas da planilha. Insumos guarda o preço de compra de cada ingrediente e embalagem (preço ÷ quantidade = custo por grama, unidade etc.). Receitas diz quanto de cada insumo vai em um lote de cada produto. Fichas técnicas diz quantas unidades o lote rende. Custo por unidade = soma (quantidade × custo do insumo) ÷ unidades do lote. Quando você lança uma compra com quantidade, o preço do insumo muda e o custo é recalculado.' },
  { c: 'Custos e margem', p: 'O que é margem por unidade?', k: 'margem unitária lucro por bolo',
    r: 'É o preço de venda menos o custo de insumo e embalagem de uma unidade. Mostra quanto cada unidade deixa para pagar as despesas fixas e o trabalho. Não inclui o tempo gasto.' },
  { c: 'Custos e margem', p: 'O que é margem de contribuição por produto?', k: 'margem produto mix decisão principal indicador hora',
    r: 'É o preço de venda menos o custo de insumo e embalagem da ficha técnica, em reais por unidade e em % do preço. Fica em Gestão › Números e em Gráficos, do maior para o menor. É o número que decide o mix: o que entra no cardápio, o que produzir mais e qual preço revisar. A margem por hora e o registro de horas saíram do app em 22/10/2026.' },
  { c: 'Custos e margem', p: 'Por que um produto aparece com "falta preço"?', k: 'falta preço sem custo erro ficha',
    r: 'Algum insumo da receita desse produto está sem preço na aba Insumos, ou o produto não tem "Unidades por lote" preenchido. Lance uma compra desse insumo com quantidade pelo app, ou preencha o preço e a quantidade na aba Insumos. O custo aparece no próximo recálculo.' },
  { c: 'Custos e margem', p: 'O que é custo teórico e custo real?', k: 'teórico real desperdício diferença',
    r: 'Custo teórico (ou previsto) = o que as vendas do mês deveriam ter gastado de insumo e embalagem, pela ficha técnica. É o custo que entra no resultado do mês. Custo real = o que foi de fato consumido, medido pela contagem de estoque do fim do mês nos insumos marcados: estoque inicial + compras − estoque final. Se o real passar mais de 10% do previsto, há perda, porção maior que a receita ou ficha técnica errada. As compras do mês aparecem só como informação, porque um pacote de chocolate rende várias semanas.' },
  { c: 'Custos e margem', p: 'Como faço a contagem de estoque do fim do mês?', k: 'contagem estoque contar inventário fim do mês chocolate perda',
    r: 'No último dia do mês, toque no + › Mais › "Contar o estoque". Pese ou conte o que sobrou de cada insumo da lista (em gramas ou unidades, como aparece) e confira a seção "Produção no estoque". Toque em Salvar. Leva uns 10 minutos. Só entram os insumos marcados com "Sim" na coluna "Contar no estoque" da aba Insumos, normalmente os caros: chocolates, Nutella, recheios. Depois de salvar, a tela mostra, por insumo, quanto foi usado de verdade e quanto as fichas previam. Esqueceu um mês? A contagem pode ser feita nos primeiros dias do mês seguinte, escolhendo o mês certo no topo.' },
  { c: 'Produção', p: 'Como lanço a produção?', k: 'lote massa produzir bolinhas congelador congelar cookie produção produzi',
    r: 'Toque no + e em "Produção" (ou em "+ Lançar" no cartão Produção da tela Hoje). Em "Produzi", escolha o produto e informe quantas unidades foram para o congelador ou ficaram prontas: bolinhas de massa crua contam como unidade. Toque em Salvar; o aviso tem Desfazer.' },
  { c: 'Produção', p: 'Como o estoque de produção baixa?', k: 'estoque produção baixa pedido livres reservado retirado',
    r: 'Sozinho. Pedido em aberto reserva as unidades (aparecem "em pedidos"); quando o pedido é marcado como retirado, elas saem do estoque. Livres = no estoque − em pedidos. Pedido cancelado devolve. Caixas e kits contam pelos sabores escolhidos em "O que vai nas caixas". O cookie fica pronto quando é assado: no pedido, toque em "Marcar como assado".' },
  { c: 'Produção', p: 'O que faço quando a massa estraga?', k: 'massa estragou vencida descartar descarte perda jogar fora',
    r: 'Toque no + › Produção › "Contei o estoque", escolha o produto e informe quanto existe agora no congelador. O app grava a diferença como contagem e ela entra na perda do mês (meta: menos de 5% do produzido).' },
  { c: 'Produção', p: 'Por que aparece "faltam"?', k: 'faltam negativo estoque produção erro saldo',
    r: 'Os pedidos em aberto pedem mais do que o app tem no estoque: falta lançar uma produção ou a contagem real é diferente. Lance o que foi produzido (+ › Produção › Produzi) ou conte o congelador (Contei o estoque). O pedido nunca é bloqueado por falta de estoque.' },
  { c: 'Produção', p: 'Como conto a produção no fim do mês?', k: 'contar massa congelador contagem fim do mês bolinhas produção',
    r: 'Na tela "Contar o estoque", a seção "Produção no estoque" vem com o que o app conta em cada produto. Conte e corrija o que estiver diferente: a diferença entra no controle de produção. Os insumos guardados nessas unidades (chocolate, recheio) entram no estoque final, então a massa feita e não vendida não aparece como perda.' },
  { c: 'Pedidos', p: 'Como registro a taxa de entrega (motoboy, Uber)?', k: 'taxa entrega frete motoboy uber repasse corrida',
    r: 'No pedido, em "Taxa de entrega (repasse)", informe o valor que a cliente paga pela corrida. Ele soma no total cobrado e entra na mensagem do WhatsApp, mas não conta como receita da RM, porque o dinheiro vai para o motoboy ou para o Uber. Não lance a taxa como item fora do cardápio.' },
  { c: 'Custos e margem', p: 'Os números atualizam sozinhos?', k: 'recalcular atualizar planilha erro fórmula demora botão desatualizado',
    r: 'Quase sempre. O app recalcula custos, semanas e DRE logo depois de salvar pedido, despesa ou fechamento da semana, e todo dia às 5h. Edições feitas à mão na planilha também disparam o recálculo, mas mudanças feitas pelo Claude não. Se algo parecer desatualizado, vá em Gestão › Números e toque em "Recalcular agora", no fim da tela. Leva até 30 segundos.' },
  { c: 'Resultado', p: 'Como leio o resultado do mês (DRE)?', k: 'dre resultado lucro mês demonstrativo',
    r: 'O resultado segue o regime de competência: conta o custo do que foi vendido no mês, não o que foi comprado. Receita bruta (sem taxa de entrega repassada) − DAS = receita líquida. Menos o custo de insumo e embalagem dos itens vendidos (pela ficha técnica) e as taxas = margem de contribuição. Menos as despesas fixas (gás e energia, marketing, equipamentos, outras) = resultado antes do pró-labore. Menos o pró-labore = resultado do negócio. Abaixo vêm as compras do mês (informativo) e a perda medida pela contagem de estoque. Se algum item vendido não tem custo cadastrado, a margem aparece maior do que é: o app avisa em "Vendidos sem custo cadastrado". Fica em Gestão › Números › Este mês e na aba DRE da planilha.' },
  { c: 'Resultado', p: 'O que é margem de contribuição?', k: 'contribuição mc porcentagem',
    r: 'É o que sobra da receita depois dos custos que variam com a venda (insumo, embalagem, taxas e DAS). Em porcentagem, mostra quanto de cada R$ 100 vendidos sobra para as despesas fixas e o pró-labore. A referência do plano é 50% ou mais.' },
  { c: 'Resultado', p: 'O que é ponto de equilíbrio?', k: 'equilíbrio empatar mínimo vender',
    r: 'É a receita mínima do mês para cobrir as despesas fixas e o pró-labore. Conta: (despesas fixas + pró-labore) ÷ margem de contribuição %. Abaixo disso, o mês fecha no negativo.' },
  { c: 'Resultado', p: 'O que é o pró-labore e o rateio de gás e energia?', k: 'pró-labore salário raquel rateio gás luz energia config',
    r: 'Pró-labore é a retirada mensal da Raquel pelo trabalho, tratada como custo do negócio. Rateio de gás e energia é a parte da conta da casa atribuída à produção. Os dois ficam na aba Config (prolabore_mensal e rateio_gas_energia). Se a despesa lançada de gás e energia for menor que o rateio, a DRE usa o rateio.' },
  { c: 'Resultado', p: 'O que é o "% do limite do MEI"?', k: 'mei limite faturamento anual imposto das',
    r: 'É quanto do faturamento máximo anual do MEI já foi usado no ano. A partir de 80%, o app sinaliza atenção. Temas de imposto e formalização (MEI, ME) são decididos com o André, da Mathias Contabilidade.' },
  { c: 'Semana', p: 'Como fecho a semana e por que isso importa?', k: 'fechar semana sexta sobra quebra fechamento',
    r: 'Na sexta, toque no + e em "Fechar a semana". Informe as unidades produzidas, a sobra e a quebra e anote o que faltou ou sobrou. Leva 2 minutos. A tela também mostra quanto foi lançado na produção da semana. O custo da semana vem das fichas técnicas dos itens vendidos, não das compras. Horas não são mais registradas.' },
  { c: 'Semana', p: 'O que significam os indicadores da semana?', k: 'indicadores ticket médio canal sobra meta semana números massa',
    r: 'Receita contra a meta da semana. Ticket médio = receita ÷ pedidos (meta: R$ 85 ou mais). Sobra e quebra = unidades perdidas ÷ produzidas (meta: menos de 5%). Maior canal = peso do canal que mais vendeu (meta: até 60%, para não depender de um só). Pix pendente (meta: zero). Produção no estoque (atenção quando um produto fica sem livres). No mês, também a perda na contagem da produção (meta: menos de 5%).' },
  { c: 'Semana', p: 'O que são clientes ativos e recompra?', k: 'clientes ativos recompra retenção 60 dias',
    r: 'Cliente ativa = comprou nos últimos 60 dias. Recompra = das clientes do mês anterior, quantas compraram de novo neste mês (meta: acima de 35%). É o melhor sinal de que o produto e o atendimento estão funcionando.' },
  { c: 'Plano', p: 'Como funciona a aba Plano?', k: 'plano tarefas mês marco roteiro',
    r: 'Mostra todas as tarefas de outubro a abril, por mês e semana, com o foco e a meta de cada mês. Toque numa tarefa para ver por que ela é importante, onde se encaixa no plano e o próximo marco. Pelo círculo à esquerda você marca como feita. O botão "Plano completo (PDF)" abre o documento inteiro.' },
  { c: 'Plano', p: 'Como incluo ou edito uma tarefa?', k: 'nova tarefa editar excluir mudar data responsável',
    r: 'Para incluir: + › Tarefa, ou "+ Tarefa" na aba Plano. Escreva também o porquê: quem for fazer entende o motivo. Para editar: toque na tarefa e em Editar (texto, data, responsável e porquê). Tarefas do plano também podem ser excluídas por lá.' },
  { c: 'Plano', p: 'O que é o plano de ação?', k: 'ação plano de ação problema reunião indicador',
    r: 'São ações criadas nas reuniões para resolver um problema visto nos números. Cada uma tem responsável, prazo, indicador e impacto esperado. Aparecem na tela Hoje de quem é responsável e em Gestão › Ações.' },
  { c: 'Gestão', p: 'Como funcionam as reuniões semanal e mensal?', k: 'reunião pauta semanal mensal gestão',
    r: 'Em Gestão › Reunião, o app monta a pauta com os números do período. Registre o que foi decidido e crie ações. Semanal: 15 minutos na sexta. Mensal: fecha o mês, confere metas e decide ajustes de cardápio e preço.' },
  { c: 'App', p: 'Que e-mails e avisos o app manda?', k: 'email e-mail aviso notificação diário domingo segunda massa',
    r: 'Domingo às 18h: painel da semana por e-mail. No celular (sino no topo): bom dia às 7h com tarefas, retiradas, Pix pendente e produção baixa; véspera das encomendas às 18h; Pix pendente; sugestão de produção na segunda às 7h quando algum produto está abaixo do mínimo de livres; contagem do fim do mês. A lista de produção de terça saiu. O calendário do iPhone não muda sozinho com o app.' },
  { c: 'App', p: 'O que é o selo da RM e onde ele aparece?', k: 'marca logo selo rendado identidade fornada carimbo',
    r: 'O selo é o RM dentro do papel rendado, ao lado de "Confeitaria Artesanal". Aparece no app, nos e-mails, na etiqueta, no avatar do Instagram e no carimbo de uma cor da caixa. Abaixo de 32 px na tela ou 1,5 cm no papel o RM fica ilegível, então não use menor que isso. O carimbo numerado "Fornada nº" saiu da marca em 03/10/2026.' },
  { c: 'App', p: 'Como troco de pessoa ou de PIN?', k: 'pin senha trocar pessoa bruno raquel',
    r: 'No fim da tela Hoje, toque em "Não é você? Trocar de pessoa". O PIN fica na aba Config da planilha (linha pin); ao trocar lá, o app pede o novo PIN.' }
];

function getAjuda(pin) {
  checkPin_(pin);
  return { faq: AJUDA_FAQ, ia: iaChave_() ? true : false };
}

/* ---------------- Ajuda: assistente de IA (opcional) ----------------
 * Ativar: no editor do Apps Script › Configurações do projeto › Propriedades do script › adicionar
 * ANTHROPIC_API_KEY = chave criada em console.anthropic.com (cobrança por uso).
 * Limite diário de perguntas: chave ia_limite_dia na aba Config (padrão 40). */
var IA_MODELO = 'claude-haiku-4-5-20251001';

function iaChave_() {
  try { return PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') || ''; } catch (e) { return ''; }
}

function manualIA_() {
  var linhas = [];
  linhas.push('Você é a assistente de ajuda do app de gestão da RM Confeitaria Artesanal (cookies, bolos caseirinhos e doces de Raquel Miranda, Fortaleza/CE; sócio e gestor: Bruno).');
  linhas.push('Quem pergunta é a Raquel ou o Bruno, pelo celular. Explique como usar o app e a lógica de custos, despesas, margem e resultado.');
  linhas.push('Regras: responda em português do Brasil, direto e curto (até 150 palavras). Use passos numerados quando for um "como faço". Use os nomes exatos dos botões e abas. Não use markdown além de **negrito** e listas com "- " ou "1.". Não invente números nem funções que não estão no manual; se não souber, diga que não sabe e sugira falar com o Bruno. Assuntos de imposto e formalização: indique o André (Mathias Contabilidade). Se a pergunta não tiver relação com a RM ou com o app, responda em uma frase que só ajuda com o app e o negócio.');
  linhas.push('\n# Como o negócio funciona');
  linhas.push('- Produção só da Raquel, em casa.');
  linhas.push('- Modelo (decisão 36, 22/10/2026): cookie é pronta-entrega. A Raquel faz a massa em lote, porciona em bolinhas cruas e congela, e lança como produção (aba Producao); assa conforme a venda, de quarta a sábado ou em qualquer dia. Pedido em aberto reserva; pedido retirado baixa do estoque; livres = no estoque − em pedidos. Bolo caseirinho é sob encomenda, com pelo menos 2 dias de antecedência. Pudim está fora do cardápio por ora.');
  linhas.push('- Não existe prazo semanal de pedido nem janela fixa de retirada: data e hora são combinadas por pedido. Encomenda: Pix antecipado. Pronta-entrega: o Pix pode ficar para a retirada. Motoboy contratado pela cliente. Pedido mínimo R$ 45.');
  linhas.push('- Portfólio: cookies (por sabor e em caixas), bolo caseirinho (médio e pequeno), kits e assinatura. Não faz bolo de festa, pasta americana nem encomenda personalizada.');
  linhas.push('- Metas: R$ 5 mil/mês em 6 meses (março/27) e R$ 10 mil/mês em 12 meses. Indicador de decisão do mix: margem de contribuição por produto (preço − custo da ficha). Não existe mais margem por hora nem registro de horas (decisão 37).');
  linhas.push('- Metas dos indicadores: ticket médio ≥ R$ ' + METAS.ticket + '; sobra e quebra < 5%; perda na contagem da produção < 5% do produzido no mês; maior canal ≤ 60%; insumo e embalagem perto de 50% da receita; margem de contribuição ≥ 50%; recompra > 35%.');
  linhas.push('- Clube da Raquel: a cada ' + CLUBE.mimoCada + ' pedidos, ' + CLUBE.mimo + '; frequente = ' + CLUBE.freqN + '+ pedidos em ' + CLUBE.freqDias + ' dias (recebe primeiro os sabores disponíveis e convite para assinatura).');
  linhas.push('- Pausa de 29/03 a 18/04/2027 (viagem). Marca: RM Confeitaria Artesanal, selo com o RM no papel rendado (sem carimbo numerado).');
  linhas.push('\n# Estrutura do app');
  linhas.push('- Abas de baixo: Hoje (resumo da semana, Produção, tarefas do dia, retiradas, Pix pendente, Clube), Pedidos (Em aberto e Entregues), botão + central (Registrar: Pedido, Produção, Despesa ou compra, Tarefa, Fechar a semana; em Mais: Contar o estoque), Mural, Gestão (Semana, Números, Gráficos, Reunião, Ações).');
  linhas.push('- Botão ? no topo: esta ajuda. Botão de atualizar no topo: recarrega os dados.');
  linhas.push('- Planilha "RM — Controle Operacional" no Google Drive guarda tudo. Abas principais: Pedidos, Clientes, Despesas, Insumos, Receitas, Fichas técnicas, Producao, Estoque, Semanal, Mensal, DRE, Tarefas, Acoes, Reunioes, Ajuda, Config.');
  linhas.push('\n# Produtos e custos atuais (da aba Fichas técnicas)');
  try {
    var f = fichas_();
    Object.keys(f).forEach(function (n) {
      var x = f[n];
      linhas.push('- ' + n + ': preço ' + brl_(x.preco) + (x.custo !== null ? '; custo por unidade ' + brl_(x.custo) + '; margem de contribuição por unidade ' + brl_(x.preco - x.custo) : '; custo ainda não calculado'));
    });
  } catch (e) { linhas.push('- (não foi possível ler as fichas técnicas agora)'); }
  linhas.push('\n# Perguntas frequentes (use como fonte principal)');
  AJUDA_FAQ.forEach(function (q) { linhas.push('P: ' + q.p + '\nR: ' + q.r); });
  return linhas.join('\n');
}

function perguntarAjuda(pin, pergunta, historico, pessoa) {
  checkPin_(pin);
  pergunta = String(pergunta || '').trim().slice(0, 600);
  if (!pergunta) throw new Error('Escreva a pergunta');
  var chave = iaChave_();
  if (!chave) return { semIA: true };
  var props = PropertiesService.getScriptProperties(), hoje = today_();
  var limite = Number(config_().ia_limite_dia) || 40;
  var uso = JSON.parse(props.getProperty('IA_USO') || '{}');
  if (uso.dia !== hoje) uso = { dia: hoje, n: 0 };
  if (uso.n >= limite) return { limite: true, texto: 'O limite de ' + limite + ' perguntas por dia foi atingido. As perguntas frequentes continuam disponíveis. O limite muda na aba Config (ia_limite_dia).' };
  var msgs = [];
  (historico || []).slice(-6).forEach(function (m) { if (m && m.t && (m.de === 'eu' || m.de === 'ia')) msgs.push({ role: m.de === 'eu' ? 'user' : 'assistant', content: String(m.t).slice(0, 1500) }); });
  while (msgs.length && msgs[0].role !== 'user') msgs.shift();
  msgs.push({ role: 'user', content: pergunta });
  var body = { model: String(config_().ia_modelo || IA_MODELO), max_tokens: 700,
    system: [{ type: 'text', text: manualIA_(), cache_control: { type: 'ephemeral' } }], messages: msgs };
  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' }, payload: JSON.stringify(body)
  });
  var code = res.getResponseCode(), js = {};
  try { js = JSON.parse(res.getContentText()); } catch (e) {}
  if (code !== 200) {
    Logger.log('IA ' + code + ': ' + res.getContentText().slice(0, 500));
    throw new Error(code === 401 ? 'Chave da IA inválida. Confira ANTHROPIC_API_KEY nas propriedades do script.' : 'A assistente não respondeu agora (erro ' + code + '). Tente de novo em instantes.');
  }
  var texto = (js.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
  uso.n++; props.setProperty('IA_USO', JSON.stringify(uso));
  logAjuda_(pessoa, pergunta, texto, 'IA');
  return { texto: texto || 'Não consegui responder. Tente escrever de outro jeito.', restantes: limite - uso.n };
}

// Registra as perguntas: mostra o que confunde e vira pergunta frequente nova
function logAjuda_(pessoa, pergunta, resposta, fonte) {
  try {
    var ss = ss_(), sh = ss.getSheetByName('Ajuda');
    if (!sh) {
      sh = ss.insertSheet('Ajuda');
      sh.getRange(1, 1, 1, 5).setValues([['Data', 'Pessoa', 'Pergunta', 'Resposta', 'Fonte']]).setFontWeight('bold').setBackground(MARCA.vinho).setFontColor('#FFFFFF');
      sh.setFrozenRows(1); sh.setColumnWidth(3, 320); sh.setColumnWidth(4, 520);
    }
    sh.appendRow([new Date(), pessoa || '', pergunta, String(resposta || '').slice(0, 3000), fonte]);
  } catch (e) { Logger.log('logAjuda_: ' + e.message); }
}

// Registro de pergunta respondida pelas perguntas frequentes (sem IA) — só para aprendizado
function registrarPergunta(pin, pergunta, pessoa) {
  checkPin_(pin);
  logAjuda_(pessoa, String(pergunta || '').slice(0, 600), '', 'Perguntas frequentes');
  return { ok: true };
}

/* ---------------- Mensagens do WhatsApp editáveis (30/09/2026) ----------------
 * Textos-modelo com campos entre chaves. O app preenche os campos com os dados do pedido.
 * Ficam na aba "Mensagens" (criada no primeiro salvamento). Sem linha na aba = texto original. */
var MENSAGENS = [
  { chave: 'confirmacao', titulo: 'Confirmação do pedido', onde: 'Aparece depois de salvar um pedido (botão "Confirmar no WhatsApp"). {pagamento} agradece o Pix recebido ou cobra com o valor e a chave.',
    campos: ['nome', 'itens', 'valor', 'pix', 'retirada', 'pagamento', 'cobranca', 'chave_pix'],
    padrao: 'Oi, {nome}! Pedido confirmado: {itens}. Total {valor}. Retirada {retirada}. {pagamento}' },
  { chave: 'confirmacao_pronta', titulo: 'Pronta-entrega: pedido separado', onde: 'Pedido de pronta-entrega: depois de salvar e no botão do WhatsApp do cartão (no lugar do lembrete). Com Pix pendente, {cobranca} traz o valor e a chave.',
    campos: ['nome', 'itens', 'valor', 'pix', 'retirada', 'cobranca', 'chave_pix'],
    padrao: 'Oi, {nome}! Seu pedido está separado: {itens}. Total {valor}. Retirada {retirada}. {cobranca}' },
  { chave: 'lembrete', titulo: 'Lembrete de retirada (encomendas)', onde: 'Botão do WhatsApp no cartão da encomenda em aberto. Com Pix pendente, {cobranca} traz o valor e a chave; com Pix recebido, fica vazio.',
    campos: ['nome', 'itens', 'valor', 'pix', 'retirada', 'cobranca', 'chave_pix'],
    padrao: 'Oi, {nome}! Seu pedido ({itens}) fica pronto {retirada}. {cobranca} Qualquer coisa, me avisa!' },
  { chave: 'posentrega', titulo: 'Depois da entrega (Pix recebido)', onde: 'Pedido retirado e pago: Pedidos › Entregues › toque no pedido › Mensagem no WhatsApp.',
    campos: ['nome', 'itens', 'valor'],
    padrao: 'Oi, {nome}! Tudo certo com o pedido? Quando quiser mais, me chama: tem cookie pronto para assar e bolo sob encomenda.' },
  { chave: 'posentrega_pix', titulo: 'Depois da entrega (Pix pendente)', onde: 'Pedido retirado sem o Pix: botão do WhatsApp no cartão (Hoje › Pix pendente) e em Pedidos › Entregues.',
    campos: ['nome', 'itens', 'valor', 'chave_pix'],
    padrao: 'Oi, {nome}! Tudo certo com o pedido? Vi aqui que o Pix de {valor} ainda não entrou. A chave é {chave_pix}. Obrigada!' },
  { chave: 'clube', titulo: 'Aviso antecipado do Clube', onde: 'Tela Hoje, aos sábados, na lista de clientes frequentes do Clube da Raquel.',
    campos: ['nome', 'pedidos'],
    padrao: 'Oi, {nome}! Como você é do Clube da Raquel, te aviso antes: tenho cookie de pronta-entrega e bolo sob encomenda (2 dias de antecedência). Quer que eu te mande os sabores?' }
];

function mensagensSalvas_() {
  var sh = ss_().getSheetByName('Mensagens'), out = {};
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { if (r[0] && String(r[1]).trim()) out[String(r[0]).trim()] = String(r[1]); });
  return out;
}
/* Mapa chave → texto em uso (vai no getBootstrap) */
function mensagensMapa_() {
  var s = {}; try { s = mensagensSalvas_(); } catch (e) { Logger.log('mensagensMapa_: ' + e.message); }
  var out = {}; MENSAGENS.forEach(function (m) { out[m.chave] = s[m.chave] || m.padrao; });
  return out;
}
function getMensagens(pin) {
  checkPin_(pin);
  var s = mensagensSalvas_();
  return MENSAGENS.map(function (m) { return { chave: m.chave, titulo: m.titulo, onde: m.onde, campos: m.campos, padrao: m.padrao, texto: s[m.chave] || m.padrao, editada: !!s[m.chave] }; });
}
function salvarMensagem(pin, chave, texto, pessoa) {
  checkPin_(pin);
  var m = MENSAGENS.filter(function (x) { return x.chave === chave; })[0];
  if (!m) throw new Error('Mensagem desconhecida');
  texto = String(texto || '').trim();
  if (texto.length > 1000) throw new Error('Texto longo demais (máximo 1.000 caracteres)');
  var ss = ss_(), sh = ss.getSheetByName('Mensagens');
  if (!sh) {
    sh = ss.insertSheet('Mensagens');
    sh.getRange(1, 1, 1, 4).setValues([['Chave', 'Texto', 'Atualizado em', 'Por']]).setFontWeight('bold').setBackground(MARCA.vinho).setFontColor('#FFFFFF');
    sh.setFrozenRows(1); sh.setColumnWidth(2, 520);
  }
  var n = Math.max(sh.getLastRow() - 1, 0), chaves = n ? sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]).trim(); }) : [];
  var i = chaves.indexOf(chave), valor = texto === m.padrao ? '' : texto;   // igual ao original = volta ao padrão
  var linha = [chave, valor, new Date(), pessoa || ''];
  if (i >= 0) sh.getRange(i + 2, 1, 1, 4).setValues([linha]); else sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setValues([linha]);
  return { ok: true, texto: valor || m.padrao, editada: !!valor };
}
