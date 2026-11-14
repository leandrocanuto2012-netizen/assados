const express = require('express');
 const router = express.Router();
 const { supabase } = require('../supabase-client');
 const { verificarSessao, verificarUnidade } = require('../middleware/auth');
 // 📊 DRE Mensal
 router.get('/dre/:idUnidade/:mes', verificarSessao, verificarUnidade, async (req, res) => {
   try {
     const { idUnidade, mes } = req.params;
     const { data, error } = await supabase
       .from('dre_mensal')
       .select('*')
       .eq('id_unidade', idUnidade)
       .eq('mes_referencia', mes)
       .single();
     if (error) throw error;
     res.json(data);
   } catch (err) {
     res.status(400).json({ erro: err.message });
   }
 });
 // 📊 Comparativo de DRE — Todas Unidades (Matriz)
 router.get('/dre/comparativo/:mes', verificarSessao, async (req, res) => {
   try {
     const { mes } = req.params;
     const { data, error } = await supabase
       .from('vw_dre_resumido')
       .select('*')
       .eq('mes_referencia', mes)
       .order('receita_bruta_vendas', { ascending: false });
     if (error) throw error;
     res.json(data);
   } catch (err) {
     res.status(400).json({ erro: err.message });
   }
 });
 // 📋 Plano de Contas
 router.get('/plano-contas', verificarSessao, async (req, res) => {
   try {
     const { data, error } = await supabase
       .from('plano_contas')
       .select('*')
       .eq('ativa', true)
       .order('codigo');
     if (error) throw error;
     res.json(data);
   } catch (err) {
     res.status(400).json({ erro: err.message });
   }
 });
 // 📝 Lançar Contábil
 router.post('/lancamento', verificarSessao, verificarUnidade, async (req, res) => {
   try {
     const { data_lancamento, id_conta, tipo_lancamento, valor, historico, documento } = req.body;
     
     const { data, error } = await supabase
       .from('lancamentos_contabeis')
       .insert([{
         id_unidade: req.idUnidade,
         data_lancamento,
         id_conta,
         tipo_lancamento,
         valor,
         historico,
         documento_referencia: documento,
         id_usuario: req.usuario.id
       }])
       .select()
       .single();
     if (error) throw error;
     res.status(201).json({ sucesso: true, lancamento: data });
   } catch (err) {
     res.status(400).json({ erro: err.message });
   }
 });
 // ⚖️ Balanço Patrimonial
 router.get('/balanco/:idUnidade/:dataBase', verificarSessao, verificarUnidade, async (req, res) => {
   try {
     const { idUnidade, dataBase } = req.params;
     const { data, error } = await supabase
       .from('balanco_patrimonial')
       .select('*')
       .eq('id_unidade', idUnidade)
       .eq('data_base', dataBase)
       .maybeSingle();
     if (error) throw error;
     res.json(data || { mensagem: 'Balanço não encontrado para esta data' });
   } catch (err) {
     res.status(400).json({ erro: err.message });
   }
 });
 module.exports = router;
