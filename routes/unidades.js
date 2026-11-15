const express = require('express');
 const router = express.Router();
 const { supabase } = require('../server-supabase');
 const { verificarSessao } = require('../middleware/auth');
 // 📋 Listar Todas Unidades
 router.get('/', verificarSessao, async (req, res) => {
   try {
     const { data, error } = await supabase
       .from('unidades_negocio')
       .select('id_unidade, nome_fantasia, cidade, uf, aberta, ativa')
       .eq('ativa', true)
       .order('nome_fantasia');
     if (error) throw error;
     res.json(data);
   } catch (err) {
     res.status(400).json({ erro: err.message });
   }
 });
 // 🔍 Unidade Única
 router.get('/:id', verificarSessao, async (req, res) => {
   try {
     const { data, error } = await supabase
       .from('unidades_negocio')
       .select('*')
       .eq('id_unidade', req.params.id)
       .single();
     if (error) throw error;
     res.json(data);
   } catch (err) {
     res.status(400).json({ erro: err.message });
   }
 });
 // ⏰ Atualizar Horário de Funcionamento
 router.patch('/:id/horarios', verificarSessao, async (req, res) => {
   try {
     const { horario_abertura, horario_fechamento } = req.body;
     const { data, error } = await supabase
       .from('unidades_negocio')
       .update({ horario_abertura, horario_fechamento })
       .eq('id_unidade', req.params.id)
       .select()
       .single();
     if (error) throw error;
     res.json({ sucesso: true, unidade: data });
   } catch (err) {
     res.status(400).json({ erro: err.message });
   }
 });
 module.exports = router;
