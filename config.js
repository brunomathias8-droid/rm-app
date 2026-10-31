/*
 * Configuração do app RM. Só a linha "api" importa. Desde 31/10/2026 é a função "api" do banco (Supabase, repositório rm-gestao).
 * Para voltar ao Apps Script: rodar ponteVoltar no editor e pôr aqui o endereço /exec antigo:
 *   https://script.google.com/macros/s/AKfycbyxITYpiNBeu2QJJM1W5DnS2K1jaeLe9R2ti5_VgkLLgBsAtMOzicA993TuwhM6MBbdzA/exec
 * Antes: endereço /exec da implantação do Apps Script
 * (o mesmo do app antigo, em Config › app_url da planilha). Ele só muda se alguém criar uma implantação NOVA;
 * publicar "Nova versão" na implantação existente mantém o endereço.
 */
window.RM_CONFIG = {
  api: 'https://mgmmawcdgisekivlfviw.supabase.co/functions/v1/api'
};
