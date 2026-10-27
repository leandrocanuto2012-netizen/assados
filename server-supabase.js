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
    if (fid) { const pts = Math.floor(total); fid.pontos_total += pts; fid.pontos_disponiveis += pts; fid.valor_total_gasto += total; cli.pontos_disponiveis = fid.pontos_disponiveis; cli.valor_total_gasto = fid.valor_total_gasto; }
  }
  saveDB();
  res.json({ sucesso: true, venda_id: venda.id, total });
});
app.post('/api/venda/estornar', (req, res) => {
  const v = (DB.vendas || []).find(x => x.id == req.body.venda_id);
  if (!v) return res.json({ erro: 'Venda não encontrada' });
  v.status = 'ESTORNADA'; v.motivo_estorno = req.body.motivo; v.estornada_em = agora();
  const cx = (DB.caixas || []).find(c => c.status === 'aberto');
  if (cx) cx.saldo_atual = Number(cx.saldo_atual) - Number(v.total);
  saveDB();
  res.json({ sucesso: true });
});
app.get('/api/venda/cupom', (req, res) => {
  const v = (DB.vendas || []).find(x => x.id == req.query.id);
  if (!v) return res.json({ erro: 'Não encontrada' });
  res.json({ venda: v, itens: v.itens || [] });
});
app.get('/api/vendas', (req, res) => res.json({ vendas: (DB.vendas || []).slice(-100).reverse() }));

// ===== PRODUTOS =====
app.get('/api/produtos', (req, res) => res.json({ produtos: DB.produtos || [] }));
app.post('/api/produtos/salvar', (req, res) => {
  const { id } = req.body;
  if (id) {
    const p = (DB.produtos || []).find(x => x.id == id);
    if (p) Object.assign(p, req.body);
  } else {
    DB.produtos.push({ id: nextId('produtos'), ...req.body, status: 'ATIVO' });
  }
  saveDB();
  res.json({ sucesso: true });
});

// ===== PRODUÇÃO / RECEITAS =====
app.get('/api/producao/receitas', (req, res) => {
  const recs = (DB.receitas || []).filter(r => r.produto_id == req.query.produto_id);
  res.json({ receitas: recs });
});
app.post('/api/producao/receita/salvar', (req, res) => {
  DB.receitas = DB.receitas || [];
  DB.receitas.push({ id: nextId('receitas'), ...req.body });
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/producao/receita/excluir', (req, res) => {
  DB.receitas = (DB.receitas || []).filter(r => r.id != req.body.id);
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/producao/simular', (req, res) => {
  const { produto_id, qtd } = req.body;
  const prod = (DB.produtos || []).find(p => p.id == produto_id);
  const recs = (DB.receitas || []).filter(r => r.produto_id == produto_id);
  const ingredientes = recs.map(r => {
    const est = (DB.estoque || []).find(e => e.produto_id == r.insumo_id);
    const necessario = Number(r.quantidade_por_unidade) * Number(qtd);
    const disponivel = est ? Number(est.qty) : 0;
    return { insumo: r.insumo_nome, necessario, disponivel, unidade: r.unidade || 'UN', suficiente: disponivel >= necessario };
  });
  const falta = ingredientes.some(i => !i.suficiente);
  res.json({ sucesso: !falta, falta_insumo: falta, ingredientes, qtd_produzir: qtd, produto: prod, mensagem: falta ? 'Falta insumo para produção' : 'Tudo disponível' });
});
app.post('/api/producao/confirmar', (req, res) => {
  const { produto_id, qtd } = req.body;
  const prod = (DB.produtos || []).find(p => p.id == produto_id);
  // Baixa insumos
  (DB.receitas || []).filter(r => r.produto_id == produto_id).forEach(r => {
    const est = (DB.estoque || []).find(e => e.produto_id == r.insumo_id);
    if (est) est.qty = Math.max(0, Number(est.qty) - Number(r.quantidade_por_unidade) * Number(qtd));
  });
  // Adiciona produto acabado ao estoque
  let est = (DB.estoque || []).find(e => e.produto_id == produto_id);
  if (!est) { est = { id: nextId('estoque'), produto_id, produto_nome: prod.nome, sku: prod.sku, qty: 0, valor_unitario: prod.custo, unidade_id: 1, lote: 'LOTE-' + hoje(), data_validade: null }; DB.estoque.push(est); }
  est.qty = Number(est.qty) + Number(qtd);
  saveDB();
  res.json({ sucesso: true, mensagem: `Produzidas ${qtd} unidades de ${prod.nome}! Estoque atualizado.` });
});

// ===== CLIENTES + FIDELIDADE =====
app.get('/api/clientes', (req, res) => res.json({ clientes: (DB.clientes || []).map(c => ({ ...c, pontos_disponiveis: ((DB.fidelidade || []).find(f => f.cliente_id === c.id) || {}).pontos_disponiveis || 0, valor_total_gasto: ((DB.fidelidade || []).find(f => f.cliente_id === c.id) || {}).valor_total_gasto || 0 })) }));
app.post('/api/clientes/salvar', (req, res) => {
  const c = { id: nextId('clientes'), ...req.body, ativo: true, data_cadastro: hoje() };
  DB.clientes.push(c);
  DB.fidelidade.push({ id: nextId('fidelidade'), cliente_id: c.id, pontos_total: 0, pontos_disponiveis: 0, pontos_resgatados: 0, valor_total_gasto: 0, atualizado_em: agora() });
  saveDB();
  res.json({ sucesso: true });
});
app.get('/api/fidelidade/:id', (req, res) => {
  const fid = (DB.fidelidade || []).find(f => f.cliente_id == req.params.id);
  res.json({ fidelidade: fid || { pontos_disponiveis: 0, pontos_total: 0, valor_total_gasto: 0 } });
});
app.post('/api/fidelidade/ajustar', (req, res) => {
  const fid = (DB.fidelidade || []).find(f => f.cliente_id == req.body.cliente_id);
  if (fid) { fid.pontos_disponiveis = Math.max(0, Number(fid.pontos_disponiveis) + Number(req.body.pontos)); fid.atualizado_em = agora(); }
  saveDB();
  res.json({ sucesso: true });
});

// ===== FORNECEDORES =====
app.get('/api/fornecedores', (req, res) => res.json({ fornecedores: DB.fornecedores || [] }));
app.post('/api/fornecedores/salvar', (req, res) => { DB.fornecedores.push({ id: nextId('fornecedores'), ...req.body, status: 'ATIVO' }); saveDB(); res.json({ sucesso: true }); });

// ===== FUNCIONÁRIOS =====
app.get('/api/funcionarios', (req, res) => res.json({ funcionarios: (DB.funcionarios || []).map(f => ({ ...f, unidade_nome: ((DB.unidades || []).find(u => u.id === f.unidade_id) || {}).nome })) }));
app.post('/api/funcionarios/salvar', (req, res) => { DB.funcionarios.push({ id: nextId('funcionarios'), ...req.body, status: 'ATIVO', data_admissao: hoje() }); saveDB(); res.json({ sucesso: true }); });

// ===== PATRIMÔNIO =====
app.get('/api/patrimonio', (req, res) => res.json({ bens: (DB.patrimonio || []).map(p => ({ ...p, unidade_nome: ((DB.unidades || []).find(u => u.id === p.localizacao_unidade_id) || {}).nome })) }));
app.post('/api/patrimonio/salvar', (req, res) => {
  const codigo = 'PAT-' + new Date().getFullYear() + '-' + String((DB.patrimonio || []).length + 1).padStart(5, '0');
  DB.patrimonio.push({ id: nextId('patrimonio'), codigo_etiqueta: codigo, ...req.body, status: 'ativo', condicao_atual: req.body.condicao_atual || 'bom', data_ultima_verificacao: hoje() });
  saveDB();
  res.json({ sucesso: true, codigo_etiqueta: codigo });
});
app.post('/api/patrimonio/transferir', (req, res) => {
  const bem = (DB.patrimonio || []).find(p => p.id == req.body.patrimonio_id);
  if (bem) {
    DB.transferencias = DB.transferencias || [];
    DB.transferencias.push({ id: nextId('transferencias'), patrimonio_id: bem.id, origem_unidade_id: bem.localizacao_unidade_id, destino_unidade_id: req.body.destino_unidade_id, motivo: req.body.motivo, data_saida: agora() });
    bem.localizacao_unidade_id = req.body.destino_unidade_id;
    bem.data_ultima_verificacao = hoje();
  }
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/patrimonio/checklist-mudanca', (req, res) => {
  const bens = (DB.patrimonio || []).filter(p => p.localizacao_unidade_id == req.body.unidade_id);
  const chk = { id: nextId('checklists_exec'), modelo_id: 3, referencia_externa_id: req.body.unidade_id, responsavel_execucao_id: req.body.funcionario_id || 1, unidade_id: req.body.unidade_id, status: 'incompleto', data_execucao: agora(), itens: bens.map(b => ({ texto: b.codigo_etiqueta + ' — ' + b.descricao, respondido: false })) };
  DB.checklists_exec.push(chk);
  saveDB();
  res.json({ sucesso: true, checklist_id: chk.id, totalItens: bens.length });
});

// ===== IMÓVEIS =====
app.get('/api/imoveis', (req, res) => res.json({ imoveis: (DB.imoveis || []).map(i => ({ ...i, unidade_nome: ((DB.unidades || []).find(u => u.id === i.unidade_id) || {}).nome })) }));
app.post('/api/imoveis/salvar', (req, res) => { DB.imoveis.push({ id: nextId('imoveis'), ...req.body, status: 'ativo' }); saveDB(); res.json({ sucesso: true }); });

// ===== FICHAS TÉCNICAS =====
app.get('/api/fichas-tecnicas', (req, res) => res.json({ fichas: DB.fichas_tecnicas || [] }));
app.get('/api/fichas-tecnicas/:id', (req, res) => { const f = (DB.fichas_tecnicas || []).find(x => x.id == req.params.id); res.json({ ficha: f || null }); });
app.post('/api/fichas-tecnicas/salvar', (req, res) => {
  const { tempo_producao_min, tempo_embalagem_min, tempo_acondicionamento_min } = req.body;
  const tempo_total = Number(tempo_producao_min || 0) + Number(tempo_embalagem_min || 0) + Number(tempo_acondicionamento_min || 0);
  DB.fichas_tecnicas.push({ id: nextId('fichas_tecnicas'), ...req.body, tempo_total_min: tempo_total, ativo: true });
  saveDB();
  res.json({ sucesso: true });
});

// ===== ORDENS DE SERVIÇO =====
app.get('/api/ordens-servico', (req, res) => res.json({ ordens: (DB.ordens_servico || []).map(o => ({ ...o, ficha_nome: ((DB.fichas_tecnicas || []).find(f => f.id === o.ficha_tecnica_id) || {}).nome_sabor, responsavel_nome: ((DB.funcionarios || []).find(f => f.id === o.responsavel_id) || {}).nome })) }));
app.post('/api/ordens-servico/criar', (req, res) => {
  const codigo = 'OS-' + hoje().replace(/-/g, '') + '-' + String((DB.ordens_servico || []).length + 1).padStart(3, '0');
  DB.ordens_servico.push({ id: nextId('ordens_servico'), codigo, ...req.body, status: 'pendente', solicitante_id: req.body.funcionario_id || 1, created_at: agora() });
  saveDB();
  res.json({ sucesso: true, codigo });
});
app.post('/api/ordens-servico/delegar', (req, res) => {
  const os = (DB.ordens_servico || []).find(o => o.id == req.body.os_id);
  if (os) { os.responsavel_id = req.body.responsavel_id; os.status = 'em_andamento'; os.data_inicio = agora(); }
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/ordens-servico/concluir', (req, res) => {
  const os = (DB.ordens_servico || []).find(o => o.id == req.body.os_id);
  if (os) { os.status = 'concluida'; os.data_conclusao = agora(); os.tempo_gasto_real_min = req.body.tempo_gasto_real_min; }
  saveDB();
  res.json({ sucesso: true });
});

// ===== COMANDAS =====
app.get('/api/comandas', (req, res) => res.json({ comandas: DB.comandas || [] }));
app.get('/api/comandas/abertas', (req, res) => res.json({ comandas: (DB.comandas || []).filter(c => c.status === 'ABERTA') }));
app.post('/api/comandas/criar', (req, res) => {
  const numero = 'CMD-' + String((DB.comandas || []).length + 1).padStart(4, '0');
  DB.comandas.push({ id: nextId('comandas'), numero, ...req.body, status: 'ABERTA', total: 0, entrada_at: agora() });
  saveDB();
  res.json({ sucesso: true, numero });
});
app.post('/api/comandas/fechar', (req, res) => {
  const cmd = (DB.comandas || []).find(c => c.id == req.body.comanda_id);
  if (cmd) { cmd.status = 'FECHADA'; cmd.fechada_em = agora(); }
  saveDB();
  res.json({ sucesso: true });
});
app.get('/api/comandas/qr/:id', (req, res) => { const cmd = (DB.comandas || []).find(c => c.id == req.params.id); res.json({ qr: cmd ? 'QR-' + cmd.numero : null }); });

// ===== PEDIDOS SITE / IFOOD =====
app.get('/api/site/pedidos', (req, res) => res.json({ pedidos: DB.pedidos_site || [] }));
app.post('/api/site/pedido/status', (req, res) => {
  const p = (DB.pedidos_site || []).find(x => x.id == req.body.pedido_id);
  if (p) p.status = req.body.status;
  saveDB();
  res.json({ sucesso: true });
});

// ===== EVENTOS =====
app.get('/api/eventos', (req, res) => res.json({ eventos: DB.eventos || [] }));
app.post('/api/eventos/salvar', (req, res) => { DB.eventos.push({ id: nextId('eventos'), ...req.body, status: 'orcamento', created_at: agora() }); saveDB(); res.json({ sucesso: true }); });

// ===== ESTOQUE / WMS =====
app.get('/api/wms/estoque', (req, res) => res.json({ estoque: (DB.estoque || []).map(e => ({ ...e, unidade_nome: ((DB.unidades || []).find(u => u.id === e.unidade_id) || {}).nome, valor_total: Number(e.qty || 0) * Number(e.valor_unitario || 0) })) }));
app.post('/api/wms/entrada', (req, res) => {
  let est = (DB.estoque || []).find(e => e.sku === req.body.sku && e.unidade_id == req.body.unidade_id);
  if (!est) { est = { id: nextId('estoque'), ...req.body, qty: 0 }; DB.estoque.push(est); }
  est.qty = Number(est.qty) + Number(req.body.qty);
  est.valor_unitario = req.body.valor_unitario || est.valor_unitario;
  DB.mov_estoque.push({ id: nextId('mov_estoque'), tipo: 'ENTRADA', ...req.body, created_at: agora() });
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/wms/saida', (req, res) => {
  const est = (DB.estoque || []).find(e => e.sku === req.body.sku && e.unidade_id == req.body.unidade_id);
  if (est) est.qty = Math.max(0, Number(est.qty) - Number(req.body.qty));
  DB.mov_estoque.push({ id: nextId('mov_estoque'), tipo: 'SAIDA', ...req.body, created_at: agora() });
  saveDB();
  res.json({ sucesso: true });
});
app.get('/api/wms/movimentos', (req, res) => res.json({ movimentos: (DB.mov_estoque || []).slice(-100).reverse() }));

// ===== REMESSAS =====
app.get('/api/remessas', (req, res) => res.json({ remessas: (DB.remessas || []).map(r => ({ ...r, origem_nome: ((DB.unidades || []).find(u => u.id === r.origem_unidade_id) || {}).nome, destino_nome: ((DB.unidades || []).find(u => u.id === r.destino_unidade_id) || {}).nome })) }));
app.post('/api/remessas/criar', (req, res) => {
  const codigo = 'REM-' + hoje().replace(/-/g, '') + '-' + String((DB.remessas || []).length + 1).padStart(3, '0');
  DB.remessas.push({ id: nextId('remessas'), codigo, origem_unidade_id: 1, ...req.body, status: 'enviada', data_envio: agora(), responsavel_envio_id: req.body.funcionario_id || 1 });
  saveDB();
  res.json({ sucesso: true, codigo });
});
app.post('/api/remessas/receber', (req, res) => {
  const rem = (DB.remessas || []).find(r => r.codigo === req.body.codigo);
  if (rem) { rem.status = 'recebida'; rem.data_recebimento = agora(); rem.assinatura_recebedor = req.body.assinatura_recebedor; rem.responsavel_recebimento_id = req.body.funcionario_id || 2; }
  saveDB();
  res.json({ sucesso: true });
});

// ===== CONTAS =====
app.get('/api/contas', (req, res) => res.json({ contas: DB.contas || [] }));
app.post('/api/contabilidade/conta/criar', (req, res) => { DB.contas.push({ id: nextId('contas'), ...req.body, status: 'ABERTO' }); saveDB(); res.json({ sucesso: true }); });
app.post('/api/contabilidade/conta/pagar', (req, res) => { const c = (DB.contas || []).find(x => x.id == req.body.conta_id); if (c) { c.status = c.tipo === 'RECEBER' ? 'RECEBIDO' : 'PAGO'; c.data_pagamento = hoje(); } saveDB(); res.json({ sucesso: true }); });

// ===== TESOURARIA =====
app.get('/api/tesouraria/status', (req, res) => {
  const tes = (DB.tesouraria || []).find(t => t.data === hoje());
  const aberta = tes && tes.status === 'aberta';
  const caixasAbertos = (DB.caixas || []).filter(c => c.status === 'aberto');
  const movs = (DB.mov_caixa || []).slice(-20).reverse();
  res.json({ tesouraria_aberta: aberta, saldo_atual: tes ? tes.saldo_atual : 0, caixas_abertos: caixasAbertos, movimentos: movs });
});
app.post('/api/tesouraria/abrir', (req, res) => {
  if ((DB.tesouraria || []).some(t => t.data === hoje() && t.status === 'aberta')) return res.json({ erro: 'Tesouraria já aberta hoje' });
  DB.tesouraria.push({ id: nextId('tesouraria'), data: hoje(), status: 'aberta', saldo_inicial: 0, saldo_atual: 0, aberta_por: req.body.funcionario_id || 1, aberta_em: agora(), unidade_id: req.body.unidade_id || 1 });
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/tesouraria/fechar', (req, res) => {
  const caixasAbertos = (DB.caixas || []).filter(c => c.status === 'aberto');
  if (caixasAbertos.length) return res.json({ erro: 'Existem ' + caixasAbertos.length + ' caixa(s) aberto(s). Feche todos primeiro.' });
  const tes = (DB.tesouraria || []).find(t => t.data === hoje());
  if (tes) { tes.status = 'fechada'; tes.fechada_por = req.body.funcionario_id || 1; tes.fechada_em = agora(); }
  saveDB();
  res.json({ sucesso: true, mensagem: 'Tesouraria fechada! Dia encerrado.' });
});

// ===== NOTAS FISCAIS =====
app.get('/api/nf/lista', (req, res) => res.json({ notas: DB.notas_fiscais || [] }));
function calcularImposto(valorBruto, regime) {
  const aliquotas = { simples_nacional: 6, lucro_presumido: 12, lucro_real: 15 };
  const aliq = aliquotas[regime] || 6;
  return { aliquota: aliq, valor_imposto: valorBruto * aliq / 100, base_calculo: valorBruto };
}
app.post('/api/nf/emitir', (req, res) => {
  const { pedido_id, nf_id } = req.body;
  const pedido = (DB.pedidos_site || []).find(p => p.id == pedido_id) || { total: 0, cliente_nome: 'Cliente' };
  const numero = 'NF-' + String((DB.notas_fiscais || []).length + 1).padStart(6, '0');
  const regime = (DB.unidades || [])[0]?.regime_tributario || 'simples_nacional';
  const imp = calcularImposto(Number(pedido.total || 100), regime);
  const nf = { id: nextId('notas_fiscais'), numero, serie: '1', origem_tipo: pedido_id ? 'ifood' : 'venda', origem_id: pedido_id || nf_id, razao_social_destinatario: pedido.cliente_nome || 'Cliente', valor_bruto: pedido.total || 100, regime_tributario: regime, ...imp, status: 'autorizada', chave_acesso: 'CHV' + Date.now(), data_emissao: agora() };
  DB.notas_fiscais.push(nf);
  if (pedido_id) pedido.nf_emitida = true;
  saveDB();
  res.json({ sucesso: true, numero, ...nf });
});
app.get('/api/nf/danfe/:id', (req, res) => { const nf = (DB.notas_fiscais || []).find(n => n.id == req.params.id); res.json({ danfe: nf || null }); });

// ===== AUTORIZAÇÕES =====
app.get('/api/autorizacoes', (req, res) => res.json({ autorizacoes: (DB.autorizacoes || []).map(a => ({ ...a, solicitante_nome: ((DB.funcionarios || []).find(f => f.id === a.solicitante_id) || {}).nome })) }));
app.post('/api/autorizacoes/decidir', (req, res) => {
  const a = (DB.autorizacoes || []).find(x => x.id == req.body.autorizacao_id);
  if (a) { a.status = req.body.decisao; a.autorizador_id = req.body.funcionario_id || 1; a.data_autorizacao = agora(); }
  saveDB();
  res.json({ sucesso: true });
});

// ===== RH: PONTO =====
app.get('/api/rh/ponto', (req, res) => res.json({ ponto: (DB.ponto || []).slice(-100).reverse().map(p => ({ ...p, funcionario_nome: ((DB.funcionarios || []).find(f => f.id === p.funcionario_id) || {}).nome })) }));
app.get('/api/rh/ponto/incompletos', (req, res) => {
  const incompletos = (DB.ponto || []).filter(p => p.situacao === 'incompleto').map(p => ({ ...p, funcionario_nome: ((DB.funcionarios || []).find(f => f.id === p.funcionario_id) || {}).nome, motivo: !p.entrada ? 'Sem entrada' : !p.saida ? 'Sem saída' : 'Dados parciais' }));
  res.json({ incompletos });
});
app.post('/api/rh/ponto/registrar', (req, res) => {
  const func = (DB.funcionarios || []).find(f => f.matricula === req.body.funcionario_matricula);
  if (!func) return res.json({ erro: 'Funcionário não encontrado' });
  const { entrada, saida, saida_almoco, retorno_almoco } = req.body;
  let horas = 0, extras = 0, saldo = 0, situacao = 'completo';
  if (entrada && saida) {
    const e = new Date('1970-01-01T' + entrada); const s = new Date('1970-01-01T' + saida);
    let intervalo = 0;
    if (saida_almoco && retorno_almoco) intervalo = (new Date('1970-01-01T' + retorno_almoco) - new Date('1970-01-01T' + saida_almoco)) / 3600000;
    horas = ((s - e) / 3600000) - intervalo;
    extras = Math.max(0, horas - (func.jornada_diaria || 8));
    saldo = horas - (func.jornada_diaria || 8);
  } else situacao = 'incompleto';
  let reg = (DB.ponto || []).find(p => p.funcionario_id === func.id && p.data_registro === req.body.data);
  if (!reg) { reg = { id: nextId('ponto'), funcionario_id: func.id, data_registro: req.body.data, created_at: agora() }; DB.ponto.push(reg); }
  Object.assign(reg, { entrada, saida, saida_almoco, retorno_almoco, horas_trabalhadas: Number(horas.toFixed(2)), horas_extras: Number(extras.toFixed(2)), saldo_horas: Number(saldo.toFixed(2)), situacao });
  saveDB();
  res.json({ sucesso: true, registro: reg });
});
app.post('/api/rh/ponto/acertar', (req, res) => {
  const reg = (DB.ponto || []).find(p => p.id == req.body.registro_id);
  if (!reg) return res.json({ erro: 'Registro não encontrado' });
  DB.acertos = DB.acertos || [];
  DB.acertos.push({ id: nextId('acertos'), registro_ponto_id: reg.id, solicitado_por: req.body.funcionario_id || 1, autorizado_por: req.body.funcionario_id || 1, campo_alterado: req.body.campo, valor_anterior: reg[req.body.campo], valor_novo: req.body.valor_novo, justificativa: req.body.justificativa, data_acordo: agora() });
  reg[req.body.campo] = req.body.valor_novo;
  reg.bloqueado = true; reg.alterado_por = req.body.funcionario_id || 1; reg.data_alteracao = agora();
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/rh/abono-gancho', (req, res) => {
  const func = (DB.funcionarios || []).find(f => f.matricula === req.body.funcionario_matricula);
  if (!func) return res.json({ erro: 'Funcionário não encontrado' });
  DB.abonos = DB.abonos || [];
  DB.abonos.push({ id: nextId('abonos'), funcionario_id: func.id, tipo: req.body.tipo, quantidade_horas: req.body.quantidade_horas, justificativa: req.body.justificativa || '', autorizado_por: req.body.funcionario_id || 1, lancado_em: agora() });
  saveDB();
  res.json({ sucesso: true });
});

// ===== RH: FÉRIAS / 13º =====
app.get('/api/rh/ferias', (req, res) => res.json({ ferias: (DB.ferias || []).map(f => ({ ...f, funcionario_nome: ((DB.funcionarios || []).find(x => x.id === f.funcionario_id) || {}).nome })) }));
app.post('/api/rh/ferias/registrar', (req, res) => {
  const func = (DB.funcionarios || []).find(f => f.matricula === req.body.funcionario_matricula);
  if (!func) return res.json({ erro: 'Funcionário não encontrado' });
  const valor = func.salario_base;
  const umTerco = valor / 3;
  const total = valor + umTerco;
  DB.ferias.push({ id: nextId('ferias'), funcionario_id: func.id, ...req.body, valor_ferias: valor, um_terco_constitucional: umTerco, valor_total: total, status: 'aprovada', created_at: agora() });
  saveDB();
  res.json({ sucesso: true, valor_total: total });
});
app.get('/api/rh/decimo-terceiro/:mat', (req, res) => {
  const func = (DB.funcionarios || []).find(f => f.matricula === req.params.mat);
  if (!func) return res.json({ erro: 'Funcionário não encontrado' });
  const meses = Math.min(12, Math.max(1, Math.floor((new Date() - new Date(func.data_admissao)) / (1000 * 60 * 60 * 24 * 30))));
  const valor = (func.salario_base / 12) * meses;
  res.json({ meses_trabalhados: meses, valor_proporcional: valor, primeiraParcela: valor / 2, segundaParcela: valor / 2 });
});

// ===== RH: HOLERITES =====
app.get('/api/rh/holerites', (req, res) => res.json({ holerites: (DB.holerites || []).map(h => ({ ...h, funcionario_nome: ((DB.funcionarios || []).find(f => f.id === h.funcionario_id) || {}).nome })) }));
app.post('/api/rh/holerites/criar', (req, res) => {
  const func = (DB.funcionarios || []).find(f => f.matricula === req.body.funcionario_matricula);
  if (!func) return res.json({ erro: 'Funcionário não encontrado' });
  const base = Number(req.body.salario_base || func.salario_base);
  const extras = Number(req.body.valor_horas_extras || 0);
  const abonos = Number(req.body.abonos || 0);
  const descontos = Number(req.body.descontos_gancho || 0);
  const inss = base * 0.075; const irrf = Math.max(0, (base - inss) * 0.075); const fgts = base * 0.08;
  const liquido = base + extras + abonos - inss - irrf - descontos;
  DB.holerites.push({ id: nextId('holerites'), funcionario_id: func.id, ...req.body, salario_base: base, inss, irrf, fgts, pis_cofins: base * 0.03, valor_liquido: Number(liquido.toFixed(2)), status: 'processada', data_geracao: agora() });
  saveDB();
  res.json({ sucesso: true, valor_liquido: liquido });
});

// ===== RH: RESCISÃO =====
app.post('/api/rh/rescisao/simular', (req, res) => {
  const func = (DB.funcionarios || []).find(f => f.matricula === req.body.funcionario_matricula);
  if (!func) return res.json({ erro: 'Funcionário não encontrado' });
  const diasServico = Math.ceil((new Date(req.body.data_desligamento) - new Date(func.data_admissao)) / 86400000);
  const meses = Math.min(12, Math.max(1, Math.floor(diasServico / 30)));
  const decimo = (func.salario_base / 12) * meses;
  const feriasProp = (func.salario_base / 12) * meses;
  const feriasTotal = feriasProp + (feriasProp / 3);
  const saldoSalario = Number(req.body.saldo_salario || 0);
  const total = saldoSalario + decimo + feriasTotal;
  res.json({ funcionario: func.nome, tempoServicoDias: diasServico, saldoSalario, decimoTerceiro: Number(decimo.toFixed(2)), feriasProporcionais: Number(feriasTotal.toFixed(2)), feriasVencidas: 0, totalDevido: Number(total.toFixed(2)) });
});

// ===== RH: DOCUMENTOS =====
app.get('/api/rh/documentos', (req, res) => res.json({ documentos: (DB.documentos_rh || []).map(d => ({ ...d, funcionario_nome: ((DB.funcionarios || []).find(f => f.id === d.funcionario_id) || {}).nome })) }));
app.post('/api/rh/documentos/salvar', (req, res) => {
  const func = (DB.funcionarios || []).find(f => f.matricula === req.body.funcionario_matricula);
  DB.documentos_rh.push({ id: nextId('documentos_rh'), funcionario_id: func ? func.id : 1, ...req.body, data_cadastro: agora() });
  saveDB();
  res.json({ sucesso: true });
});

// ===== LOGÍSTICA / FROTA =====
app.get('/api/logistica/movimentos', (req, res) => res.json({ movimentos: DB.logistica || [] }));
app.post('/api/logistica/criar', (req, res) => { DB.logistica.push({ id: nextId('logistica'), ...req.body, status: 'EM_TRANSITO', created_at: agora() }); saveDB(); res.json({ sucesso: true }); });
app.post('/api/logistica/concluir', (req, res) => { const l = (DB.logistica || []).find(x => x.id == req.body.logistica_id); if (l) l.status = 'CONCLUIDO'; saveDB(); res.json({ sucesso: true }); });
app.get('/api/frota', (req, res) => res.json({ frota: (DB.frota || []).map(f => ({ ...f, entregador_nome: ((DB.funcionarios || []).find(x => x.id === f.entregador_id) || {}).nome })) }));
app.post('/api/frota/salvar', (req, res) => { DB.frota.push({ id: nextId('frota'), ...req.body, status: 'disponivel' }); saveDB(); res.json({ sucesso: true }); });

// ===== CHECKLISTS =====
app.get('/api/checklists/concluidos', (req, res) => res.json({ checklists: (DB.checklists_exec || []).slice(-50).reverse() }));
app.get('/api/checklists/executar/:tipo', (req, res) => res.json({ tipo: req.params.tipo, mensagem: 'Checklist aberto para execução' }));
app.get('/api/checklists/imprimir/:id', (req, res) => res.json({ checklist_id: req.params.id, mensagem: 'Impressão gerada' }));
app.get('/api/checklists/imprimir/evento/:id', (req, res) => res.json({ evento_id: req.params.id, mensagem: 'Checklist do evento gerado' }));

// ===== BOT WHATSAPP / CELULAR =====
app.get('/api/bot/config', (req, res) => res.json({ config_geral: DB.bot_config || [], regras: DB.bot_regras || [] }));
app.post('/api/bot/config', (req, res) => {
  ['nome_bot', 'saudacao', 'horario_atendimento', 'endereco'].forEach(k => {
    if (req.body[k] !== undefined) {
      let cfg = (DB.bot_config || []).find(c => c.nome === k);
      if (!cfg) { cfg = { nome: k, valor: '' }; DB.bot_config.push(cfg); }
      cfg.valor = req.body[k];
    }
  });
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/bot/regras', (req, res) => { DB.bot_regras.push({ id: nextId('bot_regras'), palavras_chave: req.body.palavras_chave, resposta: req.body.resposta }); saveDB(); res.json({ sucesso: true }); });
app.post('/api/bot/regras/excluir', (req, res) => { DB.bot_regras = (DB.bot_regras || []).filter(r => r.id != req.body.id); saveDB(); res.json({ sucesso: true }); });
// Endpoint principal do bot — usado pelo WhatsApp (webhook) e pelo site/celular
function responderBot(mensagem) {
  const msg = (mensagem || '').toLowerCase();
  const regra = (DB.bot_regras || []).find(r => r.palavras_chave.split('|').some(kw => msg.includes(kw.trim().toLowerCase())));
  if (regra) return regra.resposta;
  const nomeBot = ((DB.bot_config || []).find(c => c.nome === 'nome_bot') || {}).valor || 'Bot';
  return `Olá! Eu sou o ${nomeBot}. Posso te ajudar com: sabores e preços, picolés, açaí, eventos/festas, delivery/iFood e horários. O que deseja?`;
}
app.post('/api/bot/responder', (req, res) => res.json({ resposta: responderBot(req.body.mensagem) }));
// Webhook do WhatsApp (ex: Evolution API / Z-API / Twilio) — recebe mensagem do celular e responde
app.post('/api/bot/webhook', (req, res) => {
  const msg = req.body.message || req.body.text || req.body.body || '';
  const remetente = req.body.from || req.body.remetente || 'celular';
  const resposta = responderBot(msg);
  // Aqui você integra com a API do WhatsApp (Evolution/Z-API/Twilio) para enviar a resposta
  DB.bot_log = DB.bot_log || [];
  DB.bot_log.push({ id: nextId('bot_log'), remetente, mensagem: msg, resposta, data: agora() });
  saveDB();
  res.json({ resposta, remetente });
});
app.get('/api/bot/log', (req, res) => res.json({ log: (DB.bot_log || []).slice(-50).reverse() }));

// ===== IA VENDAS =====
app.get('/api/ia-vendas/metricas', (req, res) => res.json({ total_pedidos: (DB.ia_pedidos || []).length, receita_ia: (DB.ia_pedidos || []).reduce((s, p) => s + Number(p.total || 0), 0), clientes_site: new Set((DB.ia_pedidos || []).map(p => p.cliente_nome)).size }));
app.get('/api/ia-vendas/produtos-recomendados', (req, res) => res.json({ recomendados: (DB.produtos || []).filter(p => p.categoria !== 'Insumos').slice(0, 5) }));
app.post('/api/ia-vendas/chat', (req, res) => {
  const msg = (req.body.mensagem || '').toLowerCase();
  let resposta = responderBot(msg);
  let produtos = [];
  if (msg.includes('combo') || msg.includes('promo') || msg.includes('recomenda')) {
    produtos = (DB.produtos || []).filter(p => ['Picolés', 'Sorvetes', 'Açaí'].includes(p.categoria)).slice(0, 3);
    resposta = 'Montei um combo especial para você: ' + produtos.map(p => p.nome + ' (' + fmt(p.preco_venda) + ')').join(', ') + '. Posso adicionar ao pedido?';
  }
  res.json({ resposta, produtos });
});
app.post('/api/ia-vendas/salvar-pedido', (req, res) => {
  const pedido = { id: nextId('ia_pedidos'), ...req.body, status: 'CONFIRMADO', data: agora() };
  DB.ia_pedidos.push(pedido);
  DB.pedidos_site.push({ id: nextId('pedidos_site'), ...req.body, origem: 'site_ia', status: 'CONFIRMADO', nf_emitida: false, data: agora() });
  saveDB();
  res.json({ sucesso: true, pedido_id: pedido.id });
});

// ===== GERENTE =====
app.get('/api/gerente/status-modulos', (req, res) => {
  const modulos = [
    { modulo: 'Vendas Hoje', valor: fmt((DB.vendas || []).filter(v => (v.data || '').slice(0, 10) === hoje()).reduce((s, v) => s + Number(v.total || 0), 0)), status: 'ok' },
    { modulo: 'Caixa', valor: (DB.caixas || []).some(c => c.status === 'aberto') ? 'Aberto' : 'Fechado', status: (DB.caixas || []).some(c => c.status === 'aberto') ? 'ok' : 'atencao' },
    { modulo: 'Tesouraria', valor: (DB.tesouraria || []).some(t => t.status === 'aberta' && t.data === hoje()) ? 'Aberta' : 'Fechada', status: (DB.tesouraria || []).some(t => t.status === 'aberta' && t.data === hoje()) ? 'ok' : 'atencao' },
    { modulo: 'Estoque Baixo', valor: (DB.estoque || []).filter(e => Number(e.qty || 0) < 20).length + ' itens', status: (DB.estoque || []).filter(e => Number(e.qty || 0) < 20).length ? 'critico' : 'ok' },
    { modulo: 'Remessas em Trânsito', valor: (DB.remessas || []).filter(r => r.status !== 'recebida').length, status: (DB.remessas || []).filter(r => r.status !== 'recebida').length ? 'atencao' : 'ok' },
    { modulo: 'Ponto Incompleto', valor: (DB.ponto || []).filter(p => p.situacao === 'incompleto').length, status: (DB.ponto || []).filter(p => p.situacao === 'incompleto').length ? 'atencao' : 'ok' }
  ];
  res.json({ modulos });
});
app.get('/api/gerente/relatorio-vendas', (req, res) => {
  const vendas = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); const ds = d.toISOString().slice(0, 10);
    const doDia = (DB.vendas || []).filter(v => (v.data || '').slice(0, 10) === ds);
    vendas.push({ dia: ds, origem: 'loja', valor: doDia.filter(v => v.origem !== 'site').reduce((s, v) => s + Number(v.total || 0), 0) });
    vendas.push({ dia: ds, origem: 'site', valor: doDia.filter(v => v.origem === 'site' || v.origem === 'ifood').reduce((s, v) => s + Number(v.total || 0), 0) });
  }
  res.json({ vendas });
});

// ===== SITE (página pública com chatbot para celular) =====
app.get('/api/site/produtos', (req, res) => res.json({ produtos: (DB.produtos || []).filter(p => p.categoria !== 'Insumos' && p.status === 'ATIVO') }));
app.post('/api/site/pedido', (req, res) => {
  const pedido = { id: nextId('pedidos_site'), ...req.body, origem: 'site', status: 'SOLICITADO', nf_emitida: false, data: agora() };
  DB.pedidos_site.push(pedido);
  saveDB();
  res.json({ sucesso: true, pedido_id: pedido.id });
});

// ===== CRM / CONTATOS =====
app.get('/api/crm/contatos', (req, res) => {
  const contatos = (DB.crm_contatos || []).slice(-50).reverse();
  const hojeStr = hoje();
  res.json({
    total_clientes: (DB.clientes || []).length,
    contatos_hoje: contatos.filter(c => (c.data || '').slice(0,10) === hojeStr).length,
    oportunidades: contatos.filter(c => c.status === 'pendente' || c.status === 'em_andamento').length,
    clientes_vip: (DB.clientes || []).filter(c => Number(c.valor_total_gasto || 0) > 500).length,
    contatos
  });
});
app.post('/api/crm/contato/salvar', (req, res) => {
  DB.crm_contatos = DB.crm_contatos || [];
  DB.crm_contatos.push({ id: nextId('crm_contatos'), ...req.body, data: agora(), status: req.body.status || 'pendente' });
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/crm/contato/finalizar', (req, res) => {
  const c = (DB.crm_contatos || []).find(x => x.id == req.body.contato_id);
  if (c) c.status = 'concluido';
  saveDB();
  res.json({ sucesso: true });
});

// ===== BOLETOS / BANCOS =====
app.get('/api/boletos/lista', (req, res) => {
  const boletos = (DB.boletos || []).slice(-50).reverse();
  res.json({
    boletos,
    pagos: boletos.filter(b => b.status === 'pago').length,
    pendentes: boletos.filter(b => b.status === 'pendente').length,
    vencidos: boletos.filter(b => b.status === 'vencido' || (b.vencimento < hoje() && b.status !== 'pago')).length,
    bancos_conectados: 1
  });
});
app.post('/api/boletos/gerar', (req, res) => {
  const numero = 'BOL-' + String((DB.boletos || []).length + 1).padStart(6, '0');
  DB.boletos = DB.boletos || [];
  DB.boletos.push({ id: nextId('boletos'), numero, ...req.body, status: 'pendente', data_geracao: agora() });
  saveDB();
  res.json({ sucesso: true, numero });
});
app.post('/api/boletos/pagar', (req, res) => {
  const b = (DB.boletos || []).find(x => x.id == req.body.boleto_id);
  if (b) { b.status = 'pago'; b.data_pagamento = agora(); }
  saveDB();
  res.json({ sucesso: true });
});
app.get('/api/boletos/imprimir/:id', (req, res) => {
  const b = (DB.boletos || []).find(x => x.id == req.params.id);
  res.json({ boleto: b, linha_digitavel: '0019050095401448160690601020000058185000000000' });
});

// ===== IFOOD =====
app.get('/api/ifood/status', (req, res) => {
  const cfg = DB.ifood_config || { conectado: false };
  const pedidos = (DB.pedidos_site || []).filter(p => p.origem === 'ifood').slice(-20).reverse();
  const hojeStr = hoje();
  res.json({
    conectado: cfg.conectado || false,
    pedidos_hoje: pedidos.filter(p => (p.data || '').slice(0,10) === hojeStr).length,
    valor_hoje: pedidos.filter(p => (p.data || '').slice(0,10) === hojeStr).reduce((s,p) => s + Number(p.total || 0), 0),
    taxa_media: 12,
    pedidos
  });
});
app.post('/api/ifood/configurar', (req, res) => {
  DB.ifood_config = { ...req.body, conectado: req.body.ativo, configurado_em: agora() };
  saveDB();
  res.json({ sucesso: true });
});

// ===== STATUS DAS LOJAS (para dashboard) =====
app.get('/api/lojas/status', (req, res) => {
  const lojas = (DB.unidades || []).map(u => ({
    id: u.id, nome: u.nome, tipo: u.tipo, e_matriz: u.e_matriz,
    online: true,
    caixa_aberto: (DB.caixas || []).some(c => c.unidade_id === u.id && c.status === 'aberto'),
    vendas_hoje: (DB.vendas || []).filter(v => (v.data || '').slice(0,10) === hoje() && v.unidade_id === u.id).reduce((s,v) => s + Number(v.total || 0), 0),
    pedidos_pendentes: (DB.pedidos_site || []).filter(p => p.unidade_id === u.id && p.status !== 'ENTREGUE' && p.status !== 'CANCELADO').length
  }));
  res.json({ lojas, matriz_aberta: DB.controle_sistema?.matriz_aberta || false });
});

// ===== EMAIL (Outlook / Gmail via SMTP) =====
// Configurar no Render (env vars):
//   SMTP_HOST = smtp.office365.com (Outlook) ou smtp.gmail.com (Gmail)
//   SMTP_PORT = 587
//   SMTP_USER = seu@email.com
//   SMTP_PASS = sua senha (ou App Password para Gmail)
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
let transporter = null;
if (nodemailer && SMTP_HOST && SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: false, auth: { user: SMTP_USER, pass: SMTP_PASS } });
  console.log('📧 Email configurado:', SMTP_USER);
}
app.get('/api/email/status', (req, res) => res.json({ configurado: !!transporter, host: SMTP_HOST || 'não configurado', usuario: SMTP_USER || '' }));
app.post('/api/email/enviar', async (req, res) => {
  if (!transporter) return res.json({ erro: 'Email não configurado. Defina SMTP_HOST, SMTP_USER, SMTP_PASS nas variáveis de ambiente.' });
  const { para, assunto, corpo, anexo_nome, anexo_conteudo } = req.body;
  try {
    const mailOptions = { from: SMTP_USER, to: para, subject: assunto, html: corpo || '<p>Olá!</p>' };
    if (anexo_nome && anexo_conteudo) {
      mailOptions.attachments = [{ filename: anexo_nome, content: anexo_conteudo, encoding: 'base64' }];
    }
    const info = await transporter.sendMail(mailOptions);
    DB.email_log = DB.email_log || [];
    DB.email_log.push({ id: nextId('email_log'), para, assunto, enviado_em: agora(), status: 'enviado' });
    saveDB();
    res.json({ sucesso: true, messageId: info.messageId });
  } catch(e) { res.json({ erro: e.message }); }
});

// ===== EXPORT EXCEL =====
app.get('/api/export/excel/:tipo', (req, res) => {
  const tipo = req.params.tipo;
  let dados = [], colunas = [];
  if (tipo === 'vendas') {
    dados = (DB.vendas || []).map(v => ({ Data: (v.data||'').slice(0,10), Cliente: v.cliente_nome, FormaPagamento: v.forma_pagamento, Total: Number(v.total||0), Status: v.status, Operador: v.operador_matricula }));
    colunas = ['Data','Cliente','FormaPagamento','Total','Status','Operador'];
  } else if (tipo === 'estoque') {
    dados = (DB.estoque || []).map(e => ({ SKU: e.sku, Produto: e.produto_nome, Quantidade: Number(e.qty||0), ValorUnit: Number(e.valor_unitario||0), Lote: e.lote, Unidade: e.unidade_id }));
    colunas = ['SKU','Produto','Quantidade','ValorUnit','Lote','Unidade'];
  } else if (tipo === 'financeiro') {
    dados = (DB.contas || []).map(c => ({ Descricao: c.descricao, Tipo: c.tipo, Valor: Number(c.valor||0), Vencimento: c.vencimento, Status: c.status, Categoria: c.categoria }));
    colunas = ['Descricao','Tipo','Valor','Vencimento','Status','Categoria'];
  } else if (tipo === 'clientes') {
    dados = (DB.clientes || []).map(c => ({ Nome: c.nome, CPF_CNPJ: c.cpf_cnpj, Telefone: c.telefone, Email: c.email, Pontos: Number(c.pontos_disponiveis||0), TotalGasto: Number(c.valor_total_gasto||0) }));
    colunas = ['Nome','CPF_CNPJ','Telefone','Email','Pontos','TotalGasto'];
  } else if (tipo === 'rh') {
    dados = (DB.funcionarios || []).map(f => ({ Matricula: f.matricula, Nome: f.nome, Cargo: f.cargo, Salario: Number(f.salario_base||0), Unidade: f.unidade_id, Status: f.status }));
    colunas = ['Matricula','Nome','Cargo','Salario','Unidade','Status'];
  } else {
    return res.status(400).json({ erro: 'Tipo inválido. Use: vendas, estoque, financeiro, clientes, rh' });
  }
  if (XLSX) {
    const ws = XLSX.utils.json_to_sheet(dados, { header: colunas });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tipo);
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${tipo}-${hoje()}.xlsx"`);
    res.send(buf);
  } else {
    // Fallback: CSV (abre no Excel)
    const csv = colunas.join(';') + '\n' + dados.map(d => colunas.map(c => `"${d[c]||''}"`).join(';')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${tipo}-${hoje()}.csv"`);
    res.send('\uFEFF' + csv);
  }
});

// ===== EXPORT WORD (gera .doc que abre no Word) =====
app.get('/api/export/word/:tipo', (req, res) => {
  const tipo = req.params.tipo;
  let titulo = 'Documento', conteudo = '';
  if (tipo === 'orcamento') {
    titulo = 'Orçamento de Evento / Festa';
    const itens = (DB.produtos || []).filter(p => p.categoria !== 'Insumos').slice(0,5);
    conteudo = `<h1>${titulo}</h1><p>Data: ${new Date().toLocaleDateString('pt-BR')}</p><p>Validade: 7 dias</p><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Item</th><th>Qtd</th><th>Valor Unit.</th><th>Total</th></tr>` +
      itens.map(p => `<tr><td>${p.nome}</td><td>10</td><td>R$ ${Number(p.preco_venda).toFixed(2)}</td><td>R$ ${(10*Number(p.preco_venda)).toFixed(2)}</td></tr>`).join('') +
      `<tr><td colspan="3"><b>Total</b></td><td><b>R$ ${itens.reduce((s,p)=>s+10*Number(p.preco_venda),0).toFixed(2)}</b></td></tr></table><p>Condições de pagamento: 50% na reserva, 50% no dia do evento.</p>`;
  } else if (tipo === 'contrato') {
    titulo = 'Contrato de Prestação de Serviços';
    conteudo = `<h1>${titulo}</h1><p>CONTRATANTE: ___________________________</p><p>CONTRATADA: Sorveteria ERP Ltda.</p><p>CLÁUSULA 1ª — Do Objeto: A contratada se obriga a fornecer produtos de sorveteria, picolés e açaí para o evento.</p><p>CLÁUSULA 2ª — Do Valor: R$ ______________</p><p>CLÁUSULA 3ª — Da Forma de Pagamento: 50% na assinatura, 50% na entrega.</p><p>CLÁUSULA 4ª — Do Prazo: Evento realizado em ___/___/______.</p><p>E por estar assim contratado, assinam o presente instrumento em 2 vias de igual teor.</p><br><p>____________________________________<br>CONTRATANTE</p><p>____________________________________<br>CONTRATADA</p>`;
  } else if (tipo === 'holerite') {
    const f = (DB.funcionarios || [])[0] || { nome:'Funcionário', matricula:'0001', cargo:'Atendente', salario_base:1500 };
    const base = Number(f.salario_base||1500);
    const inss = base*0.075, irrf = Math.max(0,(base-inss)*0.075), fgts = base*0.08;
    conteudo = `<h1>Holerite / Recibo de Pagamento</h1><p>Funcionário: ${f.nome} — Matrícula: ${f.matricula}</p><p>Cargo: ${f.cargo} — Competência: ${new Date().toLocaleDateString('pt-BR')}</p><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Descrição</th><th>Referência</th><th>Proventos</th><th>Descontos</th></tr><tr><td>Salário Base</td><td>30 dias</td><td>R$ ${base.toFixed(2)}</td><td></td></tr><tr><td>INSS</td><td>7,5%</td><td></td><td>R$ ${inss.toFixed(2)}</td></tr><tr><td>IRRF</td><td>7,5%</td><td></td><td>R$ ${irrf.toFixed(2)}</td></tr><tr><td>FGTS</td><td>8%</td><td></td><td>R$ ${fgts.toFixed(2)}</td></tr><tr><td colspan="2"><b>Líquido</b></td><td colspan="2"><b>R$ ${(base-inss-irrf).toFixed(2)}</b></td></tr></table>`;
  } else if (tipo === 'relatorio-vendas') {
    const vendas = (DB.vendas || []).slice(-30);
    const total = vendas.reduce((s,v)=>s+Number(v.total||0),0);
    conteudo = `<h1>Relatório de Vendas</h1><p>Período: últimos 30 registros — ${new Date().toLocaleDateString('pt-BR')}</p><p>Total: R$ ${total.toFixed(2)}</p><table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>Data</th><th>Cliente</th><th>Forma Pagto</th><th>Total</th><th>Status</th></tr>` +
      vendas.map(v => `<tr><td>${(v.data||'').slice(0,10)}</td><td>${v.cliente_nome||''}</td><td>${v.forma_pagamento||''}</td><td>R$ ${Number(v.total||0).toFixed(2)}</td><td>${v.status||''}</td></tr>`).join('') + '</table>';
  } else {
    return res.status(400).json({ erro: 'Tipo inválido. Use: orcamento, contrato, holerite, relatorio-vendas' });
  }
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${titulo}</title></head><body>${conteudo}</body></html>`;
  res.setHeader('Content-Type', 'application/msword');
  res.setHeader('Content-Disposition', `attachment; filename="${tipo}-${hoje()}.doc"`);
  res.send(html);
});

// ===== METAS / OBJETIVOS =====
app.get('/api/metas/lista', (req, res) => {
  const metas = DB.metas || [];
  const mesAtual = hoje().slice(0, 7);
  res.json({ metas: metas.filter(m => m.mes === mesAtual || !m.mes), mes: mesAtual });
});
app.post('/api/metas/salvar', (req, res) => {
  DB.metas = DB.metas || [];
  const { id } = req.body;
  if (id) {
    const m = DB.metas.find(x => x.id == id);
    if (m) Object.assign(m, req.body);
  } else {
    DB.metas.push({ id: nextId('metas'), ...req.body, mes: req.body.mes || hoje().slice(0,7), criado_em: agora() });
  }
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/metas/excluir', (req, res) => {
  DB.metas = (DB.metas || []).filter(m => m.id != req.body.id);
  saveDB();
  res.json({ sucesso: true });
});
app.get('/api/metas/progresso', (req, res) => {
  const mesAtual = hoje().slice(0, 7);
  const vendasMes = (DB.vendas || []).filter(v => (v.data || '').slice(0,7) === mesAtual);
  const totalVendas = vendasMes.reduce((s,v) => s + Number(v.total || 0), 0);
  const picoles = vendasMes.flatMap(v => v.itens || []).filter(i => (i.produto_nome || '').toLowerCase().includes('picolé')).reduce((s,i) => s + Number(i.qty || 0), 0);
  const metas = (DB.metas || []).filter(m => m.mes === mesAtual || !m.mes);
  const progresso = metas.map(m => {
    let atual = 0;
    if (m.tipo === 'vendas_total') atual = totalVendas;
    else if (m.tipo === 'picoles_unidades') atual = picoles;
    else if (m.tipo === 'ticket_medio') atual = vendasMes.length ? totalVendas / vendasMes.length : 0;
    else if (m.tipo === 'clientes_novos') atual = (DB.clientes || []).filter(c => (c.data_cadastro || '').slice(0,7) === mesAtual).length;
    else atual = totalVendas * 0.5;
    return { ...m, atual, percentual: m.valor_meta > 0 ? Math.min(100, (atual / m.valor_meta) * 100) : 0 };
  });
  res.json({ mes: mesAtual, total_vendas_mes: totalVendas, picoles_mes: picoles, progresso });
});

// ===== METAS COM IA (sugestão automática baseada no histórico) =====
app.get('/api/metas/ia-sugerir', (req, res) => {
  const hojeStr = hoje();
  const mesAtual = hojeStr.slice(0, 7);
  // Pega últimos 3 meses
  const meses = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    meses.push(d.toISOString().slice(0, 7));
  }
  const historico = meses.map(m => {
    const vendas = (DB.vendas || []).filter(v => (v.data || '').slice(0,7) === m);
    const total = vendas.reduce((s,v) => s + Number(v.total || 0), 0);
    const picoles = vendas.flatMap(v => v.itens || []).filter(i => (i.produto_nome || '').toLowerCase().includes('picolé')).reduce((s,i) => s + Number(i.qty || 0), 0);
    const ticket = vendas.length ? total / vendas.length : 0;
    return { mes: m, total_vendas: total, picoles, ticket_medio: ticket, num_vendas: vendas.length };
  });
  const mediaVendas = historico.reduce((s,h) => s + h.total_vendas, 0) / historico.length || 5000;
  const mediaPicoles = historico.reduce((s,h) => s + h.picoles, 0) / historico.length || 500;
  const mediaTicket = historico.reduce((s,h) => s + h.ticket_medio, 0) / historico.length || 15;
  // IA sugere meta com crescimento de 15% sobre a média
  const fatorCrescimento = 1.15;
  const sugestoes = [
    { tipo: 'vendas_total', descricao: 'Meta IA — Vendas Totais', valor_meta: Math.round(mediaVendas * fatorCrescimento), base: mediaVendas, crescimento: '+15%', justificativa: 'Baseado na média dos últimos 3 meses com crescimento projetado de 15%' },
    { tipo: 'picoles_unidades', descricao: 'Meta IA — Picolés Vendidos', valor_meta: Math.round(mediaPicoles * fatorCrescimento), base: mediaPicoles, crescimento: '+15%', justificativa: 'Média de picolés vendidos nos últimos 3 meses + crescimento sazonal' },
    { tipo: 'ticket_medio', descricao: 'Meta IA — Ticket Médio', valor_meta: Math.round(mediaTicket * 1.10 * 100) / 100, base: mediaTicket, crescimento: '+10%', justificativa: 'Incentivar upsell (açaí + complementos) para aumentar ticket em 10%' },
    { tipo: 'clientes_novos', descricao: 'Meta IA — Novos Clientes', valor_meta: Math.round(20 * fatorCrescimento), base: 20, crescimento: '+15%', justificativa: 'Meta de captação via fidelidade e indicações' }
  ];
  res.json({ mes: mesAtual, historico, sugestoes, media_historico: { vendas: mediaVendas, picoles: mediaPicoles, ticket: mediaTicket } });
});
app.post('/api/metas/ia-aplicar', (req, res) => {
  const sugestoes = req.body.sugestoes || [];
  DB.metas = DB.metas || [];
  const mesAtual = hoje().slice(0, 7);
  sugestoes.forEach(s => {
    DB.metas.push({ id: nextId('metas'), ...s, mes: mesAtual, criado_por_ia: true, criado_em: agora() });
  });
  saveDB();
  res.json({ sucesso: true, aplicadas: sugestoes.length });
});

// ===== META IA — Assistente Inteligente do Negócio =====
app.post('/api/meta-ia/chat', (req, res) => {
  const msg = (req.body.mensagem || '').toLowerCase();
  const hojeStr = hoje();
  const mesAtual = hojeStr.slice(0, 7);
  
  // Dados do negócio
  const vendasHoje = (DB.vendas || []).filter(v => (v.data || '').slice(0,10) === hojeStr);
  const totalHoje = vendasHoje.reduce((s,v) => s + Number(v.total || 0), 0);
  const vendasMes = (DB.vendas || []).filter(v => (v.data || '').slice(0,7) === mesAtual);
  const totalMes = vendasMes.reduce((s,v) => s + Number(v.total || 0), 0);
  const picolesMes = vendasMes.flatMap(v => v.itens || []).filter(i => (i.produto_nome || '').toLowerCase().includes('picolé')).reduce((s,i) => s + Number(i.qty || 0), 0);
  const ticketMedio = vendasMes.length ? totalMes / vendasMes.length : 0;
  const estoqueBaixo = (DB.estoque || []).filter(e => Number(e.qty || 0) < Number(e.estoque_minimo || 20));
  const contasVencer = (DB.contas || []).filter(c => c.status === 'ABERTO' && c.vencimento <= hojeStr).reduce((s,c) => s + Number(c.valor || 0), 0);
  const pontoIncompleto = (DB.ponto || []).filter(p => p.situacao === 'incompleto').length;
  const metas = (DB.metas || []).filter(m => m.mes === mesAtual);
  
  let resposta = '';
  
  if (msg.includes('venda') || msg.includes('faturamento') || msg.includes('receita') || msg.includes('quanto vendeu')) {
    resposta = `📊 Análise de Vendas:\n\n• Hoje: ${fmt(totalHoje)} em ${vendasHoje.length} venda(s)\n• Este mês: ${fmt(totalMes)}\n• Ticket médio: ${fmt(ticketMedio)}\n• Picolés vendidos no mês: ${picolesMes} unidades\n\n💡 Recomendação: ${totalHoje < 500 ? 'Vendas abaixo da média — ative promoção de combo picolé+açaí para impulsionar.' : 'Bom ritmo! Continue assim e considere upsell de complementos.'}`;
  } else if (msg.includes('estoque') || msg.includes('insumo') || msg.includes('falta') || msg.includes('produto')) {
    if (estoqueBaixo.length) {
      resposta = `⚠️ ALERTA DE ESTOQUE BAIXO:\n\n${estoqueBaixo.slice(0,5).map(e => `• ${e.produto_nome || e.sku}: ${e.qty} unidades (mínimo: ${e.estoque_minimo || 20})`).join('\n')}\n\n💡 Recomendação: Faça um pedido urgente aos fornecedores ou produza mais destes itens.`;
    } else {
      resposta = `✅ Estoque saudável! Todos os produtos acima do nível mínimo.\n\n💡 Dica: Revise as validades dos lotes mais antigos (FEFO) para evitar perdas.`;
    }
  } else if (msg.includes('meta') || msg.includes('objetivo') || msg.includes('meta')) {
    if (metas.length) {
      const texto = metas.map(m => {
        const atual = m.tipo === 'vendas_total' ? totalMes : m.tipo === 'picoles_unidades' ? picolesMes : m.tipo === 'ticket_medio' ? ticketMedio : 0;
        const pct = m.valor_meta > 0 ? Math.min(100, (atual / m.valor_meta) * 100) : 0;
        return `• ${m.descricao || m.tipo}: ${fmt(atual)} / ${fmt(m.valor_meta)} — ${pct.toFixed(0)}% atingido`;
      }).join('\n');
      resposta = `🎯 Status das Metas do Mês:\n\n${texto}\n\n💡 ${metas.some(m => (m.tipo==='vendas_total' && totalMes/m.valor_meta < 0.7)) ? 'Meta de vendas abaixo de 70% — intensifique as ações de venda e marketing!' : 'Vamos no caminho certo! Mantenha o foco.'}`;
    } else {
      resposta = `🎯 Nenhuma meta definida para este mês.\n\n💡 Recomendação: Vá em "Metas/Objetivos" e clique em "Sugerir Metas com IA" — eu analiso os últimos 3 meses e sugiro metas realistas com +15% de crescimento.`;
    }
  } else if (msg.includes('financeiro') || msg.includes('conta') || msg.includes('pagar') || msg.includes('dinheiro') || msg.includes('caixa')) {
    resposta = `💰 Análise Financeira:\n\n• Contas a vencer/vencidas: ${fmt(contasVencer)}\n• Caixa(s) aberto(s): ${(DB.caixas || []).filter(c => c.status === 'aberto').length}\n• Tesouraria: ${(DB.tesouraria || []).some(t => t.status === 'aberta' && t.data === hojeStr) ? 'ABERTA' : 'FECHADA'}\n• Boletos pendentes: ${(DB.boletos || []).filter(b => b.status === 'pendente').length}\n\n💡 Recomendação: ${contasVencer > 0 ? 'Existem contas a vencer! Priorize os pagamentos para evitar juros.' : 'Financeiro em dia! Ótimo controle.'}`;
  } else if (msg.includes('rh') || msg.includes('funcionario') || msg.includes('ponto') || msg.includes('funcionário')) {
    resposta = `👥 RH e Equipe:\n\n• Funcionários ativos: ${(DB.funcionarios || []).filter(f => f.status === 'ATIVO').length}\n• Ponto incompleto hoje: ${pontoIncompleto} registro(s)\n• Férias programadas: ${(DB.ferias || []).filter(f => f.status === 'aprovada').length}\n\n💡 Recomendação: ${pontoIncompleto > 0 ? 'Há ponto(s) incompleto(s)! Verifique com os funcionários o motivo.' : 'Ponto em dia! Bom controle de jornada.'}`;
  } else if (msg.includes('ifood') || msg.includes('delivery') || msg.includes('pedido')) {
    const pedidosIfood = (DB.pedidos_site || []).filter(p => p.origem === 'ifood');
    resposta = `🛵 Delivery / iFood:\n\n• Pedidos iFood totais: ${pedidosIfood.length}\n• Status da integração: ${(DB.ifood_config || {}).conectado ? 'CONECTADO' : 'NÃO CONECTADO'}\n\n💡 Recomendação: ${(DB.ifood_config || {}).conectado ? 'Integração ativa! Acompanhe os pedidos em tempo real.' : 'Conecte o iFood no menu "Integração iFood" para receber pedidos automáticos no PDV.'}`;
  } else if (msg.includes('dica') || msg.includes('recomenda') || msg.includes('sugest') || msg.includes('melhorar') || msg.includes('aumentar')) {
    resposta = `🚀 5 Recomendações da Meta IA para hoje:\n\n1. 📈 ${totalHoje < 500 ? 'Ative promoção de combo (picolé + açaí) para impulsionar vendas.' : 'Mantenha o ritmo — upsell de complementos aumenta ticket médio.'}\n2. 📦 ${estoqueBaixo.length ? `Reabasteça ${estoqueBaixo.length} produto(s) com estoque baixo.` : 'Estoque OK — verifique validades (FEFO).'}\n3. 💰 ${contasVencer > 0 ? `Pague contas a vencer (${fmt(contasVencer)}) para evitar juros.` : 'Financeiro em dia.'}\n4. 👥 ${pontoIncompleto > 0 ? `Regularize ${pontoIncompleto} ponto(s) incompleto(s).` : 'Ponto em dia.'}\n5. 🎯 ${metas.length ? 'Acompanhe o progresso das metas no menu "Metas/Objetivos".' : 'Defina metas do mês com IA — clique em "Sugerir Metas com IA".'}`;
  } else if (msg.includes('relatorio') || msg.includes('relatório') || msg.includes('resumo') || msg.includes('geral')) {
    resposta = `📋 Resumo Geral do Negócio:\n\n💰 Vendas hoje: ${fmt(totalHoje)}\n📊 Vendas do mês: ${fmt(totalMes)}\n🍦 Picolés no mês: ${picolesMes}\n🎫 Ticket médio: ${fmt(ticketMedio)}\n📦 Estoque baixo: ${estoqueBaixo.length} item(ns)\n💸 Contas a vencer: ${fmt(contasVencer)}\n👥 Ponto incompleto: ${pontoIncompleto}\n🎯 Metas ativas: ${metas.length}\n\n💡 Peça uma "dica" para recomendações específicas!`;
  } else if (msg.includes('como') || msg.includes('ajuda') || msg.includes('duvida') || msg.includes('dúvida') || msg.includes('instru') || msg.includes('tutorial') || msg.includes('passo a passo') || msg.includes('como faço') || msg.includes('como faz') || msg.includes('usar') || msg.includes('operar')) {
    // MODO AJUDA — como operar o sistema
    if (msg.includes('caixa') || msg.includes('pdv') || msg.includes('abrir caixa') || msg.includes('fechar caixa')) {
      resposta = `📖 COMO ABRIR/FECHAR O CAIXA:\n\n1️⃣ Acesse o menu "Caixa / PDV"\n2️⃣ Clique em "Abrir Caixa" (a Tesouraria deve estar aberta antes!)\n3️⃣ Informe o fundo de troco\n4️⃣ Para fechar: clique em "Fechar Caixa" → confira o valor → confirme\n\n⚠️ Regra: O caixa SÓ abre se a Tesouraria estiver aberta. E o dia SÓ termina quando ambos estiverem fechados.\n\n💡 Dica: Venda sem comanda, remessa, sangria e estorno pedem senha do ADMINISTRADOR.`;
    } else if (msg.includes('venda') || msg.includes('vender') || msg.includes('pdv venda')) {
      resposta = `📖 COMO FAZER UMA VENDA:\n\n1️⃣ Menu "Caixa / PDV"\n2️⃣ Escolha o modo: Balcão (direto) ou Comanda (QR code)\n3️⃣ Adicione os produtos (digite o código ou selecione da lista)\n4️⃣ Para produtos por peso (açaí/buffet): use o campo "Peso (kg)" — o valor calcula automático\n5️⃣ Escolha a forma de pagamento (Dinheiro, Cartão, iFood, Pix)\n6️⃣ Clique em "Finalizar Venda" → imprime cupom e baixa estoque automático\n\n💡 Dica: Clientes com cadastro ganham pontos de fidelidade automaticamente!`;
    } else if (msg.includes('produto') || msg.includes('cadastrar produto') || msg.includes('sabor')) {
      resposta = `📖 COMO CADASTRAR PRODUTOS/SABORES:\n\n1️⃣ Menu "Produtos" → "Novo Produto"\n2️⃣ Preencha: nome, sabor, categoria (Sorvete/Picolé/Açaí/Bebida/Insumo)\n3️⃣ Preço de venda e custo\n4️⃣ Se for por peso (açaí/buffet): informe "Preço por kg"\n5️⃣ Marque "Produção própria" se for feito na matriz\n6️⃣ Defina estoque mínimo\n7️⃣ Salve!\n\n💡 Dica: Cadastre também os insumos (leite, açúcar, embalagens) para controle de produção.`;
    } else if (msg.includes('producao') || msg.includes('produção') || msg.includes('ficha tecnica') || msg.includes('ficha técnica') || msg.includes('ordem de servico') || msg.includes('os')) {
      resposta = `📖 COMO USAR A PRODUÇÃO:\n\n📋 FICHA TÉCNICA (menu "Fichas Técnicas"):\n• Cadastre cada sabor com ingredientes, quantidades e tempos\n• Tempos: produção + embalagem + acondicionamento em caixas\n\n📋 ORDEM DE SERVIÇO (menu "Ordens de Serviço"):\n• Crie uma OS para cada lote a produzir\n• Delegue para um funcionário específico\n• Acompanhe status: pendente → em andamento → concluída\n\n📋 PRODUÇÃO (menu "Produção/Insumos"):\n• Simule antes de produzir (verifica se falta insumo)\n• Confirme a produção → estoque atualizado automático\n\n💡 Dica: Use a calculadora de produção para saber exatamente quanto de cada insumo vai precisar!`;
    } else if (msg.includes('cliente') || msg.includes('fidelidade') || msg.includes('cadastrar cliente')) {
      resposta = `📖 COMO CADASTRAR CLIENTES E FIDELIDADE:\n\n1️⃣ Menu "Clientes + Fidelidade" → "Novo Cliente"\n2️⃣ Nome, telefone, WhatsApp, e-mail\n3️⃣ Salve — a conta fidelidade é criada automaticamente\n4️⃣ A cada compra, o cliente ganha 1 ponto por R$ 1 gasto\n5️⃣ No menu "Clientes" você pode ajustar pontos (resgatar prêmios)\n\n💡 Dica: Clientes com mais de R$ 500 gastos são marcados como VIP no CRM!`;
    } else if (msg.includes('ponto') || msg.includes('rh') || msg.includes('funcionario') || msg.includes('funcionário') || msg.includes('ferias') || msg.includes('férias') || msg.includes('holerite') || msg.includes('13')) {
      resposta = `📖 COMO USAR O RH:\n\n⏰ PONTO (menu "Ponto"):\n• Funcionário registra entrada/saída/almoço\n• Horas extras e saldo calculam automático\n• Ponto incompleto gera alerta (só ADMIN pode acertar)\n• Abono/gancho: ajuste de horas com justificativa\n\n🌴 FÉRIAS E 13º (menu "Férias/13º"):\n• Registre férias — 1/3 constitucional calculado automático\n• 13º proporcional por meses trabalhados\n\n📄 HOLERITES (menu "Holerites"):\n• INSS, IRRF, FGTS, PIS/COFINS calculados\n• Salve ou exporte para Word\n\n⚖️ RESCISÃO (menu "Rescisão Simulada"):\n• Simule o valor da rescisão antes de demitir\n\n💡 Dica: Documentos (atestado, contrato, PIS) digitalize no menu "Documentos RH".`;
    } else if (msg.includes('remessa') || msg.includes('filial') || msg.includes('matriz') || msg.includes('malote') || msg.includes('controle matriz')) {
      resposta = `📖 COMO FUNCIONA MATRIZ → FILIAL:\n\n🔑 CONTROLE MATRIZ (menu "Controle Matriz"):\n• A Matriz ABRE o sistema — só assim as filiais operam\n• Se a Matriz fechar, filiais bloqueiam (exceto Ponto e PDV Emergencial)\n\n📦 REMESSAS (menu "Remessas p/ Filial"):\n• Crie remessa de produtos acabados, valores (dinheiro) ou malote (documentos)\n• A filial recebe e confere (assinatura do recebedor)\n\n🚨 PDV EMERGENCIAL:\n• Se cair a internet ou Matriz fechar, use o PDV Emergencial\n• Registra as vendas offline e sincroniza depois\n\n💡 Dica: O log de bloqueios mostra todas as tentativas de acesso das filiais quando a Matriz está fechada.`;
    } else if (msg.includes('nota fiscal') || msg.includes('nf') || msg.includes('boleto') || msg.includes('banco') || msg.includes('imposto') || msg.includes('nfe')) {
      resposta = `📖 COMO USAR NOTA FISCAL, BOLETOS E BANCOS:\n\n🧾 NOTA FISCAL (menu "Notas Fiscais"):\n• Emitir NF para qualquer venda/pedido\n• Imposto calculado em 3 regimes: Simples Nacional (6%), Lucro Presumido (12%), Lucro Real (15%)\n• Imprima a DANFE\n\n💳 BOLETOS (menu "Boletos / Bancos"):\n• Gere boleto automático para clientes a prazo\n• Acompanhe: pagos, pendentes, vencidos\n• 2ª via com 1 clique\n• Sincronize com o banco para conciliação automática\n\n💡 Dica: Clientes que pagam a prazo (faturado) — gere o boleto já na venda!`;
    } else if (msg.includes('ifood') || msg.includes('delivery') || msg.includes('whatsapp') || msg.includes('bot') || msg.includes('site') || msg.includes('integracao') || msg.includes('integração')) {
      resposta = `📖 COMO INTEGRAR IFOOD, WHATSAPP E SITE:\n\n🍔 IFOOD (menu "Integração iFood"):\n• Coloque seu Client ID, Client Secret e Merchant ID\n• Clique em "Conectar" — pedidos chegam automáticos no PDV\n\n💬 WHATSAPP BOT (menu "Config. do Bot"):\n• Cadastre regras (palavras-chave → resposta automática)\n• Conecte via Evolution API/Z-API/Twilio apontando para /api/bot/webhook\n• Já vem com 6 regras: sabores, picolés, preços, horários, eventos, delivery\n\n📱 SITE DOS CLIENTES:\n• Acesse /site — cardápio, carrinho, chatbot e botão WhatsApp\n• Compartilhe o link no Instagram/WhatsApp\n\n💡 Dica: O site e o bot funcionam mesmo sem configuração — é só acessar!`;
    } else if (msg.includes('estoque') || msg.includes('entrada') || msg.includes('saida') || msg.includes('saída') || msg.includes('lote') || msg.includes('validade')) {
      resposta = `📖 COMO CONTROLAR ESTOQUE:\n\n📦 MENU "Estoque":\n• Veja saldo atual de todos os produtos\n• Lotes e validades registrados\n• Alerta de estoque baixo (abaixo do mínimo)\n\n📥 ENTRADA: recebimento de fornecedores → atualiza saldo e custo\n📤 SAÍDA: ajustes, perdas, transferências\n\n🔄 MOVIMENTAÇÕES (menu "Movimentações"):\n• Histórico completo de entrada e saída\n\n💡 Dica: Na venda, o estoque baixa AUTOMATICAMENTE. Na produção confirmada, o produto acabado entra no estoque e os insumos saem.`;
    } else if (msg.includes('patrimonio') || msg.includes('patrimônio') || msg.includes('imovel') || msg.includes('imóvel') || msg.includes('aluguel') || msg.includes('mudanca') || msg.includes('mudança')) {
      resposta = `📖 COMO USAR PATRIMÔNIO E IMÓVEIS:\n\n🪑 PATRIMÔNIO (menu "Patrimônio"):\n• Cadastre freezers, geladeiras, balcões, cadeiras, mesas, lâmpadas\n• Cada item recebe código de etiqueta automático\n• Transferência entre unidades (Matriz ↔ Filial)\n• Checklist de mudança: gera lista de todos os itens da loja quando for trocar de endereço\n\n🏢 IMÓVEIS (menu "Imóveis/Aluguel"):\n• Cadastre o endereço alugado, valor do aluguel, vencimento, dados do proprietário\n• Controle de contrato de aluguel\n\n💡 Dica: Em caso de mudança, o checklist de saída garante que nada ficou para trás!`;
    } else if (msg.includes('evento') || msg.includes('festa') || msg.includes('aniversario') || msg.includes('aniversário') || msg.includes('empresa') || msg.includes('confraternizacao')) {
      resposta = `📖 COMO USAR EVENTOS E FESTAS:\n\n🎉 MENU "Eventos / Festas":\n• Cadastre orçamentos para aniversários, festas de empresa, confraternizações de fim de ano\n• Informe: data, horário, local, número de convidados, itens do pedido\n• Acompanhe status: orçamento → confirmado → realizado\n• Gere orçamento em Word (1 clique) para enviar ao cliente\n\n💡 Dica: O site dos clientes tem botão de "Solicitar Orçamento de Evento" — os pedidos chegam direto aqui!`;
    } else if (msg.includes('email') || msg.includes('excel') || msg.includes('word') || msg.includes('exportar') || msg.includes('relatorio') || msg.includes('relatório')) {
      resposta = `📖 COMO USAR EMAIL, EXCEL E WORD:\n\n📧 EMAIL (menu "Email/Excel/Word"):\n• Envie NF, boletos e orçamentos por e-mail direto do sistema\n• Funciona com Outlook (smtp.office365.com) e Gmail (smtp.gmail.com)\n• Configure as variáveis SMTP no Render\n\n📊 EXCEL:\n• Exporte Vendas, Estoque, Financeiro, Clientes e RH para .xlsx\n• Abra direto no Excel com formatação pronta\n\n📝 WORD:\n• Gere Orçamento de Evento, Contrato de Prestação, Holerite e Relatório de Vendas em .doc\n• Edite no Word como quiser\n\n💡 Dica: Todos os relatórios são gerados com 1 clique!`;
    } else if (msg.includes('primeiro') || msg.includes('inicio') || msg.includes('início') || msg.includes('primeiro acesso') || msg.includes('comecar') || msg.includes('começar') || msg.includes('configurar')) {
      resposta = `📖 PRIMEIROS PASSOS NO SISTEMA:\n\n1️⃣ FAÇA LOGIN: SV-2026-0001 / 123\n2️⃣ CADASTRE PRODUTOS (menu "Produtos") — sorvetes, picolés, açaí, bebidas, insumos\n3️⃣ CADASTRE FUNCIONÁRIOS (menu "Funcionários")\n4️⃣ CADASTRE CLIENTES (menu "Clientes")\n5️⃣ ABRA A TESOURARIA (menu "Tesouraria")\n6️⃣ ABRA O CAIXA (menu "Caixa / PDV")\n7️⃣ COMECE A VENDER! 🎉\n\nDepois: cadastre fichas técnicas, fornecedores, patrimônio e configure o iFood/WhatsApp.\n\n💡 Dica: Acesse o menu "Metas/Objetivos" e deixe a IA sugerir suas primeiras metas!`;
    } else {
      resposta = `📖 MENU DE AJUDA — O que você quer aprender?\n\nEscolha um tópico (digite a palavra-chave):\n\n• "caixa" → como abrir/fechar caixa e PDV\n• "venda" → como fazer uma venda\n• "produto" → como cadastrar produtos/sabores\n• "produção" → fichas técnicas, ordens de serviço, produção\n• "cliente" → cadastro e fidelidade\n• "ponto" / "rh" → ponto, férias, holerite, rescisão\n• "remessa" / "matriz" → controle matriz-filial\n• "nota fiscal" / "boleto" → NF, boletos, bancos\n• "ifood" / "whatsapp" → integrações e site\n• "estoque" → controle de estoque e lotes\n• "patrimônio" → bens e imóveis alugados\n• "evento" → festas e orçamentos\n• "excel" / "word" → exportações\n• "primeiro acesso" → primeiros passos\n\nOu pergunte qualquer coisa específica!`;
    }
  } else if (msg.includes('corrigir') || msg.includes('ortografia') || msg.includes('gramática') || msg.includes('gramatica') || msg.includes('revisar') || msg.includes('erro de portugues') || msg.includes('erro de português') || msg.includes('texto') || msg.includes('redigir') || msg.includes('escrever')) {
    // MODO CORRETOR ORTOGRÁFICO
    if (msg.includes('corrigir') || msg.includes('revisar') || msg.includes('ortografia') || msg.includes('gramática') || msg.includes('gramatica')) {
      // Extrai o texto após a palavra "corrigir:" ou "revisar:" se houver
      const texto = req.body.mensagem.replace(/^(corrigir|revisar|ortografia|gram[áa]tica)[:\s]*/i, '').trim();
      if (texto && texto.length > 10) {
        // Correções comuns em português (simplificado)
        let corrigido = texto
          .replace(/\bvc\b/gi, 'você').replace(/\bvcs\b/gi, 'vocês')
          .replace(/\bq\b/gi, 'que').replace(/\bn\b/gi, 'não')
          .replace(/\btb\b/gi, 'também').replace(/\btbm\b/gi, 'também')
          .replace(/\bmsg\b/gi, 'mensagem').replace(/\bvcê\b/gi, 'você')
          .replace(/\bvoce\b/gi, 'você').replace(/\bnão\b/g, 'não')
          .replace(/\s+/g, ' ').trim();
        // Capitaliza primeira letra
        corrigido = corrigido.charAt(0).toUpperCase() + corrigido.slice(1);
        if (!/[.!?]$/.test(corrigido)) corrigido += '.';
        resposta = `📝 CORRETOR ORTOGRÁFICO\n\n📄 Texto original:\n"${texto}"\n\n✅ Texto corrigido:\n"${corrigido}"\n\n💡 Dicas:\n• Evite abreviações (vc → você, q → que, tb → também) em comunicações oficiais\n• Sempre comece frases com letra maiúscula\n• Termine com ponto final\n• Para redes sociais, use emojis com moderação\n\nQuer que eu revise outro texto? É só enviar!`;
      } else {
        resposta = `📝 CORRETOR ORTOGRÁFICO\n\nEnvie o texto que quer corrigir começando com "corrigir:"\n\nExemplo:\n"corrigir: hj nos temos sorvete de morango e picole de chocolate em promocao"\n\nEu corrijo ortografia, gramática, abreviações e dou dicas de redação para:\n• Mensagens para clientes\n• Posts de redes sociais\n• Orçamentos e contratos\n• Comunicados internos\n• Cardápios e etiquetas`;
      }
    } else {
      resposta = `📝 CORRETOR ORTOGRÁFICO\n\nComo usar: digite "corrigir:" seguido do seu texto.\n\nExemplo:\n"corrigir: hj tem sorvete de morango em promoçao"\n\nEu corrijo e devolvo pronto para usar! ✅`;
    }
  } else if (msg.includes('lei') || msg.includes('legislação') || msg.includes('legislacao') || msg.includes('anvisa') || msg.includes('vigilância') || msg.includes('vigilancia') || msg.includes('sanitária') || msg.includes('sanitaria') || msg.includes('alvará') || msg.includes('alvara') || msg.includes('licença') || msg.includes('licenca') || msg.includes('rotulagem') || msg.includes('rotulo') || msg.includes('rótulo') || msg.includes('cnpj') || msg.includes('mei') || msg.includes('simples nacional') || msg.includes('trabalhista') || msg.includes('clt') || msg.includes('imposto') || msg.includes('taxa') || msg.includes('alimentícia') || msg.includes('alimenticia') || msg.includes('manipulação') || msg.includes('manipulacao') || msg.includes('higiene')) {
    // MODO LEGISLAÇÃO COMERCIAL E FABRICAÇÃO
    if (msg.includes('anvisa') || msg.includes('vigilância') || msg.includes('vigilancia') || msg.includes('sanitária') || msg.includes('sanitaria') || msg.includes('alvará') || msg.includes('alvara') || msg.includes('licença') || msg.includes('licenca')) {
      resposta = `⚖️ LEGISLAÇÃO SANITÁRIA (ANVISA / VIGILÂNCIA SANITÁRIA)\n\n📋 Para sorveterias, açaíterias e fábricas de picolé:\n\n1️⃣ ALVARÁ SANITÁRIO (Vigilância Sanitária Municipal)\n• Obrigatório para qualquer estabelecimento que manipule alimentos\n• Solicite na Prefeitura/Secretaria de Saúde\n• Válido por 1-2 anos (renovar)\n\n2️⃣ PROGRAMA DE AUTOCONTROLE (RDC ANVISA 216/2004)\n• Manual de Boas Práticas de Fabricação (BPF)\n• Procedimentos Operacionais Padronizados (POPs)\n• Higiene dos manipuladores (uniforme, touca, luvas)\n• Controle de temperatura (freezers ≤ -18°C, balcão açaí ≤ -12°C)\n• Controle de pragas (dedetização periódica)\n• Água potável e destinação de resíduos\n\n3️⃣ MANIPULADORES DE ALIMENTOS\n• Curso de manipulação de alimentos (obrigatório)\n• Exame médico periódico\n• Não trabalhar com doenças transmissíveis\n\n4️⃣ ESTRUTURA FÍSICA\n• Piso, parede e teto laváveis\n• Área de produção separada do atendimento\n• Pia para higienização de mãos (com sabonete líquido e papel toalha)\n• Freezers com termômetro\n\n💡 Dica: A Vigilância Sanitária faz inspeções surpresa. Mantenha o BPF e os POPs atualizados!`;
    } else if (msg.includes('rotulagem') || msg.includes('rotulo') || msg.includes('rótulo') || msg.includes('etiqueta') || msg.includes('informação nutricional') || msg.includes('informacao nutricional')) {
      resposta = `⚖️ ROTULAGEM DE ALIMENTOS (RDC ANVISA 429/2020 e 135/2022)\n\n📋 O que deve ter no rótulo/etiqueta dos picolés e sorvetes:\n\n1️⃣ DENOMINAÇÃO DO PRODUTO (ex: "Picolé de Chocolate")\n2️⃣ LISTA DE INGREDIENTES (ordem decrescente)\n3️⃣ CONTEÚDO LÍQUIDO (peso/volume)\n4️⃣ IDENTIFICAÇÃO DO FABRICANTE (nome, CNPJ, endereço)\n5️⃣ LOTE E DATA DE VALIDADE\n• Picolés/sorvetes: validade geral 3-6 meses (consulte técnico)\n6️⃣ INFORMAÇÃO NUTRICIONAL (tabela)\n• Valor energético, carboidratos, proteínas, gorduras totais/saturadas/trans, fibras, sódio\n7️⃣ ALEGRIA (alérgicos): contém leite, soja, glúten?\n8️⃣ NOVO (2022+): selo de advertência na frente (alto em açúcar, gordura saturada, sódio)\n\n💡 Dica: Para venda a granel (balcão), tenha as informações disponíveis em painel ou etiqueta. Para picolés embalados, o rótulo completo é obrigatório.`;
    } else if (msg.includes('mei') || msg.includes('cnpj') || msg.includes('simples nacional') || msg.includes('imposto') || msg.includes('taxa') || msg.includes('regime')) {
      resposta = `⚖️ LEGISLAÇÃO COMERCIAL E TRIBUTÁRIA\n\n🏢 EMPRESA:\n• MEI (Microempreendedor Individual): até R$ 81 mil/ano — ideal para início\n• Microempresa (ME): até R$ 360 mil/ano\n• Empresa de Pequeno Porte (EPP): até R$ 4,8 milhões/ano\n\n📊 REGIMES TRIBUTÁRIOS:\n1️⃣ SIMPLES NACIONAL — 6% a 15,5% (faturamento)\n• Unifica 8 impostos (IR, CSLL, PIS, COFINS, ICMS, ISS, INSS patronal)\n• Ideal para sorveterias de pequeno/médio porte\n2️⃣ LUCRO PRESUMIDO — 12% sobre receita bruta\n3️⃣ LUCRO REAL — 15% sobre lucro real\n\n⚠️ O sistema calcula NF nos 3 regimes automaticamente!\n\n📝 OBRIGAÇÕES ACESSÓRIAS:\n• EFD-ICMS/IPI, EFD-Contribuições (PIS/COFINS)\n• DCTFWeb (folha)\n• eSocial (folha de pagamento)\n• ECD (contábil) e ECF (fiscal)\n\n💡 Dica: Para picolés/sorvetes, alíquota de ICMS geralmente 7-12% (varia por estado). Consulte um contador especializado em alimentação!`;
    } else if (msg.includes('trabalhista') || msg.includes('clt') || msg.includes('funcionario') || msg.includes('funcionário') || msg.includes('salario') || msg.includes('salário') || msg.includes('hora extra') || msg.includes('ferias') || msg.includes('férias') || msg.includes('demissão') || msg.includes('demissao')) {
      resposta = `⚖️ LEGISLAÇÃO TRABALHISTA (CLT)\n\n👥 Para funcionários de sorveteria/caixa/entregador:\n\n1️⃣ CARTEIRA ASSINADA (CLT)\n• Registro em até 1 dia de admissão\n• Salário mínimo ou piso da categoria (Sindicato de Comércio)\n\n2️⃣ JORNADA\n• 8h/dia, 44h/semana (máximo)\n• Hora extra: mínimo +50% (art. 59 CLT)\n• Intervalo intrajornada: 1-2h (para +6h)\n\n3️⃣ ADICIONAIS\n• Noturno (22h-5h): +20%\n• Insalubridade (freezers/câmara fria): 10-40%\n• Periculosidade: 30% (se aplicável)\n\n4️⃣ FÉRIAS + 1/3 (art. 139 CLT)\n• 30 dias após 12 meses de trabalho\n• +1/3 constitucional\n\n5️⃣ DÉCIMO TERCEIRO (13º)\n• Proporcional aos meses trabalhados\n• 1ª parcela até 30/11, 2ª até 20/12\n\n6️⃣ RESCISÃO\n• Aviso prévio: 30 dias (proporcional por ano)\n• FGTS: 8% sobre salário (multa 40% em demissão sem justa causa)\n• Seguro-desemprego (se demitido sem justa causa)\n\n💡 Dica: O sistema RH já calcula férias+1/3, 13º proporcional, holerite com INSS/IRRF/FGTS e simula rescisão!`;
    } else if (msg.includes('meio ambiente') || msg.includes('meio-ambiente') || msg.includes('resíduo') || msg.includes('residuo') || msg.includes('descarte') || msg.includes('embalagem') || msg.includes('reciclavel') || msg.includes('reciclável')) {
      resposta = `⚖️ MEIO AMBIENTE E EMBALAGENS\n\n🌱 Para sorveterias:\n\n1️⃣ POLÍTICA NACIONAL DE RESÍDUOS SÓLIDOS (Lei 12.305/2010)\n• Descarte correto de embalagens (copos, colheres, embalagens de picolé)\n• Separar recicláveis (papel, plástico) do orgânico\n• Não descarte óleo/insumos na rede de esgoto\n\n2️⃣ EMBALAGENS\n• Copos e colheres: preferencialmente recicláveis ou biodegradáveis\n• Embalagem de picolé: madeira (palito) + plástico — separar para reciclagem\n• Muitas cidades proíbem canudos e sacolas plásticas — verifique legislação municipal\n\n3️⃣ ENERGIA\n• Freezers e geladeiras são os maiores consumidores — escolha selo Procel A\n• Manter borracha de vedação em dia economiza até 30% de energia\n\n💡 Dica: Ofereça desconto para clientes que trazem o próprio copo/embalagem — além de sustentável, fideliza!`;
    } else {
      resposta = `⚖️ LEGISLAÇÃO COMERCIAL E FABRICAÇÃO\n\nSou sua consultora jurídica! Pergunte sobre:\n\n🏥 SANITÁRIA: "anvisa", "vigilância sanitária", "alvará", "higiene"\n🏷️ ROTULAGEM: "rótulo", "etiqueta", "informação nutricional", "validade"\n💰 TRIBUTÁRIA: "MEI", "CNPJ", "Simples Nacional", "imposto", "regime"\n👥 TRABALHISTA: "CLT", "hora extra", "férias", "13º", "rescisão", "FGTS"\n🌱 MEIO AMBIENTE: "embalagem", "reciclagem", "resíduos"\n\nO que quer saber?`;
    }
  } else {
    resposta = `Olá! Eu sou a META IA, sua assistente completa. 🤖\n\nTenho 4 modos:\n📊 DADOS — vendas, estoque, metas, financeiro\n📖 AJUDA — como usar o sistema (pergunte "como...")\n📝 CORRETOR — digite "corrigir:" + texto\n⚖️ LEGISLAÇÃO — ANVISA, rotulagem, impostos, CLT\n\nO que deseja?`;
  }
  
  DB.meta_ia_log = DB.meta_ia_log || [];
  DB.meta_ia_log.push({ id: nextId('meta_ia_log'), mensagem: req.body.mensagem, resposta, data: agora() });
  saveDB();
  res.json({ resposta });
});
app.get('/api/meta-ia/historico', (req, res) => res.json({ historico: (DB.meta_ia_log || []).slice(-20).reverse() }));

// ===== NOTA FISCAL — CANCELAMENTO (integrado com vendas/PDV) =====
app.post('/api/nf/cancelar', async (req, res) => {
  const { nf_id, motivo, senha_adm } = req.body;
  if (!senha_adm) return res.json({ erro: 'Cancelamento de NF exige senha do administrador' });
  const adm = (DB.funcionarios || []).find(f => f.senha_hash === senha_adm && f.role === 'admin');
  if (!adm) return res.json({ erro: 'Senha de administrador inválida' });
  const nf = (DB.notas_fiscais || []).find(n => n.id == nf_id);
  if (!nf) return res.json({ erro: 'NF não encontrada' });
  if (nf.status === 'cancelada') return res.json({ erro: 'NF já está cancelada' });
  nf.status = 'cancelada'; nf.motivo_cancelamento = motivo; nf.cancelada_por = adm.nome; nf.cancelada_em = agora();
  const venda = (DB.vendas || []).find(v => v.id == nf.origem_id);
  if (venda) { venda.status = 'ESTORNADA'; venda.motivo_estorno = 'NF cancelada: ' + motivo; }
  saveDB();
  res.json({ sucesso: true, mensagem: 'NF ' + nf.numero + ' cancelada! Venda estornada.' });
});
app.get('/api/nf/cupom/:id', (req, res) => {
  const nf = (DB.notas_fiscais || []).find(n => n.id == req.params.id);
  if (!nf) return res.status(404).json({ erro: 'NF não encontrada' });
  res.json({ cupom: { ...nf, danfe: 'DANFE gerada — código: ' + (nf.chave_acesso || 'SEM-CHAVE'), prefeitura_integrado: true } });
});

// ===== CHAMADOS / HELP DESK =====
app.get('/api/chamados/lista', (req, res) => {
  const chamados = (DB.chamados || []).slice(-50).reverse().map(c => ({
    ...c,
    aberto_por_nome: ((DB.funcionarios || []).find(f => f.id === c.aberto_por_id) || {}).nome,
    responsavel_nome: ((DB.funcionarios || []).find(f => f.id === c.responsavel_id) || {}).nome
  }));
  res.json({ chamados });
});
app.post('/api/chamados/abrir', (req, res) => {
  const protocolo = 'CHM-' + new Date().getFullYear() + '-' + String((DB.chamados || []).length + 1).padStart(5, '0');
  DB.chamados = DB.chamados || [];
  DB.chamados.push({ id: nextId('chamados'), protocolo, ...req.body, status: 'aberto', prioridade: req.body.prioridade || 'media', aberto_em: agora(), tratativas: [], devolutivas: [] });
  saveDB();
  res.json({ sucesso: true, protocolo });
});
app.post('/api/chamados/tratativa', (req, res) => {
  const c = (DB.chamados || []).find(x => x.id == req.body.chamado_id);
  if (!c) return res.json({ erro: 'Chamado não encontrado' });
  c.tratativas = c.tratativas || [];
  c.tratativas.push({ id: nextId('tratativas'), ...req.body, data: agora() });
  c.status = req.body.finalizar ? 'fechado' : 'em_andamento';
  if (req.body.finalizar) c.fechado_em = agora();
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/chamados/devolutiva', (req, res) => {
  const c = (DB.chamados || []).find(x => x.id == req.body.chamado_id);
  if (!c) return res.json({ erro: 'Chamado não encontrado' });
  c.devolutivas = c.devolutivas || [];
  c.devolutivas.push({ id: nextId('devolutivas'), ...req.body, data: agora(), enviada_para: req.body.enviada_para || 'cliente' });
  saveDB();
  res.json({ sucesso: true, mensagem: 'Devolutiva registrada!' });
});

// ===== PROTOCOLO DE ENTREGAS =====
app.get('/api/protocolo-entregas/lista', (req, res) => {
  const protocolos = (DB.protocolos_entrega || []).slice(-50).reverse().map(p => ({
    ...p,
    entregador_nome: ((DB.funcionarios || []).find(f => f.id === p.entregador_id) || {}).nome
  }));
  res.json({ protocolos });
});
app.post('/api/protocolo-entregas/criar', (req, res) => {
  const protocolo = 'ENT-' + hoje().replace(/-/g, '') + '-' + String((DB.protocolos_entrega || []).length + 1).padStart(4, '0');
  DB.protocolos_entrega = DB.protocolos_entrega || [];
  DB.protocolos_entrega.push({ id: nextId('protocolos_entrega'), protocolo, ...req.body, status: 'pendente', criado_em: agora(), assinatura_recebedor: null });
  saveDB();
  res.json({ sucesso: true, protocolo });
});
app.post('/api/protocolo-entregas/confirmar', (req, res) => {
  const p = (DB.protocolos_entrega || []).find(x => x.protocolo === req.body.protocolo);
  if (!p) return res.json({ erro: 'Protocolo não encontrado' });
  p.status = 'entregue'; p.entregue_em = agora(); p.assinatura_recebedor = req.body.assinatura_recebedor || 'confirmado'; p.observacao_entrega = req.body.observacao || '';
  saveDB();
  res.json({ sucesso: true, mensagem: 'Entrega confirmada! Protocolo ' + p.protocolo });
});

// ===== CHECKLISTS AVANÇADOS (item a item com senha operador + ADM) =====
app.get('/api/checklists/modelos', (req, res) => {
  const modelos = [
    { id: 1, nome: 'Abertura de Loja', itens: ['Verificar temperatura freezers', 'Limpar balcão de atendimento', 'Conferir estoque de picolés', 'Abrir tesouraria', 'Abrir caixa', 'Testar impressora fiscal', 'Verificar validade dos produtos'] },
    { id: 2, nome: 'Fechamento de Loja', itens: ['Fechar caixa', 'Fechar tesouraria', 'Conferir valores no caixa', 'Limpar freezers', 'Desligar equipamentos', 'Trancar portas', 'Registrar ocorrências do dia'] },
    { id: 3, nome: 'Recebimento de Mercadoria', itens: ['Conferir nota fiscal do fornecedor', 'Verificar temperatura dos produtos', 'Conferir quantidades', 'Verificar validade', 'Inserir no estoque', 'Guardar em local correto', 'Assinar recebimento'] },
    { id: 4, nome: 'Transferência para Filial', itens: ['Conferir itens da remessa', 'Conferir valores/malote', 'Lacrar embalagem', 'Registrar protocolo', 'Assinar saída (operador)', 'Assinar saída (ADM)', 'Enviar para filial'] },
    { id: 5, nome: 'Mudança de Loja', itens: ['Etiquetar todos os móveis', 'Conferir freezers e geladeiras', 'Conferir balcões e cadeiras', 'Conferir equipamentos', 'Conferir lâmpadas', 'Gerar checklist de saída', 'Assinar conferência (operador + ADM)'] },
    { id: 6, nome: 'Evento/Festa', itens: ['Conferir sorvetes/picolés', 'Conferir freezers portáteis', 'Conferir embalagens', 'Verificar tempo de deslocamento', 'Confirmar com cliente', 'Separar uniformes', 'Checklist de retorno'] },
    { id: 7, nome: 'Higiene ANVISA', itens: ['Verificar uniformes', 'Verificar toucas e luvas', 'Conferir temperatura freezers', 'Conferir limpeza', 'Verificar água potável', 'Conferir controle de pragas', 'Registrar BPF do dia'] }
  ];
  res.json({ modelos });
});
app.post('/api/checklist/iniciar', (req, res) => {
  const itens = (req.body.itens || []).map((texto, i) => ({ id: i + 1, texto, marcado: false, marcado_por: null, marcado_em: null }));
  const protocolo = 'CHK-' + hoje().replace(/-/g, '') + '-' + String((DB.checklists_exec || []).length + 1).padStart(4, '0');
  DB.checklists_exec = DB.checklists_exec || [];
  DB.checklists_exec.push({ id: nextId('checklists_exec'), protocolo, nome: req.body.nome || 'Checklist', itens, status: 'em_andamento', iniciado_por: req.body.funcionario_id || 1, iniciado_em: agora(), finalizado: false, aprovado: false });
  saveDB();
  res.json({ sucesso: true, protocolo, checklist_id: DB.checklists_exec[DB.checklists_exec.length - 1].id });
});
app.post('/api/checklist/marcar-item', (req, res) => {
  const { checklist_id, item_id, senha_operador, senha_adm } = req.body;
  if (!senha_operador) return res.json({ erro: 'Senha do operador obrigatória' });
  if (!senha_adm) return res.json({ erro: 'Senha do ADMINISTRADOR obrigatória' });
  const op = (DB.funcionarios || []).find(f => f.senha_hash === senha_operador);
  const adm = (DB.funcionarios || []).find(f => f.senha_hash === senha_adm && f.role === 'admin');
  if (!op) return res.json({ erro: 'Senha do operador inválida' });
  if (!adm) return res.json({ erro: 'Senha do administrador inválida' });
  const chk = (DB.checklists_exec || []).find(c => c.id == checklist_id);
  if (!chk) return res.json({ erro: 'Checklist não encontrado' });
  const item = (chk.itens || []).find(i => i.id == item_id);
  if (!item) return res.json({ erro: 'Item não encontrado' });
  item.marcado = true; item.marcado_por = op.nome + ' + ADM: ' + adm.nome; item.marcado_em = agora();
  saveDB();
  res.json({ sucesso: true, mensagem: 'Item marcado com confirmação dupla!' });
});
app.post('/api/checklist/finalizar', (req, res) => {
  const { checklist_id, senha_adm } = req.body;
  if (!senha_adm) return res.json({ erro: 'Finalizar exige senha do administrador' });
  const adm = (DB.funcionarios || []).find(f => f.senha_hash === senha_adm && f.role === 'admin');
  if (!adm) return res.json({ erro: 'Senha do administrador inválida' });
  const chk = (DB.checklists_exec || []).find(c => c.id == checklist_id);
  if (!chk) return res.json({ erro: 'Checklist não encontrado' });
  const pendentes = (chk.itens || []).filter(i => !i.marcado).length;
  if (pendentes > 0) return res.json({ erro: 'Ainda existem ' + pendentes + ' item(ns) sem confirmação dupla (operador + ADM).' });
  chk.finalizado = true; chk.aprovado = true; chk.status = 'finalizado_aprovado'; chk.finalizado_por = adm.nome; chk.finalizado_em = agora();
  saveDB();
  res.json({ sucesso: true, mensagem: 'Checklist finalizado e APROVADO por ' + adm.nome + '! Protocolo: ' + chk.protocolo });
});

// ===== UNIDADES (MATRIZ / FILIAL) — CRUD completo com nível de permissão =====
app.get('/api/unidades', (req, res) => {
  const unidades = (DB.unidades || []).map(u => ({
    ...u,
    nivel_permissao_label: ['', 'Apenas Ponto', 'Produção', 'Vendas', 'Supervisor', 'Gerente', 'Admin Total'][u.nivel_permissao || 1]
  }));
  res.json({ unidades });
});
app.post('/api/unidades/salvar', (req, res) => {
  DB.unidades = DB.unidades || [];
  const { id } = req.body;
  if (id) {
    const u = DB.unidades.find(x => x.id == id);
    if (u) Object.assign(u, req.body);
    else return res.json({ erro: 'Unidade não encontrada' });
  } else {
    DB.unidades.push({ id: nextId('unidades'), ...req.body, criado_em: agora() });
  }
  saveDB();
  res.json({ sucesso: true });
});
app.post('/api/unidades/excluir', (req, res) => {
  const u = (DB.unidades || []).find(x => x.id == req.body.id);
  if (u && u.tipo === 'matriz') return res.json({ erro: 'Não é possível excluir a Matriz!' });
  DB.unidades = (DB.unidades || []).filter(x => x.id != req.body.id);
  saveDB();
  res.json({ sucesso: true });
});

// ===== PERMISSÃO DE FUNCIONÁRIOS — aumentar/alterar nível =====
app.post('/api/funcionarios/permissao', (req, res) => {
  const { funcionario_id, nivel_permissao, senha_adm } = req.body;
  if (!senha_adm) return res.json({ erro: 'Alterar permissão exige senha do administrador' });
  const adm = (DB.funcionarios || []).find(f => f.senha_hash === senha_adm && f.role === 'admin');
  if (!adm) return res.json({ erro: 'Senha do administrador inválida' });
  const f = (DB.funcionarios || []).find(x => x.id == funcionario_id);
  if (!f) return res.json({ erro: 'Funcionário não encontrado' });
  f.nivel_permissao = Number(nivel_permissao);
  f.permissao_alterada_por = adm.nome;
  f.permissao_alterada_em = agora();
  saveDB();
  res.json({ sucesso: true, mensagem: 'Permissão de ' + f.nome + ' alterada para Nível ' + nivel_permissao + ' (' + ['', 'Apenas Ponto', 'Produção', 'Vendas', 'Supervisor', 'Gerente', 'Admin Total'][nivel_permissao] + ')' });
});

// ===== COMPRAS / PEDIDOS A FORNECEDORES =====
app.get('/api/compras/lista', (req, res) => res.json({ compras: (DB.compras || []).slice(-50).reverse() }));
app.post('/api/compras/criar', (req, res) => {
  DB.compras = DB.compras || [];
  const protocolo = 'CMP-' + hoje().replace(/-/g,'') + '-' + String(DB.compras.length+1).padStart(4,'0');
  DB.compras.push({ id: nextId('compras'), protocolo, ...req.body, status: 'pendente', criado_em: agora() });
  saveDB();
  res.json({ sucesso: true, protocolo });
});
app.post('/api/compras/receber', (req, res) => {
  const c = (DB.compras || []).find(x => x.id == req.body.compra_id);
  if (!c) return res.json({ erro: 'Compra não encontrada' });
  c.status = 'recebida'; c.recebido_em = agora(); c.observacao_recebimento = req.body.observacao || '';
  (c.itens || []).forEach(i => {
    DB.estoque = DB.estoque || [];
    let e = DB.estoque.find(x => x.produto_id == i.produto_id);
    if (e) e.qty = Number(e.qty||0) + Number(i.qty||0);
    else DB.estoque.push({ produto_id: i.produto_id, produto_nome: i.produto_nome, qty: Number(i.qty||0), valor_unitario: Number(i.valor_unitario||0), lote: 'CMP-'+c.id, validade: req.body.validade || null });
  });
  saveDB();
  res.json({ sucesso: true, mensagem: 'Compra '+c.protocolo+' recebida! Estoque atualizado.' });
});

// ===== DEVOLUÇÕES DE VENDA =====
app.get('/api/devolucoes/lista', (req, res) => res.json({ devolucoes: (DB.devolucoes || []).slice(-50).reverse() }));
app.post('/api/devolucoes/registrar', (req, res) => {
  DB.devolucoes = DB.devolucoes || [];
  const protocolo = 'DEV-' + hoje().replace(/-/g,'') + '-' + String(DB.devolucoes.length+1).padStart(4,'0');
  DB.devolucoes.push({ id: nextId('devolucoes'), protocolo, ...req.body, criado_em: agora() });
  const venda = (DB.vendas || []).find(v => v.id == req.body.venda_id);
  if (venda) {
    (req.body.itens || []).forEach(i => {
      DB.estoque = DB.estoque || [];
      let e = DB.estoque.find(x => x.produto_id == i.produto_id);
      if (e) e.qty = Number(e.qty||0) + Number(i.qty_devolvido||0);
    });
  }
  saveDB();
  res.json({ sucesso: true, protocolo, mensagem: 'Devolução registrada! Estoque estornado.' });
});

// ===== CONCILIAÇÃO BANCÁRIA =====
app.get('/api/banco/extrato/lista', (req, res) => res.json({ extrato: (DB.bank_statement || []).slice(-100).reverse() }));
app.post('/api/banco/extrato/importar', (req, res) => {
  DB.bank_statement = DB.bank_statement || [];
  const linhas = req.body.linhas || [];
  linhas.forEach(l => DB.bank_statement.push({ id: nextId('bank'), ...l, conciliado: false, importado_em: agora() }));
  saveDB();
  res.json({ sucesso: true, importadas: linhas.length });
});
app.post('/api/banco/conciliar', (req, res) => {
  const l = (DB.bank_statement || []).find(x => x.id == req.body.linha_id);
  if (!l) return res.json({ erro: 'Linha não encontrada' });
  l.conciliado = true; l.conciliado_em = agora(); l.conta_correspondente = req.body.conta_id || null;
  saveDB();
  res.json({ sucesso: true, mensagem: 'Linha conciliada!' });
});

// ===== FLUXO DE CAIXA FUTURO =====
app.get('/api/financeiro/fluxo-futuro', (req, res) => {
  const dias = Number(req.query.dias || 30);
  const hojeStr = hoje();
  const aReceber = (DB.contas || []).filter(c => c.tipo === 'receber' && c.status === 'ABERTO' && c.vencimento >= hojeStr);
  const aPagar = (DB.contas || []).filter(c => c.tipo === 'pagar' && c.status === 'ABERTO' && c.vencimento >= hojeStr);
  const projecao = [];
  for (let d = 0; d < dias; d++) {
    const data = new Date(); data.setDate(data.getDate() + d);
    const ds = data.toISOString().slice(0,10);
    const receber = aReceber.filter(c => c.vencimento === ds).reduce((s,c)=>s+Number(c.valor||0),0);
    const pagar = aPagar.filter(c => c.vencimento === ds).reduce((s,c)=>s+Number(c.valor||0),0);
    projecao.push({ data: ds, receber, pagar, saldo_projetado: receber - pagar });
  }
  res.json({ projecao, total_receber: aReceber.reduce((s,c)=>s+Number(c.valor||0),0), total_pagar: aPagar.reduce((s,c)=>s+Number(c.valor||0),0) });
});

// ===== AJUSTE DE ESTOQUE =====
app.post('/api/estoque/ajuste', (req, res) => {
  DB.estoque_ajustes = DB.estoque_ajustes || [];
  DB.estoque_ajustes.push({ id: nextId('ajustes'), ...req.body, criado_em: agora() });
  DB.estoque = DB.estoque || [];
  let e = DB.estoque.find(x => x.produto_id == req.body.produto_id);
  if (e) {
    e.qty = req.body.tipo === 'entrada' ? Number(e.qty||0) + Number(req.body.qty||0) : Number(e.qty||0) - Number(req.body.qty||0);
    e.ultimo_ajuste = agora();
  }
  saveDB();
  res.json({ sucesso: true, mensagem: 'Ajuste de estoque realizado!' });
});

// ===== LOG DE AUDITORIA =====
app.get('/api/auditoria/lista', (req, res) => res.json({ logs: (DB.audit_log || []).slice(-200).reverse() }));
function registrarAuditoria(acao, detalhes, usuario_id) {
  DB.audit_log = DB.audit_log || [];
  DB.audit_log.push({ id: nextId('audit'), acao, detalhes, usuario_id, data: agora() });
}

// ===== MANUTENÇÃO DE FROTA =====
app.get('/api/frota/manutencoes', (req, res) => res.json({ manutencoes: (DB.frota_manutencao || []).slice(-50).reverse() }));
app.post('/api/frota/manutencao/registrar', (req, res) => {
  DB.frota_manutencao = DB.frota_manutencao || [];
  DB.frota_manutencao.push({ id: nextId('manutencao'), ...req.body, status: req.body.status || 'concluida', criado_em: agora() });
  saveDB();
  res.json({ sucesso: true });
});

// ===== HEALTH CHECK =====
app.get('/api/health', (req, res) => res.json({ status: 'ok', sistema: DB.controle_sistema?.status_geral, banco: USAR_SUPABASE ? 'supabase' : 'local', hora: agora() }));

// ===== STARTUP (carrega Supabase antes de subir) =====
(async () => {
  await loadDB();
  app.listen(PORT, () => {
    console.log('🍦 Sorveteria ERP rodando na porta ' + PORT + ' | Banco: ' + (USAR_SUPABASE ? 'Supabase ✅' : 'Arquivo local (defina SUPABASE_URL e SUPABASE_KEY)'));
    console.log('   Dashboard: http://localhost:' + PORT + '/dashboard.html');
    console.log('   Site:      http://localhost:' + PORT + '/site.html');
    console.log('   Bot webhook: POST /api/bot/webhook');
  });
  // ==========================================
// 👤 FUNCIONÁRIOS COMPLETOS
// ==========================================

// Listar todos os funcionários com dados completos
app.get('/api/funcionarios/completo', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('funcionarios')
      .select(`
        id, nome, usuario, email, matricula, cargo,
        nivel_permissao, ativo, status, foto_url,
        unidade_tipo, data_admissao, telefone
      `)
      .order('nome');

    if (error) throw error;
    res.json({ sucesso: true, dados: data });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// Editar funcionário
app.put('/api/funcionarios/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const dados = req.body;
    const editado_por = req.headers['matricula'] || 'sistema';

    const { data, error } = await supabase
      .from('funcionarios')
      .update({
        ...dados,
        permissao_alterada_por: editado_por,
        permissao_alterada_em: new Date()
      })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json({ sucesso: true, dados: data[0] });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// Dados sensíveis (apenas nível 5 e 6)
app.get('/api/funcionarios/:id/sensiveis', async (req, res) => {
  try {
    const { id } = req.params;
    const usuarioNivel = parseInt(req.headers['nivel-permissao'] || 0);
    
    if (usuarioNivel < 5) {
      return res.status(403).json({ 
        sucesso: false, 
        erro: 'Acesso restrito a Gerente e Administrador' 
      });
    }

    const { data, error } = await supabase
      .from('funcionarios')
      .select('dados_sensiveis')
      .eq('id', id)
      .single();

    if (error) throw error;
    res.json({ sucesso: true, dados: data.dados_sensiveis });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// Trocar senha com validação de histórico
app.put('/api/funcionarios/:id/trocar-senha', async (req, res) => {
  try {
    const { id } = req.params;
    const { nova_senha } = req.body;

    // Busca usuário atual e últimas senhas
    const { data: func, error: eBusca } = await supabase
      .from('funcionarios')
      .select('senha_hash, ultimas_senhas')
      .eq('id', id)
      .single();

    if (eBusca) throw eBusca;

    // Verifica se nova senha é igual às 2 últimas
    if (func.ultimas_senhas?.includes(nova_senha)) {
      return res.status(400).json({
        sucesso: false,
        erro: 'A nova senha deve ser diferente das 2 últimas'
      });
    }

    // Atualiza guardando histórico
    const ultimas = [...(func.ultimas_senhas || []), func.senha_hash].slice(-2);

    const { error: eAtualiza } = await supabase
      .from('funcionarios')
      .update({
        senha_hash: nova_senha,
        ultimas_senhas: ultimas
      })
      .eq('id', id);

    if (eAtualiza) throw eAtualiza;
    res.json({ sucesso: true, mensagem: 'Senha alterada com sucesso' });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// ==========================================
// 💰 FOLHA DE PAGAMENTO
// ==========================================

// Gerar folha
app.post('/api/folha/gerar', async (req, res) => {
  try {
    const { competencia, funcionarios } = req.body;
    const resultados = [];

    for (const func of funcionarios) {
      // Cálculos automáticos
      const inss = Number((func.salario_base * 0.11).toFixed(2));
      const fgts = Number((func.salario_base * 0.08).toFixed(2));
      
      // Cálculo IRRF (simplificado — alíquota padrão)
      let irrf = 0;
      if (func.salario_base > 2826.66) {
        irrf = Number(((func.salario_base - 1903.98) * 0.15).toFixed(2));
      }

      const totalProventos = Number((
        func.salario_base + 
        (func.horas_extras || 0) + 
        (func.adicional_noturno || 0)
      ).toFixed(2));

      const totalDescontos = Number((
        inss + irrf + fgts + 
        (func.vr || 0) + (func.va || 0) + 
        (func.combustivel || 0) + (func.passagens || 0)
      ).toFixed(2));

      const liquido = Number((totalProventos - totalDescontos).toFixed(2));

      const { data, error } = await supabase
        .from('folha_pagamento')
        .insert({
          funcionario_id: func.id,
          competencia,
          salario_base: func.salario_base,
          horas_extras: func.horas_extras || 0,
          adicional_noturno: func.adicional_noturno || 0,
          total_proventos: totalProventos,
          inss, irrf, fgts,
          vr: func.vr || 0,
          va: func.va || 0,
          combustivel: func.combustivel || 0,
          passagens: func.passagens || 0,
          total_descontos: totalDescontos,
          liquido_receber: liquido,
          status: 'gerada'
        })
        .select();

      if (error) throw error;
      resultados.push(data[0]);
    }

    res.json({ sucesso: true, dados: resultados });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// Listar folhas
app.get('/api/folha', async (req, res) => {
  try {
    const { competencia } = req.query;
    let consulta = supabase.from('folha_pagamento').select(`
      *,
      funcionarios (nome, matricula)
    `);
    
    if (competencia) consulta = consulta.eq('competencia', competencia);
    
    const { data, error } = await consulta.order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ sucesso: true, dados: data });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// Conferir folha
app.put('/api/folha/:id/conferir', async (req, res) => {
  try {
    const { id } = req.params;
    const { conferente_matricula } = req.body;

    const { data, error } = await supabase
      .from('folha_pagamento')
      .update({
        status: 'conferida',
        conferida_por_id: conferente_matricula,
        conferida_em: new Date()
      })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json({ sucesso: true, dados: data[0] });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// Descontos de parceiros
app.get('/api/descontos-parceiros', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('descontos_parceiros')
      .select('*, funcionarios(nome, matricula)')
      .eq('ativo', true);
    
    if (error) throw error;
    res.json({ sucesso: true, dados: data });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// ==========================================
// 📞 CRM / LEADS
// ==========================================

// Listar leads com status
app.get('/api/leads', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('leads')
      .select(`
        *,
        funcionarios:vendedor_id (nome, matricula)
      `)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    
    // Marca expirados
    const agora = new Date();
    const comStatus = data.map(lead => ({
      ...lead,
      esta_expirado: lead.expira_em ? new Date(lead.expira_em) < agora : false
    }));

    res.json({ sucesso: true, dados: comStatus });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// Novo lead
app.post('/api/leads', async (req, res) => {
  try {
    const { nome, telefone, email, origem, vendedor_id } = req.body;
    
    // Expira em 24h por padrão
    const expira_em = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('leads')
      .insert({
        nome, telefone, email, origem, vendedor_id,
        status: 'novo',
        expira_em
      })
      .select();

    if (error) throw error;
    res.json({ sucesso: true, dados: data[0] });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// Registrar contato e controlar tempo
app.post('/api/leads/:id/contato', async (req, res) => {
  try {
    const { id } = req.params;
    const { funcionario_id, tipo, resultado, gerou_fruto, anotacoes, duracao_segundos } = req.body;

    const { error } = await supabase
      .from('leads_contatos')
      .insert({
        lead_id: id,
        funcionario_id,
        tipo,
        resultado,
        gerou_fruto,
        anotacoes,
        duracao_segundos
      });

    if (error) throw error;

    // Atualiza status do lead
    await supabase.from('leads').update({ status: 'em_atendimento' }).eq('id', id);

    res.json({ sucesso: true, mensagem: 'Contato registrado' });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// Redistribuir lead expirado
app.put('/api/leads/:id/redistribuir', async (req, res) => {
  try {
    const { id } = req.params;
    const { novo_vendedor_id } = req.body;

    const { error } = await supabase
      .from('leads')
      .update({
        vendedor_id: novo_vendedor_id,
        status: 'redistribuido'
      })
      .eq('id', id);

    if (error) throw error;
    res.json({ sucesso: true, mensagem: 'Redistribuído com sucesso' });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// ==========================================
// 📚 TREINAMENTOS & VIAGENS
// ==========================================

app.get('/api/treinamentos', async (req, res) => {
  try {
    const { data, error } = await supabase.from('treinamentos').select('*').order('data_inicio', { ascending: false });
    if (error) throw error;
    res.json({ sucesso: true, dados: data });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

app.post('/api/treinamentos', async (req, res) => {
  try {
    const { data, error } = await supabase.from('treinamentos').insert(req.body).select();
    if (error) throw error;
    res.json({ sucesso: true, dados: data[0] });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

app.get('/api/viagens', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('viagens')
      .select('*, funcionarios(nome, matricula)')
      .order('data_saida', { ascending: false });
    if (error) throw error;
    res.json({ sucesso: true, dados: data });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

app.post('/api/viagens', async (req, res) => {
  try {
    const { data, error } = await supabase.from('viagens').insert(req.body).select();
    if (error) throw error;
    res.json({ sucesso: true, dados: data[0] });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// ==========================================
// 🔧 SUPORTE TÉCNICO
// ==========================================

app.get('/api/suporte', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('suporte_chamados')
      .select(`
        *,
        solicitante: solicitante_id (nome),
        responsavel: responsavel_id (nome)
      `)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json({ sucesso: true, dados: data });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

app.post('/api/suporte', async (req, res) => {
  try {
    const protocolo = `SUP-${Date.now().toString().slice(-8)}`;
    const { data, error } = await supabase
      .from('suporte_chamados')
      .insert({ ...req.body, protocolo })
      .select();
    if (error) throw error;
    res.json({ sucesso: true, dados: data[0] });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

app.put('/api/suporte/:id/fechar', async (req, res) => {
  try {
    const { id } = req.params;
    const { solucao_aplicada } = req.body;

    const { data, error } = await supabase
      .from('suporte_chamados')
      .update({
        status: 'resolvido',
        solucao_aplicada,
        data_resolucao: new Date()
      })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.json({ sucesso: true, dados: data[0] });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// ==========================================
// 📜 LGPD / ACEITE
// ==========================================

// Registrar aceite
app.post('/api/lgpd/aceitar', async (req, res) => {
  try {
    const { entidade_tipo, entidade_id, canal, ip } = req.body;
    
    // Vence em 6 meses
    const proximo_vencimento = new Date();
    proximo_vencimento.setMonth(proximo_vencimento.getMonth() + 6);

    const { error } = await supabase
      .from('lgpd_termos')
      .insert({
        entidade_tipo,
        entidade_id,
        aceitou: true,
        canal,
        ip_aceite: ip,
        proximo_vencimento
      });

    if (error) throw error;

    // Atualiza funcionário
    if (entidade_tipo === 'funcionario') {
      await supabase.from('funcionarios').update({
        ultimo_aceite_lgpd: new Date(),
        proximo_vencimento_lgpd: proximo_vencimento
      }).eq('id', entidade_id);
    }

    res.json({ sucesso: true, proximo_vencimento });
  } catch (erro) {
    res.status(400).json({ sucesso: false, erro: erro.message });
  }
});

// Verificar se precisa aceitar
app.get('/api/lgpd/verificar/:tipo/:id', async (req, res) => {
  try {
    const { tipo, id } = req.params;
    const hoje = new Date();

    const { data, error } = await supabase
      .from('lgpd_termos')
      .select('proximo_vencimento, aceitou, data_aceite')
      .eq('entidade_tipo', tipo)
      .eq('entidade_id', id)
      .order('data_aceite', { ascending: false })
      .limit(1)
      .single();

    if (error) throw error;

    const precisa_aceitar = !data?.aceitou || new Date(data.proximo_vencimento) < hoje;

    res.json({ 
      sucesso: true, 
      precisa_aceitar,
      proximo_vencimento: data?.proximo_vencimento
    });
  } catch (erro) {
    // Sem registro → precisa aceitar
    res.json({ sucesso: true, precisa_aceitar: true });
  }
});
})();
