'use strict';
// Router dos módulos novos. Integração segura: injete authenticate e authorize
// já ligados ao mecanismo real de sessão/perfis do ERP. Não aceita token inventado.
const express = require('express');
const impostos = require('./impostos-estimador');

module.exports = function createGestaoRouter({ supabase, authenticate, authorize }) {
  if (!supabase) throw new Error('Supabase obrigatório para os módulos de gestão.');
  if (typeof authenticate !== 'function' || typeof authorize !== 'function') {
    throw new Error('Informe authenticate e authorize reais do ERP antes de ativar as rotas.');
  }
  const router = express.Router();
  router.use(authenticate);
  const can = (moduleName, action='consultar') => authorize(moduleName, action);
  const userId = req => String(req.user.id ?? req.user.matricula ?? '');
  const unitId = req => Number(req.user.unidade_id);
  const fail = (res, error, status=400) => res.status(status).json({ sucesso:false, erro: error });
  const audit = async (req, modulo, acao, registroId, detalhes={}) => {
    await supabase.from('gestao_auditoria').insert({ unidade_id:unitId(req), usuario_id:userId(req), modulo, acao, registro_id:registroId ? String(registroId) : null, detalhes });
  };
  const scoped = (query, req) => query.eq('unidade_id', unitId(req));
  const validUnit = req => Number.isSafeInteger(unitId(req)) && unitId(req) > 0;

  router.get('/dashboard/meu-painel', can('dashboard_usuario'), async(req,res)=>{
    if(!validUnit(req)) return fail(res,'Usuário sem filial válida.',403);
    const {data,error}=await scoped(supabase.from('edras_movimentos').select('tipo,valor,status').eq('usuario_id',userId(req)),req);
    if(error) return fail(res,'Falha ao carregar painel do usuário.',500);
    const rows=data||[];
    res.json({sucesso:true,usuario:{id:userId(req),nome:req.user.nome||req.user.name||'Usuário',perfil:req.user.role||'operador',unidade_id:unitId(req)},edras:{receitas:rows.filter(x=>x.tipo==='receita').reduce((s,x)=>s+Number(x.valor),0),despesas:rows.filter(x=>x.tipo==='despesa').reduce((s,x)=>s+Number(x.valor),0),metas:rows.filter(x=>x.tipo==='meta').length,movimentos:rows.length}});
  });

  router.get('/dashboard/filiais', can('dashboard_filiais'), async (req,res) => {
    if (!validUnit(req)) return fail(res,'Usuário sem filial válida.',403);
    const matriz = req.user.unidade_tipo === 'matriz' || req.user.role === 'admin';
    let unidades = (req.unidadesPermitidas || []).map(Number);
    if (matriz && req.user.pode_ver_todas_filiais === true) {
      const { data, error } = await supabase.from('unidades').select('id,nome,tipo,ativo');
      if (error) return fail(res,'Falha ao consultar filiais.',500);
      unidades = (data||[]).filter(u=>u.ativo !== false).map(u=>Number(u.id));
    }
    if (!unidades.length) unidades=[unitId(req)];
    const { data, error } = await supabase.from('gestao_lancamentos_contabeis').select('unidade_id,tipo,valor,competencia,origem').in('unidade_id',unidades).eq('status','confirmado');
    if (error) return fail(res,'Falha ao consolidar indicadores.',500);
    // Integração com o site: pedidos online entram na receita por unidade (cada item tem sua unidade_id).
    const sitePorUnidade = {};
    try {
      const { data: pedSite } = await supabase.from('site_pedidos').select('id,status,itens').neq('status','CANCELADO');
      for (const p of (pedSite || [])) {
        for (const it of (Array.isArray(p.itens) ? p.itens : [])) {
          const uid = Number(it.unidade_id) || unitId(req);
          sitePorUnidade[uid] = (sitePorUnidade[uid] || 0) + Number(it.total || 0);
        }
      }
    } catch { /* tabela de pedidos do site ainda não aplicada: ignora */ }
    const resumo = unidades.map(id => {
      const rows=(data||[]).filter(x=>Number(x.unidade_id)===id && x.origem!=='site'); // lançamentos de origem 'site' já entram pelo agregado de pedidos do site
      const vendas_site = Number(sitePorUnidade[id] || 0);
      const receitas = rows.filter(x=>x.tipo==='receita').reduce((s,x)=>s+Number(x.valor),0) + vendas_site;
      const despesas = rows.filter(x=>x.tipo==='despesa').reduce((s,x)=>s+Number(x.valor),0);
      return { unidade_id:id, receitas, despesas, lancamentos:rows.length, vendas_site };
    });
    const total_geral = resumo.reduce((t,x)=>({receitas:t.receitas+x.receitas,despesas:t.despesas+x.despesas,lancamentos:t.lancamentos+x.lancamentos,vendas_site:t.vendas_site+x.vendas_site}),{receitas:0,despesas:0,lancamentos:0,vendas_site:0});
    res.json({ sucesso:true, unidades:resumo, total_geral });
  });

  router.get('/contabilidade/lancamentos', can('contabilidade'), async (req,res)=>{
    if(!validUnit(req)) return fail(res,'Filial inválida.',403);
    let q=supabase.from('gestao_lancamentos_contabeis').select('*').order('competencia',{ascending:false}).limit(500);
    if(req.query.unidade_id && req.user.pode_ver_todas_filiais===true) q=q.eq('unidade_id',Number(req.query.unidade_id)); else q=q.eq('unidade_id',unitId(req));
    if(req.query.competencia) q=q.eq('competencia',req.query.competencia);
    const {data,error}=await q; if(error) return fail(res,'Falha ao consultar lançamentos.',500); res.json({sucesso:true,itens:data||[]});
  });
  router.post('/contabilidade/lancamentos', can('contabilidade','criar'), async(req,res)=>{
    const b=req.body||{}; if(!validUnit(req)||!['receita','despesa','transferencia','ajuste'].includes(b.tipo)||!b.categoria||!b.descricao||!b.competencia||!Number.isFinite(Number(b.valor))||Number(b.valor)<0) return fail(res,'Preencha tipo, categoria, descrição, competência e valor válido.');
    const row={unidade_id:unitId(req),usuario_id:userId(req),tipo:b.tipo,categoria:String(b.categoria).slice(0,80),descricao:String(b.descricao).slice(0,240),competencia:b.competencia,data_lancamento:b.data_lancamento||new Date().toISOString().slice(0,10),valor:Number(b.valor),documento_ref:b.documento_ref||null,centro_custo:b.centro_custo||null,conta_financeira:b.conta_financeira||null,status:'rascunho'};
    const {data,error}=await supabase.from('gestao_lancamentos_contabeis').insert(row).select('*').single(); if(error) return fail(res,'Não foi possível criar lançamento.',500); await audit(req,'contabilidade','criar',data.id); res.status(201).json({sucesso:true,item:data});
  });
  router.patch('/contabilidade/lancamentos/:id/confirmar', can('contabilidade','confirmar'), async(req,res)=>{
    const {data,error}=await scoped(supabase.from('gestao_lancamentos_contabeis').update({status:'confirmado',atualizado_em:new Date().toISOString()}).eq('id',req.params.id).eq('status','rascunho'),req).select('*').maybeSingle();
    if(error) return fail(res,'Falha ao confirmar lançamento.',500); if(!data) return fail(res,'Lançamento não encontrado ou já processado.',404); await audit(req,'contabilidade','confirmar',data.id); res.json({sucesso:true,item:data});
  });

  // ===== ESTIMADOR DE IMPOSTOS (por filial; matriz ve todas) =====
  const mesAtualISO = () => new Date().toISOString().slice(0,7);
  const ehMatrizVendoTudo = req => (req.user.unidade_tipo === 'matriz' || String(req.user.role||'').toLowerCase() === 'admin');
  const num = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; };

  // Receita/despesa confirmadas de uma unidade no mes e nos ultimos 12 meses
  async function baseDaUnidade(uid, mes) {
    const { data, error } = await supabase.from('gestao_lancamentos_contabeis')
      .select('tipo,valor,competencia,status').eq('unidade_id', uid).eq('status','confirmado');
    if (error) throw new Error('Falha ao ler lançamentos.');
    const rows = data || [];
    const fim = new Date(mes + '-01T00:00:00Z');
    const ini = new Date(fim); ini.setUTCMonth(ini.getUTCMonth() - 11);
    const doMes = rows.filter(x => String(x.competencia).slice(0,7) === mes);
    const ult12 = rows.filter(x => { const d = new Date(String(x.competencia).slice(0,10) + 'T00:00:00Z'); return d >= ini && d <= new Date(fim.getTime() + 32*86400000); });
    const soma = (arr, t) => arr.filter(x => x.tipo === t).reduce((a, x) => a + Number(x.valor || 0), 0);
    return { receitaMes: soma(doMes,'receita'), despesasMes: soma(doMes,'despesa'), rbt12: soma(ult12,'receita') };
  }

  function entradaEstimador(b, base) {
    return {
      receitaMes: num(b.receita_mes) || base.receitaMes,
      rbt12: num(b.rbt12) || base.rbt12 || undefined,
      despesasMes: b.despesas_mes != null ? num(b.despesas_mes) : base.despesasMes,
      comprasMes: num(b.compras_mes),
      atividade: b.atividade || 'comercio',
      regimeAtual: ['simples','presumido','real'].includes(b.regime_atual) ? b.regime_atual : undefined,
      icmsPct: b.icms_pct != null ? num(b.icms_pct) : 18,
      issPct: b.iss_pct != null ? num(b.iss_pct) : 5,
      creditoIcmsPct: num(b.credito_icms_pct)
    };
  }

  // Estima impostos da PROPRIA unidade (ou de uma unidade que o usuario pode ver)
  router.post('/contabilidade/impostos/estimar', can('contabilidade'), async (req,res)=>{
    try {
      if (!validUnit(req)) return fail(res,'Usuário sem filial válida.',403);
      const b = req.body || {};
      let uid = unitId(req);
      if (b.unidade_id != null && Number(b.unidade_id) !== uid) {
        // so a matriz pode estimar outra unidade
        if (!ehMatrizVendoTudo(req) || req.user.pode_ver_todas_filiais !== true) return fail(res,'Você só pode estimar a sua própria filial.',403);
        uid = Number(b.unidade_id);
      }
      const mes = /^\d{4}-\d{2}$/.test(String(b.mes||'')) ? b.mes : mesAtualISO();
      const base = await baseDaUnidade(uid, mes);
      const entrada = entradaEstimador(b, base);
      if (!(entrada.receitaMes > 0)) return fail(res,'Sem receita confirmada neste mês. Informe a receita do mês ou confirme lançamentos.');
      const resultado = impostos.estimar(entrada);
      await audit(req,'contabilidade','estimar_impostos',uid,{ mes, melhor: resultado.melhor_regime });
      res.json({ sucesso:true, unidade_id:uid, mes, base_automatica: base, ...resultado });
    } catch (e) { return fail(res, e.message || 'Falha ao estimar impostos.', 400); }
  });

  // Matriz: estima TODAS as unidades e consolida. Filial comum recebe so a propria.
  router.post('/contabilidade/impostos/consolidado', can('contabilidade'), async (req,res)=>{
    try {
      if (!validUnit(req)) return fail(res,'Usuário sem filial válida.',403);
      const b = req.body || {};
      const mes = /^\d{4}-\d{2}$/.test(String(b.mes||'')) ? b.mes : mesAtualISO();
      let unidades = [unitId(req)];
      let nomes = {};
      if (ehMatrizVendoTudo(req) && req.user.pode_ver_todas_filiais === true) {
        const { data, error } = await supabase.from('unidades').select('id,nome,ativo');
        if (error) return fail(res,'Falha ao consultar filiais.',500);
        const ativas = (data||[]).filter(u => u.ativo !== false);
        unidades = ativas.map(u => Number(u.id)); ativas.forEach(u => nomes[Number(u.id)] = u.nome);
      }
      const itens = []; 
      for (const uid of unidades) {
        const base = await baseDaUnidade(uid, mes);
        const entrada = entradaEstimador(b, base);
        if (!(entrada.receitaMes > 0)) { itens.push({ unidade_id: uid, nome: nomes[uid] || null, sem_receita: true }); continue; }
        const r = impostos.estimar(entrada);
        itens.push({ unidade_id: uid, nome: nomes[uid] || null, receita_mes: entrada.receitaMes, melhor_regime: r.melhor_regime,
          totais: { simples: r.regimes.simples.total, presumido: r.regimes.presumido.total, real: r.regimes.real.total },
          aviso: r.aviso });
      }
      const soma = k => itens.reduce((t,i)=> t + (i.totais && i.totais[k] != null ? i.totais[k] : 0), 0);
      const consolidado = { receita_mes: itens.reduce((t,i)=>t+(i.receita_mes||0),0), simples: soma('simples'), presumido: soma('presumido'), real: soma('real'), unidades: itens.length };
      await audit(req,'contabilidade','estimar_impostos_consolidado',null,{ mes, unidades: itens.length });
      res.json({ sucesso:true, mes, visao: unidades.length > 1 ? 'matriz' : 'filial', itens, consolidado, avisos_legais: impostos.estimar({receitaMes:1,atividade:'comercio'}).avisos_legais });
    } catch (e) { return fail(res, e.message || 'Falha ao consolidar impostos.', 400); }
  });

  router.get('/edras/movimentos', can('edras'), async(req,res)=>{
    const {data,error}=await scoped(supabase.from('edras_movimentos').select('*').eq('usuario_id',userId(req)).order('data_referencia',{ascending:false}).limit(300),req);
    if(error) return fail(res,'Falha ao consultar seu planejamento financeiro.',500); res.json({sucesso:true,itens:data||[]});
  });
  router.post('/edras/movimentos', can('edras','criar'), async(req,res)=>{
    const b=req.body||{}; if(!['receita','despesa','meta','divida','reserva'].includes(b.tipo)||!b.descricao||!Number.isFinite(Number(b.valor))||Number(b.valor)<0) return fail(res,'Informe tipo, descrição e valor válido.');
    const row={unidade_id:unitId(req),usuario_id:userId(req),tipo:b.tipo,descricao:String(b.descricao).slice(0,200),categoria:String(b.categoria||'Geral').slice(0,80),valor:Number(b.valor),data_referencia:b.data_referencia||new Date().toISOString().slice(0,10),vencimento:b.vencimento||null,status:b.status==='realizado'?'realizado':'planejado',observacoes:b.observacoes||null};
    const {data,error}=await supabase.from('edras_movimentos').insert(row).select('*').single(); if(error) return fail(res,'Não foi possível salvar movimento.',500); await audit(req,'edras','criar',data.id); res.status(201).json({sucesso:true,item:data});
  });

  router.get('/juridico/processos', can('juridico'), async(req,res)=>{
    let q=supabase.from('juridico_processos').select('id,unidade_id,numero_processo,tipo,titulo,responsavel,status,nivel_sigilo,data_abertura,proximo_prazo').order('proximo_prazo',{ascending:true}).limit(300);
    q=q.eq('unidade_id',unitId(req)); const {data,error}=await q; if(error) return fail(res,'Falha ao consultar processos.',500); res.json({sucesso:true,itens:data||[]});
  });
  router.post('/juridico/processos', can('juridico','criar'), async(req,res)=>{
    const b=req.body||{}; if(!b.tipo||!b.titulo||!b.responsavel) return fail(res,'Informe tipo, título e responsável.');
    const row={unidade_id:unitId(req),tipo:String(b.tipo).slice(0,80),titulo:String(b.titulo).slice(0,240),numero_processo:b.numero_processo||null,parte_contraria:b.parte_contraria||null,responsavel:String(b.responsavel).slice(0,160),advogado:b.advogado||null,proximo_prazo:b.proximo_prazo||null,observacoes:b.observacoes||null,nivel_sigilo:b.nivel_sigilo==='confidencial'?'confidencial':'restrito',criado_por:userId(req)};
    const {data,error}=await supabase.from('juridico_processos').insert(row).select('id,unidade_id,tipo,titulo,responsavel,status,nivel_sigilo,data_abertura,proximo_prazo').single(); if(error) return fail(res,'Não foi possível registrar processo.',500); await audit(req,'juridico','criar_processo',data.id); res.status(201).json({sucesso:true,item:data});
  });
  router.post('/juridico/prazos', can('juridico','criar'), async(req,res)=>{
    const b=req.body||{}; if(!b.processo_id||!b.titulo||!b.data_prazo||!b.responsavel) return fail(res,'Informe processo, título, prazo e responsável.');
    const {data:proc,error:pe}=await scoped(supabase.from('juridico_processos').select('id').eq('id',b.processo_id),req).maybeSingle(); if(pe||!proc) return fail(res,'Processo não encontrado nesta filial.',404);
    const {data,error}=await supabase.from('juridico_prazos').insert({processo_id:b.processo_id,unidade_id:unitId(req),titulo:String(b.titulo).slice(0,200),data_prazo:b.data_prazo,responsavel:String(b.responsavel).slice(0,160),observacoes:b.observacoes||null}).select('*').single(); if(error) return fail(res,'Falha ao registrar prazo.',500); await audit(req,'juridico','criar_prazo',data.id); res.status(201).json({sucesso:true,item:data});
  });

  // Alterações controladas: somente rascunhos na contabilidade; EDRAS é privado por usuário.
  router.patch('/contabilidade/lancamentos/:id', can('contabilidade','editar'), async(req,res)=>{
    const b=req.body||{}; const patch={};
    for (const k of ['categoria','descricao','competencia','data_lancamento','documento_ref','centro_custo','conta_financeira']) if (b[k]!==undefined) patch[k]=b[k];
    if (b.valor!==undefined) { if(!Number.isFinite(Number(b.valor))||Number(b.valor)<0) return fail(res,'Valor inválido.'); patch.valor=Number(b.valor); }
    const {data,error}=await scoped(supabase.from('gestao_lancamentos_contabeis').update({...patch,atualizado_em:new Date().toISOString()}).eq('id',req.params.id).eq('status','rascunho'),req).select('*').maybeSingle();
    if(error) return fail(res,'Falha ao editar lançamento.',500); if(!data) return fail(res,'Somente rascunhos desta filial podem ser editados.',404); await audit(req,'contabilidade','editar',data.id); res.json({sucesso:true,item:data});
  });
  router.delete('/contabilidade/lancamentos/:id', can('contabilidade','excluir'), async(req,res)=>{
    const {data,error}=await scoped(supabase.from('gestao_lancamentos_contabeis').delete().eq('id',req.params.id).eq('status','rascunho'),req).select('id').maybeSingle();
    if(error) return fail(res,'Falha ao excluir lançamento.',500); if(!data) return fail(res,'Somente rascunhos desta filial podem ser excluídos.',404); await audit(req,'contabilidade','excluir',data.id); res.json({sucesso:true});
  });
  router.patch('/edras/movimentos/:id', can('edras','editar'), async(req,res)=>{
    const b=req.body||{}, patch={};
    for(const k of ['tipo','descricao','categoria','data_referencia','vencimento','status','observacoes']) if(b[k]!==undefined) patch[k]=b[k];
    if(b.valor!==undefined){if(!Number.isFinite(Number(b.valor))||Number(b.valor)<0)return fail(res,'Valor inválido.');patch.valor=Number(b.valor)}
    const {data,error}=await scoped(supabase.from('edras_movimentos').update({...patch,atualizado_em:new Date().toISOString()}).eq('id',req.params.id).eq('usuario_id',userId(req)),req).select('*').maybeSingle();
    if(error)return fail(res,'Falha ao editar movimento.',500);if(!data)return fail(res,'Movimento não encontrado para este usuário.',404);await audit(req,'edras','editar',data.id);res.json({sucesso:true,item:data});
  });
  router.delete('/edras/movimentos/:id', can('edras','excluir'), async(req,res)=>{
    const {data,error}=await scoped(supabase.from('edras_movimentos').delete().eq('id',req.params.id).eq('usuario_id',userId(req)),req).select('id').maybeSingle();
    if(error)return fail(res,'Falha ao excluir movimento.',500);if(!data)return fail(res,'Movimento não encontrado para este usuário.',404);await audit(req,'edras','excluir',data.id);res.json({sucesso:true});
  });
  router.patch('/juridico/processos/:id', can('juridico','editar'), async(req,res)=>{
    const b=req.body||{},patch={};
    for(const k of ['titulo','tipo','numero_processo','parte_contraria','responsavel','advogado','status','nivel_sigilo','proximo_prazo','observacoes']) if(b[k]!==undefined) patch[k]=b[k];
    const {data,error}=await scoped(supabase.from('juridico_processos').update({...patch,atualizado_em:new Date().toISOString()}).eq('id',req.params.id),req).select('id,unidade_id,numero_processo,tipo,titulo,responsavel,status,nivel_sigilo,data_abertura,proximo_prazo').maybeSingle();
    if(error)return fail(res,'Falha ao atualizar processo.',500);if(!data)return fail(res,'Processo não encontrado nesta filial.',404);await audit(req,'juridico','editar_processo',data.id);res.json({sucesso:true,item:data});
  });
  router.get('/juridico/prazos', can('juridico'), async(req,res)=>{
    const {data,error}=await scoped(supabase.from('juridico_prazos').select('*').order('data_prazo',{ascending:true}).limit(500),req);
    if(error)return fail(res,'Falha ao consultar prazos.',500);res.json({sucesso:true,itens:data||[]});
  });
  router.patch('/juridico/prazos/:id/concluir', can('juridico','editar'), async(req,res)=>{
    const {data,error}=await scoped(supabase.from('juridico_prazos').update({status:'concluido'}).eq('id',req.params.id).eq('status','pendente'),req).select('*').maybeSingle();
    if(error)return fail(res,'Falha ao concluir prazo.',500);if(!data)return fail(res,'Prazo não encontrado ou já concluído.',404);await audit(req,'juridico','concluir_prazo',data.id);res.json({sucesso:true,item:data});
  });

  return router;
};
