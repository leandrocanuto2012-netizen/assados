const express = require('express');
 const router = express.Router();
 const { supabase } = require('../server-supabase.js');
 const { verificarSessao } = require('../middleware/auth');
 // 🔒 Verificar Super Senha
 router.post('/super-login', async (req, res) => {
   try {
     const { chave_acesso } = req.body;
     
     const { data, error } = await supabase
       .from('super_administrador')
       .select('id_super, email, ativo')
       .eq('chave_acesso_especial', chave_acesso)
       .eq('ativo', true)
       .single();
     if (error || !data) {
       return res.status(403).json({ erro: 'Chave de acesso inválida' });
     }
     // Atualizar último acesso
     await supabase
       .from('super_administrador')
       .update({ ultimo_acesso: new Date().toISOString() })
       .eq('id_super', data.id_super);
     res.json({ sucesso: true, mensagem: 'Acesso liberado' });
   } catch (err) {
     res.status(500).json({ erro: err.message });
   }
 });
 // 📋 Logs de Auditoria
 router.get('/logs', verificarSessao, async (req, res) => {
   try {
     const periodo = req.query.periodo || '30';
     const dataInicio = new Date();
     dataInicio.setDate(dataInicio.getDate() - parseInt(periodo));
     const { data, error } = await supabase
       .from('logs_auditoria_governanca')
       .select('*')
       .gte('data_hora', dataInicio.toISOString())
       .order('data_hora', { ascending: false })
       .limit(100);
     if (error) throw error;
     res.json(data || []);
   } catch (err) {
     res.status(400).json({ erro: err.message });
   }
 });
 // 📊 Resumo da Governança
 router.get('/resumo', verificarSessao, async (req, res) => {
   try {
     const { data: criticas } = await supabase
       .from('logs_auditoria_governanca')
       .select('*', { count: 'exact' })
       .eq('gravidade', 'critica')
       .eq('resolvido', false);
     const { data: total, count: totalLogs } = await supabase
       .from('logs_auditoria_governanca')
       .select('*', { count: 'exact' });
     res.json({
       total_verificacoes: totalLogs || 0,
       criticas_pendentes: criticas?.length || 0
     });
   } catch (err) {
     res.json({ total_verificacoes: 0, criticas_pendentes: 0 });
   }
 });
 module.exports = router;
