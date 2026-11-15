const { supabase } = require('../server-supabase.js');
  // MIDDLEWARE: VERIFICAR SESSÃO DO USUÁRIO
 const verificarSessao = async (req, res, next) => {
   const token = req.headers.authorization?.replace('Bearer ', '');
   
   if (!token) {
     return res.status(401).json({ erro: 'Token não fornecido' });
   }
   try {
     const { data: { user }, error } = await supabase.auth.getUser(token);
     
     if (error || !user) {
       return res.status(401).json({ erro: 'Sessão inválida ou expirada' });
     }
     req.usuario = user;
     next();
   } catch (err) {
     return res.status(500).json({ erro: 'Erro na verificação de sessão' });
   }
 };
 // Middleware: Verificar Acesso da Unidade
 const verificarUnidade = async (req, res, next) => {
   const idUnidade = req.headers['x-id-unidade'];
   
   if (!idUnidade) {
     return res.status(400).json({ erro: 'Unidade não informada' });
   }
   req.idUnidade = parseInt(idUnidade);
   next();
 };
 module.exports = { verificarSessao, verificarUnidade };
