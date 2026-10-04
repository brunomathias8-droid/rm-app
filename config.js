/*
 * Configuração do app RM. Só a linha "api" importa: é o endereço /exec da implantação do Apps Script
 * (o mesmo do app antigo, em Config › app_url da planilha). Ele só muda se alguém criar uma implantação NOVA;
 * publicar "Nova versão" na implantação existente mantém o endereço.
 */
window.RM_CONFIG = {
  api: 'https://script.google.com/macros/s/AKfycbxHVQAov_P3WBVnR59TphQBu0KCWPAk6EUEySdjGR0vBea_cYJ1HptomgYG0wX4uDc6aQ/exec'
};
