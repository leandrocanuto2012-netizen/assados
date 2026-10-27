// =====================================================
// SORVETERIA ERP — BACKEND COM SUPABASE
// Configure no Render (env vars):
//   SUPABASE_URL = https://seu-projeto.supabase.co
//   SUPABASE_KEY = sua chave anon (ou service_role para acesso total)
// As tabelas devem ser criadas executando sql/01-estrutura-completa.sql
// Se as env vars não estiverem definidas, usa arquivo local (data.json)
// =====================================================
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
let nodemailer, XLSX, docx;
try { nodemailer = require('nodemailer'); } catch(e) { console.log('nodemailer não instalado — email desativado'); }
try { XLSX = require('xlsx'); } catch(e) { console.log('xlsx não instalado — Excel desativado'); }
try { docx = require('docx'); } catch(e) { console.log('docx não instalado — Word desativado'); }

const app = express();
const PORT = process.env.PORT || 8080;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const USAR_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);

const supabase = USAR_SUPABASE ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rotas amigáveis (sem .html)
app.get('/', (req, res) => res.redirect('/dashboard.html'));
app.get('/dashboard', (req, res) => res.redirect('/dashboard.html'));
app.get('/site', (req, res) => res.redirect('/site.html'));
app.get('/painel', (req, res) => res.redirect('/dashboard.html'));
app.get('/loja', (req, res) => res.redirect('/site.html'));

// ===== STORE — Supabase (se configurado) ou arquivo local =====
let DB = {};
const TABELAS = ['unidades','funcionarios','produtos','clientes','fidelidade','fornecedores','caixas','tesouraria','vendas','comandas','contas','notas_fiscais','autorizacoes','ponto','ferias','holerites','documentos_rh','remessas','patrimonio','imoveis','eventos','fichas_tecnicas','ordens_servico','estoque','mov_estoque','pdv_emergencial','log_bloqueio','log_caixa','mov_caixa','logistica','frota','checklists_exec','pedidos_site','bot_config','bot_regras','ia_pedidos','receitas','acertos','abonos','transferencias','bot_log'];

async function loadDB() {
  if (USAR_SUPABASE) {
    console.log('🔌 Conectando ao Supabase:', SUPABASE_URL);
    DB = {};
    for (const tabela of TABELAS) {
      try {
        const { data, error } = await supabase.from(tabela).select('*');
        if (!error) DB[tabela] = data || [];
        else DB[tabela] = [];
      } catch(e) { DB[tabela] = []; }
    }
    try {
      const { data } = await supabase.from('controle_sistema').select('*').limit(1).single();
      DB.controle_sistema = data || { id:1, matriz_aberta:true, status_geral:'aberta', permite_pdv_emergencial:true, mensagem_aviso:'Sistema operando normalmente' };
    } catch(e) {
      DB.controle_sistema = { id:1, matriz_aberta:true, status_geral:'aberta', permite_pdv_emergencial:true, mensagem_aviso:'Sistema operando normalmente' };
    }
    console.log('✅ Supabase carregado —', Object.keys(DB).length, 'coleções');
  } else {
    try { if (fs.existsSync(DATA_FILE)) DB = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) { DB = {}; }
    if (!DB.unidades || !DB.unidades.length) seed();
  }
}

let salvando = false;
function saveDB() {
  if (!USAR_SUPABASE) { fs.writeFileSync(DATA_FILE, JSON.stringify(DB, null, 2)); return; }
  if (salvando) return;
  salvando = true;
  (async () => {
    try {
      for (const tabela of TABELAS) {
        const dados = DB[tabela] || [];
        if (dados.length) await supabase.from(tabela).upsert(dados, { onConflict: 'id' });
      }
      if (DB.controle_sistema) await supabase.from('controle_sistema').upsert(DB.controle_sistema, { onConflict: 'id' });
    } catch(e) { console.error('Erro ao salvar no Supabase:', e.message); }
    salvando = false;
  })();
}
function nextId(col) { DB[col] = DB[col] || []; return (DB[col].reduce((m, r) => Math.max(m, r.id || 0), 0)) + 1; }
function fmt(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','); }
function hoje() { return new Date().toISOString().slice(0, 10); }
function agora() { return new Date().toISOString(); }

// ===== SEED INICIAL =====
function seed() {
  DB.unidades = [
    { id: 1, nome: 'Matriz - Sede', tipo: 'matriz', e_matriz: true, regime_tributario: 'simples_nacional', ativo: true },
    { id: 2, nome: 'Filial - Centro', tipo: 'filial', e_matriz: false, regime_tributario: 'simples_nacional', ativo: true }
  ];
  DB.funcionarios = [
    { id: 1, matricula: 'SV-2026-0001', nome: 'Administrador Geral', cargo: 'Administrador', unidade_id: 1, unidade_tipo: 'matriz', role: 'admin', senha_hash: '123', status: 'ATIVO', salario_base: 5000, jornada_diaria: 8, data_admissao: '2024-01-15' },
    { id: 2, matricula: 'SV-2026-0002', nome: 'Maria Silva', cargo: 'Atendente', unidade_id: 2, unidade_tipo: 'filial', role: 'operador', senha_hash: '123', status: 'ATIVO', salario_base: 1600, jornada_diaria: 8, data_admissao: '2025-03-10' }
  ];
  DB.controle_sistema = { id: 1, matriz_aberta: true, status_geral: 'aberta', permite_pdv_emergencial: true, mensagem_aviso: 'Sistema operando normalmente', updated_at: agora() };
  DB.produtos = [
    { id: 1, sku: 'SOR-MOR', nome: 'Sorvete Morango 2L', categoria: 'Sorvetes', sabor: 'Morango', preco_venda: 45.90, preco_por_kg: 22.95, custo: 18, estoque_minimo: 20, producao_propria: true, status: 'ATIVO', unidade_id: 1 },
    { id: 2, sku: 'PIC-CHOC', nome: 'Picolé Chocolate', categoria: 'Picolés', sabor: 'Chocolate', preco_venda: 4.50, custo: 1.20, estoque_minimo: 100, producao_propria: true, status: 'ATIVO', unidade_id: 1 },
    { id: 3, sku: 'ACA-300', nome: 'Açaí 300ml', categoria: 'Açaí', sabor: 'Açaí com granola', preco_venda: 12.90, custo: 4.50, estoque_minimo: 30, producao_propria: true, status: 'ATIVO', unidade_id: 1 },
    { id: 4, sku: 'BEB-COLA', nome: 'Refrigerante Cola 350ml', categoria: 'Bebidas', preco_venda: 5.00, custo: 2.50, estoque_minimo: 48, producao_propria: false, status: 'ATIVO', unidade_id: 1 },
    { id: 5, sku: 'INS-LEITE', nome: 'Leite Integral 1L', categoria: 'Insumos', preco_venda: 6.50, custo: 4.80, estoque_minimo: 50, producao_propria: false, status: 'ATIVO', unidade_id: 1 }
  ];
  DB.clientes = [{ id: 1, nome: 'Cliente Balcão', cpf_cnpj: '', telefone: '', ativo: true, pontos_disponiveis: 0, valor_total_gasto: 0 }];
  DB.fidelidade = [{ id: 1, cliente_id: 1, pontos_total: 0, pontos_disponiveis: 0, valor_total_gasto: 0 }];
  DB.fornecedores = [{ id: 1, nome: 'Laticínios Bom Leite', cnpj: '00.000.000/0001-00', telefone: '(41) 3333-3333', categoria_fornecimento: 'Insumos', status: 'ATIVO' }];
  DB.caixas = [{ id: 1, nome: 'Caixa Principal', status: 'fechado', saldo_inicial: 0, saldo_atual: 0, unidade_id: 1, ativo: true }];
  DB.tesouraria = [];
  DB.vendas = []; DB.comandas = []; DB.contas = []; DB.notas_fiscais = []; DB.autorizacoes = [];
  DB.ponto = []; DB.ferias = []; DB.holerites = []; DB.documentos_rh = [];
  DB.remessas = []; DB.patrimonio = []; DB.imoveis = []; DB.eventos = [];
  DB.fichas_tecnicas = []; DB.ordens_servico = []; DB.estoque = []; DB.mov_estoque = [];
  DB.pdv_emergencial = []; DB.log_bloqueio = []; DB.log_caixa = []; DB.mov_caixa = [];
  DB.logistica = []; DB.frota = []; DB.checklists_exec = []; DB.pedidos_site = [];
  DB.bot_config = [{ nome: 'nome_bot', valor: 'SorveteBot' }, { nome: 'saudacao', valor: 'Olá! Bem-vindo à Sorveteria!' }];
  DB.bot_regras = [
    { id: 1, palavras_chave: 'sabor|sabores|sorvete', resposta: 'Temos os sabores: Morango, Chocolate, Baunilha, Açaí com granola e muito mais!' },
    { id: 2, palavras_chave: 'picole|picolé|picoles', resposta: 'Nossos picolés são R$ 4,50 cada — chocolate, morango, uva e limão!' },
    { id: 3, palavras_chave: 'preco|preço|valor|quanto', resposta: 'Sorvete 2L R$ 45,90 | Açaí 300ml R$ 12,90 | Picolé R$ 4,50 | Refrigerante R$ 5,00' },
    { id: 4, palavras_chave: 'horario|horário|abre|fecha|funcionamento', resposta: 'Funcionamos de segunda a domingo, das 10h às 22h!' },
    { id: 5, palavras_chave: 'evento|festa|aniversario|empresa', resposta: 'Fazemos eventos e festas! Envie data, quantidade de pessoas e local que enviamos o orçamento.' },
    { id: 6, palavras_chave: 'ifood|delivery|entrega|entregador', resposta: 'Estamos no iFood! Ou se preferir, fazemos entrega própria — informe seu endereço.' }
  ];
  DB.ia_pedidos = [];
  saveDB();
}

// ===== MIDDLEWARE: verifica estado do sistema (Matriz aberta?) =====
function verificarEstado(req, res, next) {
  const body = req.body || {};
  const unidadeId = body.unidade_id || 1;
  const modulo = req.path.split('/')[2] || 'geral';
  const cs = DB.controle_sistema;
  const unidade = (DB.unidades || []).find(u => u.id == unidadeId);
  // Matriz sempre liberada
  if (unidade && unidade.e_matriz) return next();
  // Matriz aberta → tudo liberado
  if (cs.matriz_aberta) return next();
  // Matriz fechada → só PDV emergencial e ponto
  const permitidos = ['pdv-emergencial', 'rh'];
  if (cs.permite_pdv_emergencial && permitidos.some(p => req.path.includes(p))) return next();
  // Bloqueia
  DB.log_bloqueio.push({ id: nextId('log_bloqueio'), unidade_id: unidadeId, funcionario_id: body.funcionario_id || null, modulo_tentado: modulo, data_tentativa: agora(), mensagem_retorno: cs.mensagem_aviso });
  saveDB();
  return res.json({ erro: cs.mensagem_aviso || 'Matriz fechada', codigo: 'MATRIZ_FECHADA', liberado: false });
}

// ===== AUTH =====
app.post('/api/login', (req, res) => {
  const { matricula, senha } = req.body;
  const f = (DB.funcionarios || []).find(x => x.matricula === matricula && x.senha_hash === senha);
  if (!f) return res.json({ erro: 'Matrícula ou senha inválidos' });
  res.json({ sucesso: true, token: 'tok-' + f.id, funcionario: f, unidade: (DB.unidades || []).find(u => u.id === f.unidade_id) });
});

// ===== DASHBOARD =====
app.get('/api/dashboard/resumo', (req, res) => {
  const vendasHoje = (DB.vendas || []).filter(v => (v.data || '').slice(0, 10) === hoje());
  const totalHoje = vendasHoje.reduce((s, v) => s + Number(v.total || 0), 0);
  const vendasMes = (DB.vendas || []).filter(v => (v.data || '').slice(0, 7) === hoje().slice(0, 7));
  const totalMes = vendasMes.reduce((s, v) => s + Number(v.total || 0), 0);
  const picoles = vendasHoje.flatMap(v => v.itens || []).filter(i => (i.produto_nome || '').toLowerCase().includes('picolé')).reduce((s, i) => s + Number(i.qty || 0), 0);
  const receber = (DB.contas || []).filter(c => c.tipo === 'RECEBER' && c.status === 'ABERTO' && c.vencimento <= hoje()).reduce((s, c) => s + Number(c.valor || 0), 0);
  const pagar = (DB.contas || []).filter(c => c.tipo === 'PAGAR' && c.status === 'ABERTO' && c.vencimento <= hoje()).reduce((s, c) => s + Number(c.valor || 0), 0);
  const vendas7d = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    vendas7d.push({ dia: ds, valor: (DB.vendas || []).filter(v => (v.data || '').slice(0, 10) === ds).reduce((s, v) => s + Number(v.total || 0), 0) });
  }
  res.json({ saldo_bancos: 5000, receber_hoje: receber, pagar_hoje: pagar, vendas_hoje: totalHoje, vendas_mes: totalMes, picoles_hoje: picoles, vendas_7d: vendas7d });
});

app.get('/api/gerente/alertas', (req, res) => {
  const alertas = [];
  const estoqueBaixo = (DB.estoque || []).filter(e => Number(e.qty || 0) < Number(e.estoque_minimo || 20));
  if (estoqueBaixo.length) alertas.push({ nivel: 'critico', mensagem: `${estoqueBaixo.length} produto(s) com estoque baixo` });
  const contasVencidas = (DB.contas || []).filter(c => c.status === 'ABERTO' && c.vencimento < hoje());
  if (contasVencidas.length) alertas.push({ nivel: 'alerta', mensagem: `${contasVencidas.length} conta(s) vencida(s)` });
  const emergPend = (DB.pdv_emergencial || []).filter(p => !p.sincronizado);
  if (emergPend.length) alertas.push({ nivel: 'alerta', mensagem: `${emergPend.length} registro(s) emergencial(is) pendente(s) de sincronização` });
  const pontoIncompleto = (DB.ponto || []).filter(p => p.situacao === 'incompleto');
  if (pontoIncompleto.length) alertas.push({ nivel: 'alerta', mensagem: `${pontoIncompleto.length} ponto(s) incompleto(s)` });
  res.json({ alertas });
});

// ===== CONTROLE SISTEMA (Matriz) =====
app.get('/api/controle-sistema/estado', (req, res) => res.json({ ...DB.controle_sistema }));
app.post('/api/controle-sistema/abrir', (req, res) => {
  const { unidade_id, mensagem_aviso } = req.body;
  const unidade = (DB.unidades || []).find(u => u.id == unidade_id);
  if (!unidade || !unidade.e_matriz) return res.json({ erro: 'Apenas Matriz pode abrir o sistema' });
  DB.controle_sistema = { ...DB.controle_sistema, matriz_aberta: true, status_geral: 'aberta', data_abertura: agora(), aberta_por: req.body.funcionario_id || 1, mensagem_aviso: mensagem_aviso || 'Sistema operando normalmente', updated_at: agora() };
  saveDB();
  res.json({ sucesso: true, mensagem: 'Sistema aberto! Filiais liberadas.' });
});
app.post('/api/controle-sistema/fechar', (req, res) => {
  const { unidade_id, mensagem_aviso } = req.body;
  const unidade = (DB.unidades || []).find(u => u.id == unidade_id);
  if (!unidade || !unidade.e_matriz) return res.json({ erro: 'Apenas Matriz pode fechar o sistema' });
  DB.controle_sistema = { ...DB.controle_sistema, matriz_aberta: false, status_geral: 'fechada', data_fechamento: agora(), fechada_por: req.body.funcionario_id || 1, mensagem_aviso: mensagem_aviso || 'Matriz fechada — aguarde reabertura', updated_at: agora() };
  saveDB();
  res.json({ sucesso: true, mensagem: 'Sistema fechado! Filiais bloqueadas.' });
});
app.post('/api/controle-sistema/mensagem', (req, res) => {
  DB.controle_sistema.mensagem_aviso = req.body.mensagem_aviso;
  DB.controle_sistema.updated_at = agora();
  saveDB();
  res.json({ sucesso: true });
});
app.get('/api/controle-sistema/log-bloqueios', (req, res) => {
  const logs = (DB.log_bloqueio || []).slice(-50).reverse().map(l => ({ ...l, unidade_nome: ((DB.unidades || []).find(u => u.id === l.unidade_id) || {}).nome }));
  res.json({ logs });
});

// ===== PDV EMERGENCIAL =====
app.get('/api/pdv-emergencial/pendentes', (req, res) => {
  const registros = (DB.pdv_emergencial || []).slice(-50).reverse().map(r => ({ ...r, unidade_nome: ((DB.unidades || []).find(u => u.id === r.unidade_id) || {}).nome }));
  res.json({ total: registros.filter(r => !r.sincronizado).length, registros });
});
app.post('/api/pdv-emergencial/registrar', (req, res) => {
  const codigo = 'EMERG-' + hoje().replace(/-/g, '') + '-' + String((DB.pdv_emergencial || []).length + 1).padStart(3, '0');
  const reg = { id: nextId('pdv_emergencial'), codigo, unidade_id: req.body.unidade_id || 2, funcionario_id: req.body.funcionario_id || 2, tipo_registro: 'venda', dados_json: req.body, valor_total: req.body.valor_total || 0, sincronizado: false, created_at: agora() };
  DB.pdv_emergencial.push(reg);
  saveDB();
  res.json({ sucesso: true, codigo, registro: reg });
});
app.post('/api/pdv-emergencial/sincronizar', (req, res) => {
  let sincronizados = 0;
  (DB.pdv_emergencial || []).filter(p => !p.sincronizado).forEach(p => {
    const dados = p.dados_json || {};
    DB.vendas.push({ id: nextId('vendas'), data: p.created_at, cliente_nome: dados.cliente_nome || 'Emergencial', forma_pagamento: dados.forma_pagamento || 'DINHEIRO', origem: 'emergencial', total: p.valor_total, itens: dados.itens || [], status: 'CONCLUIDA', operador_matricula: 'EMERG', observacao: 'Sincronizado de ' + p.codigo });
    p.sincronizado = true; p.sincronizado_em = agora(); p.sincronizado_por = req.body.funcionario_id || 1;
    sincronizados++;
  });
  saveDB();
  res.json({ sucesso: true, sincronizados });
});

// ===== UNIDADES =====
app.get('/api/unidades', (req, res) => res.json({ unidades: DB.unidades || [] }));

// ===== CAIXA / PDV =====
app.get('/api/caixa/status-online', (req, res) => {
  const abertos = (DB.caixas || []).filter(c => c.status === 'aberto');
  const saldo = abertos.reduce((s, c) => s + Number(c.saldo_atual || 0), 0);
  const autPend = (DB.autorizacoes || []).filter(a => a.status === 'pendente').length;
  res.json({ caixas_abertos: abertos, saldo_atual: saldo, autorizacoes_pendentes: autPend });
});
app.post('/api/caixa/abrir', verificarEstado, (req, res) => {
  const tesAberta = (DB.tesouraria || []).some(t => t.status === 'aberta' && t.data === hoje());
  if (!tesAberta) return res.json({ erro: 'Tesouraria fechada! Abra a tesouraria primeiro.' });
  const cx = (DB.caixas || [])[0];
  cx.status = 'aberto'; cx.saldo_inicial = req.body.fundo_inicial || 0; cx.saldo_atual = req.body.fundo_inicial || 0;
  cx.aberta_por = req.body.funcionario_id || 1; cx.aberta_em = agora();
  DB.log_caixa.push({ id: nextId('log_caixa'), evento: 'ABERTURA_CAIXA', matricula: req.body.matricula || '-', created_at: agora() });
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/caixa/fechar', verificarEstado, (req, res) => {
  const cx = (DB.caixas || []).find(c => c.id == req.body.caixa_id) || (DB.caixas || [])[0];
  cx.status = 'fechado'; cx.fechada_por = req.body.funcionario_id || 1; cx.fechada_em = agora();
  DB.log_caixa.push({ id: nextId('log_caixa'), evento: 'FECHAMENTO_CAIXA', matricula: req.body.matricula || '-', created_at: agora() });
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/caixa/movimento', verificarEstado, (req, res) => {
  const { tipo, valor, descricao } = req.body;
  const cx = (DB.caixas || []).find(c => c.status === 'aberto');
  if (!cx) return res.json({ erro: 'Nenhum caixa aberto' });
  const precisaAut = ['REMESSA', 'RECOLHIMENTO', 'SANGRIA'].includes(tipo);
  if (precisaAut && !req.body.senha_adm) {
    const aut = { id: nextId('autorizacoes'), codigo: 'AUT-' + Date.now(), tipo_acao: tipo.toLowerCase(), solicitante_id: req.body.funcionario_id || 2, dados_acao: { valor, descricao }, status: 'pendente', data_solicitacao: agora() };
    DB.autorizacoes.push(aut); saveDB();
    return res.json({ autorizacao_pendente: true, autorizacao_id: aut.id });
  }
  cx.saldo_atual = Number(cx.saldo_atual) + (['ENTRADA', 'SUPRIMENTO'].includes(tipo) ? Number(valor) : -Number(valor));
  DB.mov_caixa.push({ id: nextId('mov_caixa'), tipo, valor, descricao, origem: 'caixa', created_at: agora(), responsavel: req.body.matricula || '-' });
  saveDB();
  res.json({ sucesso: true });
});
app.get('/api/caixa/movimentos', (req, res) => res.json({ movimentos: (DB.mov_caixa || []).slice(-50).reverse() }));
app.get('/api/log-caixa', (req, res) => res.json({ log: (DB.log_caixa || []).slice(-100).reverse() }));

// ===== VENDAS =====
app.post('/api/venda/criar', verificarEstado, (req, res) => {
  const { itens, forma_pagamento, comanda_id, cliente_nome } = req.body;
  const total = (itens || []).reduce((s, i) => s + Number(i.total || 0), 0);
  const venda = { id: nextId('vendas'), data: agora(), cliente_nome: cliente_nome || 'Balcão', forma_pagamento, origem: comanda_id ? 'comanda' : 'balcao', total, itens, status: 'CONCLUIDA', operador_matricula: req.body.matricula || '-', comanda_id };
  DB.vendas.push(venda);
  // Baixa estoque
  (itens || []).forEach(i => {
    const est = (DB.estoque || []).find(e => e.produto_id == i.product_id);
    if (est) est.qty = Math.max(0, Number(est.qty) - Number(i.qty || 1));
  });
  // Crédito no caixa
  const cx = (DB.caixas || []).find(c => c.status === 'aberto');
  if (cx) cx.saldo_atual = Number(cx.saldo_atual) + total;
  // Fidelidade
  const cli = (DB.clientes || []).find(c => c.nome === cliente_nome);
  if (cli) {
    const fid = (DB.fidelidade || []).find(f => f.cliente_id === cli.id);
    if (fid) { const pts = Math.flo