const express = require('express');
 const router = express.Router();
 const { supabase } = require('../server-supabase.js');
 const { verificarSessao, verificarUnidade } = require('../middleware/auth');
 // 📈 Indicadores EDRAS — Único/Mês
 router.get('/indicadores/:idUnidade/:mes', verificarSessao, verificarUnidade, async (req, res) => {
   try {
     const { idUnidade, mes } = req.params;
     const { data, error } = await supabase
       .from('indicadores_edras')
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
 // 📊 Histórico de Indicadores
 router.get('/historico/:idUnidade', verificarSessao, verificarUnidade, async (req, res) => {
   try {
     const { idUnidade } = req.params;
     const limite = parseInt(req.query.limite) || 12;
     
     const { data, error } = await supabase
       .from('indicadores_edras')
       .select('mes_referencia, faturamento_mensal, lucro_liquido, roi_percentual, margem_liquida')
       .eq('id_unidade', idUnidade)
       .order('mes_referencia', { ascending: false })
       .limit(limite);
     if (error) throw error;
     res.json(data);
   } catch (err) {
     res.status(400).json({ erro: err.message });
   }
 });
 // 📊 Comparativo ROI — Todas Unidades
 router.get('/comparativo/roi', verificarSessao, async (req, res) => {
   try {
     const { data, error } = await supabase
       .from('vw_edras_desempenho')
       .select('*')
       .order('mes_referencia, roi_percentual', { ascending: false });
     if (error) throw error;
     res.json(data);
   } catch (err) {
     res.status(400).json({ erro: err.message });
   }
 });
 // ➕ Atualizar/Calcular Indicador
 router.post('/calcular', verificarSessao, verificarUnidade, async (req, res) => {
   try {
     const { mes_referencia, investimento_total, faturamento_mensal, custo_fixo, custo_variavel } = req.body;
     
     // Chamar função SQL de cálculo
     const { data: calculo, error: fnErr } = await supabase.rpc('fn_calcular_roi', {
       p_faturamento: faturamento_mensal,
       p_custo_fixo: custo_fixo,
       p_custo_variavel: custo_variavel,
       p_investimento: investimento_total
     });
     if (fnErr) throw fnErr;
     
     // Upsert: Atualiza ou cria
     const { data, error } = await supabase
       .from('indicadores_edras')
       .upsert([{
         id_unidade: req.idUnidade,
         mes_referencia,
         investimento_total,
         faturamento_mensal,
         custo_fixo,
         custo_variavel,
         lucro_liquido: calculo.lucro,
         roi_percentual: calculo.roi_percentual,
         payback_meses: calculo.payback_meses,
         margem_liquida: calculo.margem_liquida,
         ponto_equilibrio: calculo.ponto_equilibrio
       }])
       .select()
       .single();
     if (error) throw error;
     res.status(201).json({ sucesso: true, indicadores: data, calculo });
   } catch (err) {
     res.status(400).json({ erro: err.message });
   }
 });
 module.exports = router;
