// =====================================================
// ASSADOS ERP — BACKEND COM SUPABASE
// Configure no Render (env vars):
//   SUPABASE_URL = https://seu-projeto.supabase.co
//   SUPABASE_KEY = service_role do projeto (somente como segredo do servidor)
// Nunca envie SUPABASE_KEY ao navegador, Git, mensagens ou respostas da API.
// As tabelas devem ser criadas executando sql/01-estrutura-completa.sql
// Se as env vars não estiverem definidas, usa arquivo local (data.json)
// =====================================================
// FIX RENDER - evita warning localStorage no Node 22+
if (typeof localStorage === 'undefined') {
  try {
    const { LocalStorage } = require('node-localstorage');
    global.localStorage = new LocalStorage('/tmp/scratch');
  } catch(e) {}
}

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { promisify } = require('util');
const gzipAsync = promisify(zlib.gzip);
const { createClient } = require('@supabase/supabase-js');
let nodemailer, XLSX, docx;
try { nodemailer = require('nodemailer'); } catch(e) { console.log('nodemailer não instalado — email desativado'); }
try { XLSX = require('xlsx'); } catch(e) { console.log('xlsx não instalado — Excel desativado'); }
try { docx = require('docx'); } catch(e) { console.log('docx não instalado — Word desativado'); }

const app = express();
const PORT = process.env.PORT || 10000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const USAR_SUPABASE = !!(SUPABASE_URL && SUPABASE_KEY);
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';
const ADMIN_RECOVERY_TOKEN = process.env.ADMIN_RECOVERY_TOKEN || '';
const BACKUP_ADMIN_TOKEN = process.env.BACKUP_ADMIN_TOKEN || '';
const BACKUP_DIR = process.env.BACKUP_DIR || (process.env.RENDER_DISK_PATH ? path.join(process.env.RENDER_DISK_PATH, 'backups') : path.join(__dirname, 'backups'));
const BACKUP_ENABLED = process.env.BACKUP_ENABLED === 'true';
const BACKUP_STORAGE_PERSISTENT = process.env.BACKUP_STORAGE_PERSISTENT === 'true';
const BACKUP_INTERVAL_HOURS = Math.min(720, Math.max(1, Number(process.env.BACKUP_INTERVAL_HOURS || 24)));
const BACKUP_RETENTION = Math.min(90, Math.max(1, Number(process.env.BACKUP_RETENTION || 7)));
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_HOURS = 24;

const supabase = USAR_SUPABASE ? createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
}) : null;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

app.use(cors({ origin: true, credentials: true }));
app.use(bodyParser.json({ limit: '12mb' }));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname)); // fallback: se dashboard.html estiver na raiz, serve também

// Rota explícita para garantir dashboard.html
app.get('/dashboard.html', (req, res) => {
  const p1 = path.join(__dirname, 'public', 'dashboard.html');
  const p2 = path.join(__dirname, 'dashboard.html');
  if (fs.existsSync(p1)) return res.sendFile(p1);
  if (fs.existsSync(p2)) return res.sendFile(p2);
  return res.status(404).send('dashboard.html não encontrado - coloque o arquivo em /public/dashboard.html');
});


// Rotas amigáveis (sem .html)
app.get('/', (req, res) => res.redirect('/dashboard.html'));
app.get('/dashboard', (req, res) => res.redirect('/dashboard.html'));
app.get('/site', (req, res) => res.redirect('/site.html'));
app.get('/painel', (req, res) => res.redirect('/dashboard.html'));
app.get('/loja', (req, res) => res.redirect('/site.html'));

// ===== STORE — Supabase (se configurado) ou arquivo local =====
let DB = {};
const TABELAS = ['unidades','funcionarios','produtos','clientes','fidelidade','fornecedores','caixas','tesouraria','vendas','comandas','contas','notas_fiscais','autorizacoes','ponto','ferias','holerites','documentos_rh','remessas','patrimonio','imoveis','eventos','fichas_tecnicas','ordens_servico','estoque','mov_estoque','pdv_emergencial','log_bloqueio','log_caixa','mov_caixa','logistica','frota','checklists_exec','pedidos_site','bot_config','bot_regras','ia_pedidos','receitas','acertos','abonos','transferencias','bot_log','login_security','support_tickets','backup_settings','backup_runs','almoxarifado','endomarketing','treinamentos','avaliacoes_treinamento'];
let STATUS_BANCO = { tipo: USAR_SUPABASE ? 'supabase' : 'local', conectado: !USAR_SUPABASE, tabelas_com_erro: [] };
let backupTimer = null;

async function loadDB() {
  if (USAR_SUPABASE) {
    console.log('🔌 Conectando ao Supabase:', SUPABASE_URL);
    const falhas = [];
    DB = {};
    for (const tabela of TABELAS) {
      try {
        const { data, error } = await supabase.from(tabela).select('*');
        if (!error) DB[tabela] = data || [];
        else { DB[tabela] = []; falhas.push(tabela); console.error(`Erro ao ler tabela ${tabela}:`, error.message); }
      } catch(e) { DB[tabela] = []; falhas.push(tabela); console.error(`Erro ao ler tabela ${tabela}:`, e.message); }
    }
    try {
      const { data, error } = await supabase.from('controle_sistema').select('*').limit(1).maybeSingle();
      if (error) { falhas.push('controle_sistema'); console.error('Erro ao ler tabela controle_sistema:', error.message); }
      DB.controle_sistema = data || { id:1, matriz_aberta:true, status_geral:'aberta', permite_pdv_emergencial:true, mensagem_aviso:'Sistema operando normalmente' };
    } catch(e) {
      falhas.push('controle_sistema');
      console.error('Erro ao ler tabela controle_sistema:', e.message);
      DB.controle_sistema = { id:1, matriz_aberta:true, status_geral:'aberta', permite_pdv_emergencial:true, mensagem_aviso:'Sistema operando normalmente' };
    }
    STATUS_BANCO = { tipo: 'supabase', conectado: falhas.length === 0, tabelas_carregadas: TABELAS.length + 1 - falhas.length, total_tabelas: TABELAS.length + 1, tabelas_com_erro: [...new Set(falhas)] };
    console.log(STATUS_BANCO.conectado ? '✅ Supabase carregado —' : '⚠️ Supabase carregado parcialmente —', STATUS_BANCO.tabelas_carregadas, '/', STATUS_BANCO.total_tabelas, 'tabelas');
  } else {
    try { if (fs.existsSync(DATA_FILE)) DB = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) { DB = {}; }
    if (!DB.unidades || !DB.unidades.length) seed();
    STATUS_BANCO = { tipo: 'local', conectado: true, tabelas_carregadas: Object.keys(DB).length, total_tabelas: Object.keys(DB).length, tabelas_com_erro: [] };
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

// ===== BACKUP =====
let backupEmAndamento = false;
let ultimoBackup = null;
let erroUltimoBackup = null;
async function criarBackup() {
  if (backupEmAndamento) return { sucesso: false, erro: 'Já existe um backup em andamento.' };
  if (USAR_SUPABASE && !STATUS_BANCO.conectado) return { sucesso: false, erro: 'Banco degradado; backup cancelado para evitar cópia incompleta.' };
  backupEmAndamento = true;
  try {
    await fs.promises.mkdir(BACKUP_DIR, { recursive: true });
    const criadoEm = agora();
    let dados;
    if (USAR_SUPABASE) {
      const colecoes = {};
      for (const tabela of TABELAS) {
        const { data, error } = await supabase.from(tabela).select('*');
        if (error) throw new Error(`Falha lendo ${tabela}: ${error.message}`);
        colecoes[tabela] = data || [];
      }
      for (const tabela of ['login_security', 'support_tickets']) {
        const { data, error } = await supabase.from(tabela).select('*');
        if (error) throw new Error(`Falha lendo ${tabela}: ${error.message}. Execute a migração de segurança antes de habilitar backups.`);
        colecoes[tabela] = data || [];
      }
      const { data: controle, error } = await supabase.from('controle_sistema').select('*').limit(1).maybeSingle();
      if (error) throw new Error(`Falha lendo controle_sistema: ${error.message}`);
      colecoes.controle_sistema = controle;
      dados = { sistema: 'Assados ERP', criado_em: criadoEm, colecoes };
    } else {
      const conteudo = await fs.promises.readFile(DATA_FILE, 'utf8');
      dados = { sistema: 'Assados ERP', criado_em: criadoEm, colecoes: JSON.parse(conteudo) };
    }
    const nome = `assados-${criadoEm.replace(/[:.]/g, '-')}.json.gz`;
    const destino = path.join(BACKUP_DIR, nome);
    const compactado = await gzipAsync(Buffer.from(JSON.stringify(dados)), { level: 6 });
    await fs.promises.writeFile(destino, compactado, { flag: 'wx', mode: 0o600 });
    const arquivos = (await fs.promises.readdir(BACKUP_DIR))
      .filter(n => /^assados-.*\.json\.gz$/.test(n))
      .sort();
    const excedentes = arquivos.slice(0, Math.max(0, arquivos.length - BACKUP_RETENTION));
    for (const antigo of excedentes) await fs.promises.unlink(path.join(BACKUP_DIR, antigo));
    ultimoBackup = { nome, criado_em: criadoEm, tamanho_bytes: compactado.length };
    erroUltimoBackup = null;
    console.log(`✅ Backup criado: ${nome} (${compactado.length} bytes)`);
    return { sucesso: true, ...ultimoBackup };
  } catch (e) {
    erroUltimoBackup = e.message;
    console.error('❌ Erro ao criar backup:', e.message);
    return { sucesso: false, erro: 'Backup falhou. Consulte os logs do servidor.' };
  } finally { backupEmAndamento = false; }
}

async function statusBackups() {
  const config = getBackupSettings();
  try {
    const arquivos = (await fs.promises.readdir(BACKUP_DIR)).filter(n => /^assados-.*\.json\.gz$/.test(n));
    const registros = await Promise.all(arquivos.map(async nome => {
      const stat = await fs.promises.stat(path.join(BACKUP_DIR, nome));
      return { nome, criado_em: stat.mtime.toISOString(), tamanho_bytes: stat.size };
    }));
    registros.sort((a, b) => b.criado_em.localeCompare(a.criado_em));
    const ultimo = ultimoBackup || registros[0] || null;
    return { habilitado: Boolean(config.habilitado || BACKUP_ENABLED), destino: config.destino || 'local', intervalo_horas: Number(config.intervalo_horas || BACKUP_INTERVAL_HOURS), retencao: Number(config.retencao || BACKUP_RETENTION), armazenamento_persistente: BACKUP_STORAGE_PERSISTENT, em_andamento: backupEmAndamento, ultimo_backup: ultimo, erro_ultimo_backup: erroUltimoBackup, backups: registros, configuracao: config };
  } catch (e) {
    return { habilitado: Boolean(config.habilitado || BACKUP_ENABLED), destino: config.destino || 'local', intervalo_horas: Number(config.intervalo_horas || BACKUP_INTERVAL_HOURS), retencao: Number(config.retencao || BACKUP_RETENTION), armazenamento_persistente: BACKUP_STORAGE_PERSISTENT, em_andamento: backupEmAndamento, ultimo_backup: ultimoBackup, erro_ultimo_backup: erroUltimoBackup || e.message, backups: [], configuracao: config };
  }
}

function getBackupSettings() {
  DB.backup_settings = DB.backup_settings || [];
  let cfg = DB.backup_settings.find(item => item.id === 1) || DB.backup_settings[0] || null;
  if (!cfg) {
    cfg = { id: 1, habilitado: false, destino: 'local', intervalo_horas: 24, retencao: 7, ultimo_backup: null, proximo_backup: null };
    DB.backup_settings.push(cfg);
  }
  cfg.id = 1;
  cfg.habilitado = cfg.habilitado !== undefined ? Boolean(cfg.habilitado) : false;
  cfg.destino = cfg.destino || 'local';
  cfg.intervalo_horas = Number(cfg.intervalo_horas || 24);
  cfg.retencao = Number(cfg.retencao || 7);
  return cfg;
}
function setBackupSettings(payload = {}) {
  const cfg = getBackupSettings();
  const dados = {
    ...cfg,
    habilitado: Boolean(payload.habilitado ?? cfg.habilitado),
    destino: payload.destino || cfg.destino || 'local',
    intervalo_horas: Number(payload.intervalo_horas || cfg.intervalo_horas || 24),
    retencao: Number(payload.retencao || cfg.retencao || 7),
    atualizado_em: agora()
  };
  DB.backup_settings = [{ ...dados, id: 1 }];
  saveDB();
  return DB.backup_settings[0];
}
function nextId(col) { DB[col] = DB[col] || []; return (DB[col].reduce((m, r) => Math.max(m, r.id || 0), 0)) + 1; }
function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(senha), salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}
function verificarSenha(hash, senha) {
  if (typeof hash !== 'string' || typeof senha !== 'string') return false;
  if (hash.startsWith('scrypt$')) {
    const [, saltHex, derivedHex] = hash.split('$');
    if (!saltHex || !derivedHex) return false;
    try {
      const expected = Buffer.from(derivedHex, 'hex');
      const actual = crypto.scryptSync(senha, Buffer.from(saltHex, 'hex'), expected.length);
      return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    } catch { return false; }
  }
  const expected = Buffer.from(hash);
  const actual = Buffer.from(senha);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
function funcionarioERP(body){
  const matricula = String(body?.usuario?.matricula || '');
  const senha = String(body?.senha_usuario || '');
  const funcionario = (DB.funcionarios || []).find(x => x.matricula === matricula && x.status !== 'INATIVO');
  return funcionario && verificarSenha(funcionario.senha_hash, senha) ? funcionario : null;
}
function adminERP(body){
  const funcionario = funcionarioERP(body);
  return funcionario && (funcionario.role === 'admin' || funcionario.unidade_tipo === 'matriz') ? funcionario : null;
}
function segredoValido(recebido, esperado) {
  if (!esperado || !recebido) return false;
  const a = Buffer.from(String(recebido));
  const b = Buffer.from(String(esperado));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
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
    { id: 1, matricula: 'SV-2026-0001', nome: 'Administrador Geral', cargo: 'Administrador', unidade_id: 1, unidade_tipo: 'matriz', role: 'admin', senha_hash: '123', status: 'ATIVO', salario_base: 5000, jornada_diaria: 8, data_admissao: '2024-01-01' },
  { id: 'adm', matricula: 'adm', nome: 'ADM Sistema', cargo: 'Administrador', unidade_id: 1, unidade_tipo: 'matriz', role: 'admin', senha_hash: '123', status: 'ATIVO', salario_base: 5000, jornada_diaria: 8, data_admissao: '2024-01-01' },
  { id: 'as', matricula: 'as', nome: 'AS Admin', cargo: 'Administrador', unidade_id: 1, unidade_tipo: 'matriz', role: 'admin', senha_hash: '123', status: 'ATIVO', salario_base: 5000, jornada_diaria: 8, data_admissao: '2024-01-01' },
  { id: 'SV-2026-0001', nome: 'Administrador Geral', cargo: 'Administrador', unidade_id: 1, unidade_tipo: 'matriz', role: 'admin', senha_hash: '123', status: 'ATIVO', salario_base: 5000, jornada_diaria: 8, data_admissao: '2024-01-15' },
  { id: 'adm', matricula: 'adm', nome: 'ADM Sistema', cargo: 'Administrador', unidade_id: 1, unidade_tipo: 'matriz', role: 'admin', senha_hash: '123', status: 'ATIVO', salario_base: 5000, jornada_diaria: 8, data_admissao: '2024-01-01' },
  { id: 'as', matricula: 'as', nome: 'AS Admin', cargo: 'Administrador', unidade_id: 1, unidade_tipo: 'matriz', role: 'admin', senha_hash: '123', status: 'ATIVO', salario_base: 5000, jornada_diaria: 8, data_admissao: '2024-01-01' },
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
  DB.login_security = []; DB.support_tickets = []; DB.backup_runs = []; DB.backup_settings = [{ id: 1, habilitado: false, destino: 'local', intervalo_horas: 24, retencao: 7, atualizado_em: agora() }];
  DB.bot_config = [{ nome: 'nome_bot', valor: 'SorveteBot' }, { nome: 'saudacao', valor: 'Olá! Bem-vindo à Sorveteria!' }];
  DB.bot_regras = [
    { id: 1, palavras_chave: 'sabor|sabores|sorvete', resposta: 'Temos os sabores: Morango, Chocolate, Baunilha, Açaí com granola e muito mais!' },
    { id: 2, palavras_chave: 'picole|picolé|picoles', resposta: 'Nossos picolés são R$ 4,50 cada — chocolate, morango, uva e limão!' },
    { id: 3, palavras_chave: 'preco|preço|valor|quanto', resposta: 'Sorvete 2L R$ 45,90 | Açaí 300ml R$ 12,90 | Picolé R$ 4,50 | Refrigerante R$ 5,00' },
    { id: 4, palavras_chave: 'horario|horário|abre|fecha|funcionamento', resposta: 'Funcionamos de segunda a domingo, das 10h às 22h!' },
    { id: 5, palavras_chave: 'evento|festa|aniversario|empresa', resposta: 'Fazemos eventos e festas! Envie data, quantidade de pessoas e local que enviamos o orçamento.' },
    { id: 6, palavras_chave: 'ifood|delivery|entrega|entregador', resposta: 'Es
