
/*
 * ASSADOS NOBRE ERP
 * Compatibilidade do antigo servidor de login.
 *
 * O servidor oficial e a autenticação estão em
 * server-supabase.js.
 *
 * Este arquivo não cria servidor independente,
 * não mantém senha fixa e não duplica rotas.
 */

module.exports = function loginLegacyDisabled() {
  return null;
};
