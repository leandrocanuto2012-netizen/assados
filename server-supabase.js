#!/usr/bin/env node
'use strict';
/**
 * Patch seguro do servidor Assados Nobre ERP.
 * Execute na raiz do repositório: node assados-erp-server-fix.js
 * Cria cópias .bak antes de alterar qualquer arquivo.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const SERVER = path.join(ROOT, 'server-supabase.js');
const PACKAGE = path.join(ROOT, 'package.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function fail(message) { console.error('\nERRO: ' + message); process.exit(1); }
function backup(file) {
  if (!fs.existsSync(file)) fail('Arquivo não encontrado: ' + path.basename(file));
  const copy = file + '.' + stamp + '.bak';
  fs.copyFileSync(file, copy);
  console.log('Backup: ' + path.basename(copy));
}
function replaceOne(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) fail('Não encontrei o trecho esperado: ' + label);
  if (source.indexOf(before, first + before.length) >= 0) fail('Trecho duplicado; parei sem alterar: ' + label);
  return source.slice(0, first) + after + source.slice(first + before.length);
}
function replaceRegexOne(source, regex, replacement, label) {
  const matches = [...source.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g'))];
  if (matches.length !== 1) fail(`Esperava 1 ocorrência de ${label}, encontrei ${matches.length}.`);
  return source.replace(regex, replacement);
}
function addTable(tablesText, name) {
  if (tablesText.includes(`'${name}'`)) return tablesText;
  return tablesText.replace("'unidades','funcionarios'", `'unidades','funcionarios','${name}'`);
}

if (!fs.existsSync(SERVER)) fail('Rode este arquivo na raiz do repositório, onde existe server-supabase.js.');
if (!fs.existsSync(PACKAGE)) fail('package.json não encontrado.');

backup(SERVER);
backup(PACKAGE);
let server = fs.readFileSync(SERVER, 'utf8');
let pkg = JSON.parse(fs.readFileSync(PACKAGE, 'utf8'));

// 1) Porta e configuração de sessão assinada.
server = replaceOne(server, 'const PORT = process.env.PORT || 10000;', 'const PORT = process.env.PORT || 8080;', 'porta padrão');
server = replaceOne(server, 'const LOGIN_LOCK_HOURS = 24;', `const LOGIN_LOCK_HOURS = 24;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSOES_REVOGADAS = new Set();`, 'configuração da sessão');

// 2) Remover o AUTO-FIX que, em cada inicialização, redefinia senha e apagava registros/produtos.
server = replaceRegexOne(server,
  /\s*\/\/ AUTO-FIX ASSADOS[\s\S]*?console\.log\('AUTO-FIX falhou:', e\.message\);\s*\}/,
  '', 'bloco destrutivo AUTO-FIX');

// 3) Remover endpoints de debug que expunham matrículas e fragmentos de hashes.
server = replaceRegexOne(server,
  /\/\/ DEBUG - ver quem está carregado na memória[\s\S]*?(?=\/\/ FIX - endpoint que o dashboard chama no login)/,
  '', 'rotas de debug');

// 4) Remover o bypass fixo da senha 123 e logs com dados de login.
server = replaceOne(server,
  `  console.log('[LOGIN] Tentativa matricula:', matricula, 'senha recebida:', senha ? '***' : 'vazia');
  const todos = (DB.funcionarios || []).map(x => x.matricula);
  console.log('[LOGIN] Matriculas carregadas:', todos);
  const f = (DB.funcionarios || []).find(x => x.matricula === matricula && x.status !== 'INATIVO');
  console.log('[LOGIN] Funcionario encontrado?', !!f, f ? f.matricula : 'nenhum');`,
  `  const f = (DB.funcionarios || []).find(x => x.matricula === matricula && x.status !== 'INATIVO');`,
  'logs de identificação no login');
server = replaceOne(server,
  `  console.log('[LOGIN] Verificando senha para:', f?.matricula, 'hash preview:', String(f?.senha_hash||'').slice(0,20));
`,
  '', 'log de hash no login');
server = replaceOne(server,
  `  // BYPASS DE EMERGENCIA - se senha for 123 e for admin, libera (DEPOIS da verificação normal)
  if(!senhaOk && senha === '123' && String(f?.role||'').toLowerCase().includes('admin')){
    console.log('[LOGIN] BYPASS EMERGENCIAL ATIVADO PARA ADMIN COM SENHA 123 - LIBERANDO');
    senhaOk = true;
  }
`,
  '', 'bypass de senha');
server = replaceOne(server,
  "res.json({ sucesso: true, token: 'tok-' + f.id, usuario, unidade: (DB.unidades || []).find(u => u.id === f.unidade_id) });",
  "res.json({ sucesso: true, token: criarTokenSessao(f), usuario, unidade: (DB.unidades || []).find(u => u.id === f.unidade_id) });",
  'token de sessão previsível');

// 5) Middleware de autenticação para as rotas /api, com sessão assinada e permissão por módulo.
const middleware = `
// ===== SESSÃO E AUTORIZAÇÃO DO ERP =====
function criarTokenSessao(funcionario) {
  const payload = Buffer.from(JSON.stringify({ sub: String(funcionario.id), matricula: funcionario.matricula, exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  const assinatura = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return payload + '.' + assinatura;
}
function lerTokenSessao(token) {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  const esperada = crypto.createHmac('sha256', SESSION_SECRET).update(partes[0]).digest();
  let recebida;
  try { recebida = Buffer.from(partes[1], 'base64url'); } catch { return null; }
  if (esperada.length !== recebida.length || !crypto.timingSafeEqual(esperada, recebida)) return null;
  try {
    const dados = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf8'));
    if (!dados.sub || !dados.matricula || !Number.isFinite(dados.exp) || dados.exp <= Date.now()) return null;
    return dados;
  } catch { return null; }
}
function nivelPermissaoUsuario(usuario) {
  const informado = Number(usuario?.nivel_permissao || 0);
  if (informado >= 1 && informado <= 6) return informado;
  const papel = String(usuario?.role || '').toLowerCase().trim();
  const porPapel = { operador:1, producao:2, produção:2, caixa:3, vendedor:3, atendente:3, supervisor:4, financeiro:4, rh:4, gerente:5, admin:6, adm:6, administrador:6 };
  return porPapel[papel] || 1;
}
function usuarioEhAdmin(usuario) {
  const role = String(usuario?.role || '').toLowerCase();
  return ['admin','adm','administrador','administrador geral'].includes(role) ||
    nivelPermissaoUsuario(usuario) >= 6;
}
function modulosDoUsuario(usuario) {
  if (usuarioEhAdmin(usuario)) return null;
  const role = String(usuario?.role || '').toLowerCase().trim();
  const perfil = (DB.perfis_permissao || []).find(p => String(p.id) === String(usuario?.role || '') && p.ativo !== false);
  if (perfil && Array.isArray(perfil.modulos)) return perfil.modulos;
  const especiais = {
    operador:['dashboard','pdv-usuario','ponto-usuario','consultas-usuario','agenda','post-its','calculadora'],
    producao:['dashboard','fichas-tecnicas','ordens-servico','producao','estoque','agenda','post-its'],
    'produção':['dashboard','fichas-tecnicas','ordens-servico','producao','estoque','agenda','post-its'],
    caixa:['dashboard','pdv-usuario','caixa','vendas','comandas','clientes','ponto-usuario','consultas-usuario','agenda'],
    vendedor:['dashboard','pdv-usuario','caixa','vendas','comandas','clientes','pedidos-site','agenda'],
    atendente:['dashboard','pdv-usuario','caixa','vendas','comandas','clientes','pedidos-site','agenda'],
    financeiro:['dashboard','contas','tesouraria','fluxo-caixa','conciliacao','boletos','notas-fiscais','vendas','agenda'],
    rh:['dashboard','funcionarios','ponto','ferias','holerites','rescisao','documentos-rh','checklists','agenda'],
    supervisor:['dashboard','caixa','vendas','comandas','clientes','produtos','fornecedores','compras','devolucoes','estoque','ponto','checklists','logistica','chamados','agenda','post-its'],
    gerente:['dashboard','caixa','pdv-emergencial','configuracao-pdv','produtos','clientes','fornecedores','fichas-tecnicas','ordens-servico','producao','vendas','comandas','pedidos-site','eventos','estoque','compras','devolucoes','contas','tesouraria','notas-fiscais','boletos','ifood','integracoes','metas','autorizacoes','ponto','ferias','holerites','rescisao','documentos-rh','logistica','checklists','chamados','protocolo-entregas','bot-config','gerente','ia-vendas','agenda','post-its','calculadora']
  };
  if (especiais[role]) return [...new Set(especiais[role])];
  const nivel = Math.min(5, Math.max(1, nivelPermissaoUsuario(usuario)));
  const base = ['dashboard','agenda','post-its','calculadora'];
  const porNivel = {
    1: ['pdv-usuario','ponto-usuario','consultas-usuario','ponto'],
    2: ['fichas-tecnicas','ordens-servico','producao','estoque'],
    3: ['caixa','vendas','comandas','clientes','pedidos-site','eventos','estoque'],
    4: ['caixa','vendas','comandas','clientes','pedidos-site','eventos','estoque','produtos','fornecedores','compras','devolucoes','metas','ponto','checklists','logistica','chamados','protocolo-entregas','fichas-tecnicas','ordens-servico','producao'],
    5: ['caixa','pdv-emergencial','configuracao-pdv','produtos','clientes','fornecedores','funcionarios','unidades','patrimonio','imoveis','fichas-tecnicas','ordens-servico','producao','vendas','comandas','pedidos-site','eventos','estoque','compras','devolucoes','contas','tesouraria','notas-fiscais','boletos','ifood','integracoes','metas','autorizacoes','ponto','ferias','holerites','rescisao','documentos-rh','logistica','checklists','chamados','protocolo-entregas','bot-config','gerente','ia-vendas','agenda','post-its','calculadora']
  };
  return [...new Set([...base, ...(porNivel[nivel] || [])])];
}
const REGRAS_MODULO_API = [
  ['/controle-sistema','__admin__'], ['/auditoria','__admin__'], ['/backup','__admin__'], ['/admin','__admin__'], ['/debug','__admin__'], ['/registros','__admin__'],
  ['/perfis-permissao','permissoes'], ['/funcionarios/permissao','__admin__'], ['/unidades','__admin__'], ['/funcionarios','funcionarios'],
  ['/pdv/usuario/ponto','ponto'], ['/pdv/usuario/consultas','vendas'], ['/pdv/configuracoes','configuracao-pdv'], ['/pdv-emergencial','pdv-emergencial'],
  ['/dashboard','dashboard'], ['/gerente','gerente'], ['/caixa','caixa'], ['/log-caixa','caixa'], ['/venda','vendas'], ['/vendas','vendas'], ['/produtos','produtos'],
  ['/clientes','clientes'], ['/fidelidade','clientes'], ['/fornecedores','fornecedores'], ['/patrimonio','unidades'], ['/imoveis','unidades'],
  ['/fichas-tecnicas','fichas-tecnicas'], ['/ordens-servico','ordens-servico'], ['/producao','producao'], ['/comandas','comandas'], ['/eventos','eventos'],
  ['/site/pedidos','pedidos-site'], ['/site/pedido','pedidos-site'], ['/site/cliente','pedidos-site'], ['/site/clientes','pedidos-site'], ['/site/stats','pedidos-site'], ['/site/config','pedidos-site'],
  ['/wms','estoque'], ['/estoque','estoque'], ['/remessas','estoque'], ['/compras','compras'], ['/devolucoes','devolucoes'],
  ['/contas','contas'], ['/contabilidade','contas'], ['/tesouraria','tesouraria'], ['/financeiro','contas'], ['/banco','tesouraria'], ['/nf','notas-fiscais'], ['/boletos','boletos'],
  ['/autorizacoes','autorizacoes'], ['/rh/ponto','ponto'], ['/rh/ferias','ferias'], ['/rh/holerites','holerites'], ['/rh/documentos','documentos-rh'], ['/rh','funcionarios'], ['/folha','holerites'],
  ['/logistica','logistica'], ['/frota','logistica'], ['/checklists','checklists'], ['/chamados','chamados'], ['/protocolo-entregas','protocolo-entregas'],
  ['/bot','bot-config'], ['/ia-vendas','ia-vendas'], ['/meta-ia','meta-ia'], ['/checklist','checklists'], ['/agenda','agenda'], ['/post-its','post-its'], ['/metas','metas'], ['/ifood','ifood'], ['/integracoes','integracoes'], ['/crm','clientes'], ['/leads','clientes'],
  ['/email','integracoes'], ['/export','dashboard'], ['/almoxarifado','estoque'], ['/treinamentos','funcionarios'], ['/endomarketing','funcionarios'], ['/viagens','logistica'], ['/suporte','chamados'], ['/lgpd','clientes'], ['/descontos-parceiros','vendas'], ['/lojas','integracoes']
].sort((a,b) => b[0].length - a[0].length);
const ROTAS_PUBLICAS_API = new Set([
  'GET /status','GET /health','GET /site/produtos','GET /site/config',
  'POST /site/cliente/cadastro','POST /site/cliente/login','POST /site/pedido','POST /site/acesso','POST /bot/chat','POST /bot/responder'
]);
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS' || (req.method === 'POST' && req.path === '/login')) return next();
  if (ROTAS_PUBLICAS_API.has(req.method + ' ' + req.path)) return next();
  if (req.path === '/bot/webhook') {
    const segredo = process.env.BOT_WEBHOOK_SECRET || '';
    if (!segredo || !segredoValido(req.get('x-bot-webhook-secret'), segredo)) return res.status(403).json({ erro: 'Webhook não autorizado.' });
    return next();
  }
  const cabecalho = String(req.get('authorization') || '');
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
  if (!token || SESSOES_REVOGADAS.has(token)) return res.status(401).json({ erro: 'Sessão ausente ou expirada. Entre novamente.' });
  const sessao = lerTokenSessao(token);
  if (!sessao) return res.status(401).json({ erro: 'Sessão inválida ou expirada. Entre novamente.' });
  const usuario = (DB.funcionarios || []).find(f => String(f.id) === String(sessao.sub) && f.matricula === sessao.matricula && f.status !== 'INATIVO');
  if (!usuario) return res.status(401).json({ erro: 'Usuário não está mais ativo. Entre novamente.' });
  req.authUser = usuario;
  req.authToken = token;
  req.body = req.body || {};
  if (req.path === '/session' || req.path === '/logout' || (req.path === '/perfis-permissao' && req.method === 'GET')) {
    try { Object.defineProperty(req.body, '__authFuncionario', { value: usuario, enumerable: false, configurable: true }); } catch {}
    return next();
  }
  // Senhas de confirmação são transmitidas em cabeçalhos e só ficam em propriedades não enumeráveis.
  const senhaConfirmacao = String(req.get('x-confirm-password') || '');
  const senhaAdmin = String(req.get('x-admin-confirm-password') || '');
  const senhaOperador = String(req.get('x-operator-confirm-password') || '');
  const adminConfirmado = senhaAdmin
    ? (DB.funcionarios || []).find(f => f.status !== 'INATIVO' && f.status !== 'ARQUIVADO' && usuarioEhAdmin(f) && verificarSenha(f.senha_hash, senhaAdmin))
    : null;
  if (senhaAdmin && !adminConfirmado) return res.status(403).json({ erro:'Senha de administrador inválida.' });
  if (senhaOperador && !verificarSenha(usuario.senha_hash, senhaOperador)) return res.status(403).json({ erro:'Senha do operador inválida.' });
  if (senhaConfirmacao && !verificarSenha(usuario.senha_hash, senhaConfirmacao)) return res.status(403).json({ erro:'Senha de confirmação inválida.' });
  const exigeConfirmacao = /\/(salvar|criar|editar|excluir|arquivar|registrar|configurar|config)$/.test(req.path) || [
    '/agenda','/post-its','/pdv/usuario/ponto','/perfis-permissao','/integracoes/personalizadas',
    '/funcionarios/permissao','/caixa/movimento','/controle-sistema/mensagem','/backup/configuracoes','/bot/config','/bot/regras','/fidelidade/ajustar'
  ].includes(req.path);
  if (req.method !== 'GET' && exigeConfirmacao && !senhaConfirmacao) {
    return res.status(403).json({ erro:'Confirme sua senha atual para executar esta operação.' });
  }
  const movimentoExigeAdm = req.path === '/caixa/movimento' && ['REMESSA','RECOLHIMENTO','SANGRIA'].includes(String(req.body?.tipo || '').toUpperCase());
  const exigeSenhaAdm = movimentoExigeAdm || ['/checklist/marcar-item','/checklist/finalizar','/nf/cancelar','/rh/ponto/acertar','/rh/abono-gancho','/funcionarios/permissao'].includes(req.path) || /^\/funcionarios\/[^/]+\/sensiveis$/.test(req.path);
  if (exigeSenhaAdm && !adminConfirmado) return res.status(403).json({ erro:'Esta operação exige confirmação de um administrador.' });
  if (req.path === '/funcionarios/salvar' && req.body?.id && !usuarioEhAdmin(usuario)) {
    const alvo = (DB.funcionarios || []).find(f => String(f.id) === String(req.body.id));
    if (alvo && String(alvo.id) === String(usuario.id)) return res.status(403).json({ erro:'Não é permitido alterar o próprio cadastro por esta tela.' });
  }
  // Nunca aceite credenciais dentro do JSON: injete somente os valores já validados.
  delete req.body.senha_usuario; delete req.body.senha_confirmacao; delete req.body.senha_adm; delete req.body.senha_operador; delete req.body.usuario;
  try {
    Object.defineProperty(req.body, '__authFuncionario', { value: usuario, enumerable: false, configurable: true });
    if (senhaConfirmacao) Object.defineProperty(req.body, 'senha_usuario', { value: senhaConfirmacao, enumerable: false, configurable: true });
    if (adminConfirmado) Object.defineProperty(req.body, 'senha_adm', { value: senhaAdmin, enumerable: false, configurable: true });
    if (senhaOperador) Object.defineProperty(req.body, 'senha_operador', { value: senhaOperador, enumerable: false, configurable: true });
  } catch {}
  req.authAdmin = adminConfirmado || null;
  const admin = usuarioEhAdmin(usuario);
  const rota = req.path;
  const adminOnly = (req.method === 'PUT' && /^\/funcionarios\/[^/]+$/.test(rota)) || rota.startsWith('/controle-sistema') || rota.startsWith('/auditoria') || rota.startsWith('/backup') || rota.startsWith('/admin') || rota.startsWith('/debug') ||
    (rota.startsWith('/perfis-permissao') && req.method !== 'GET') || rota.startsWith('/funcionarios/permissao') || /\\/funcionarios\\/[^/]+\\/trocar-senha$/.test(rota) || /\\/admin\\/funcionarios\\//.test(rota);
  if (adminOnly && !admin) return res.status(403).json({ erro: 'Somente a administração pode executar esta operação.' });
  if (admin) return next();
  const regra = REGRAS_MODULO_API.find(([prefixo]) => rota === prefixo || rota.startsWith(prefixo + '/'));
  if (!regra || regra[1] === '__admin__') return res.status(403).json({ erro: 'Rota sem permissão configurada para este perfil.' });
  const permitidos = modulosDoUsuario(usuario) || [];
  if (!permitidos.includes(regra[1])) return res.status(403).json({ erro: 'Seu perfil não possui acesso a este módulo.' });
  next();
});
// ===== FIM DA SESSÃO E AUTORIZAÇÃO =====
`;
server = replaceOne(server,
  "app.use(express.static(__dirname)); // fallback: se login.html estiver na raiz, serve também",
  "// Segurança: não publicar a raiz do projeto, o arquivo data.json nem o código do servidor.",
  'remoção de static da raiz');
server = replaceOne(server,
  "app.use(express.static(path.join(__dirname, 'public')));",
  "app.use(express.static(path.join(__dirname, 'public')));\n" + middleware,
  'middleware de sessão');

// 6) Função auxiliar para retirar campos de autenticação de objetos persistidos.
const helper = `
function payloadSemAutenticacao(body = {}) {
  const dados = { ...(body || {}) };
  delete dados.senha_confirmacao;
  delete dados.senha_usuario;
  delete dados.senha_adm;
  delete dados.usuario;
  delete dados.__authFuncionario;
  return dados;
}
`;
server = replaceOne(server, 'function funcionarioERP(body){', helper + '\nfunction funcionarioERP(body){', 'helper de limpeza de payload');
server = replaceOne(server,
  `function funcionarioERP(body){
  const matricula = String(body?.usuario?.matricula || '');
  const senha = String(body?.senha_usuario || '');
  const funcionario = (DB.funcionarios || []).find(x => x.matricula === matricula && x.status !== 'INATIVO');
  return funcionario && verificarSenha(funcionario.senha_hash, senha) ? funcionario : null;
}`,
  `function funcionarioERP(body){
  if (body && body.__authFuncionario) return body.__authFuncionario;
  const matricula = String(body?.usuario?.matricula || '');
  const senha = String(body?.senha_usuario || '');
  const funcionario = (DB.funcionarios || []).find(x => x.matricula === matricula && x.status !== 'INATIVO');
  return funcionario && verificarSenha(funcionario.senha_hash, senha) ? funcionario : null;
}`,
  'compatibilidade das rotas administrativas com sessão autenticada');
server = server.replaceAll("x.matricula === matricula && x.status !== 'INATIVO'", "x.matricula === matricula && x.status !== 'INATIVO' && x.status !== 'ARQUIVADO'");
server = replaceOne(server,
  `function adminERP(body){
  const funcionario = funcionarioERP(body);
  return funcionario && (funcionario.role === 'admin' || funcionario.unidade_tipo === 'matriz') ? funcionario : null;
}`,
  `function adminERP(body){
  const funcionario = funcionarioERP(body);
  return funcionario && (usuarioEhAdmin(funcionario) || (modulosDoUsuario(funcionario) || []).includes('pedidos-site')) ? funcionario : null;
}`,
  'checagem administrativa com regra unificada de permissões');

// 7) Rastrear IDs carregados e serializar gravações no Supabase; exclusões passam a persistir.
server = replaceOne(server,
  'let backupTimer = null;',
  `let backupTimer = null;
const TABELAS_CARREGADAS = new Set();
const IDS_PERSISTIDOS = new Map();
const COLECOES_EXTRAS = ['audit_log','boletos','chamados','crm_contatos','email_log','estoque_ajustes','frota_manutencao','ifood_config','meta_ia_log','metas','protocolos_entrega'];
const IDS_EXTRAS_PERSISTIDOS = new Map();
let EXTRAS_CARREGADOS = false;`,
  'controle de tabelas persistidas');
server = replaceOne(server,
  "    DB = {};\n    for (const tabela of TABELAS) {",
  "    DB = {};\n    TABELAS_CARREGADAS.clear(); IDS_PERSISTIDOS.clear();\n    for (const tabela of TABELAS) {",
  'inicialização do mapa de IDs');
server = replaceOne(server,
  '        if (!error) DB[tabela] = data || [];\n        else { DB[tabela] = []; falhas.push(tabela); console.error(`Erro ao ler tabela ${tabela}:`, error.message); }',
  `        if (!error) {
          DB[tabela] = data || [];
          TABELAS_CARREGADAS.add(tabela);
          IDS_PERSISTIDOS.set(tabela, new Set((DB[tabela] || []).filter(x => x.id !== undefined && x.id !== null).map(x => String(x.id))));
        } else { DB[tabela] = []; falhas.push(tabela); console.error('Erro ao ler tabela ' + tabela + ':', error.message); }`,
  'registro de IDs carregados');
server = replaceOne(server,
  `    try {
      const { data, error } = await supabase.from('controle_sistema').select('*').limit(1).maybeSingle();`,
  `    try {
      const { data: extras, error: erroExtras } = await supabase.from('erp_extra').select('colecao,registro_id,dados');
      if (erroExtras) throw erroExtras;
      EXTRAS_CARREGADOS = true;
      IDS_EXTRAS_PERSISTIDOS.clear();
      for (const colecao of COLECOES_EXTRAS) DB[colecao] = colecao === 'ifood_config' ? null : [];
      for (const linha of (extras || [])) {
        if (!COLECOES_EXTRAS.includes(linha.colecao)) continue;
        const id = String(linha.registro_id);
        if (!IDS_EXTRAS_PERSISTIDOS.has(linha.colecao)) IDS_EXTRAS_PERSISTIDOS.set(linha.colecao, new Set());
        IDS_EXTRAS_PERSISTIDOS.get(linha.colecao).add(id);
        if (linha.colecao === 'ifood_config') DB.ifood_config = linha.dados || {};
        else DB[linha.colecao].push({ ...(linha.dados || {}), id: (linha.dados && linha.dados.id !== undefined) ? linha.dados.id : id });
      }
    } catch (e) {
      EXTRAS_CARREGADOS = false;
      falhas.push('erp_extra');
      console.error('Erro ao carregar coleções complementares:', e.message);
    }
    try {
      const { data, error } = await supabase.from('controle_sistema').select('*').limit(1).maybeSingle();`,
  'carga das coleções complementares');
// Replace the original saveDB block up to the backup section.
server = replaceRegexOne(server,
  /let salvando = false;\nfunction saveDB\(\) \{[\s\S]*?\n\}\n\n(?=\/\/ ===== BACKUP =====)/,
  `let filaSalvamento = Promise.resolve();
function saveDB() {
  if (!USAR_SUPABASE) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DB, null, 2));
    return Promise.resolve();
  }
  filaSalvamento = filaSalvamento.then(async () => {
    for (const tabela of TABELAS) {
      if (!TABELAS_CARREGADAS.has(tabela) || tabela === 'login_security') continue;
      const dados = DB[tabela] || [];
      const idsAtuais = new Set(dados.filter(x => x.id !== undefined && x.id !== null).map(x => String(x.id)));
      const idsAnteriores = IDS_PERSISTIDOS.get(tabela) || new Set();
      const removidos = [...idsAnteriores].filter(id => !idsAtuais.has(id));
      if (removidos.length) {
        const { error } = await supabase.from(tabela).delete().in('id', removidos);
        if (error) throw new Error('Falha ao excluir em ' + tabela + ': ' + error.message);
      }
      if (dados.length) {
        const { error } = await supabase.from(tabela).upsert(dados, { onConflict: 'id' });
        if (error) throw new Error('Falha ao salvar ' + tabela + ': ' + error.message);
      }
      IDS_PERSISTIDOS.set(tabela, idsAtuais);
    }
    if (EXTRAS_CARREGADOS) {
      for (const colecao of COLECOES_EXTRAS) {
        const valor = DB[colecao];
        const registros = colecao === 'ifood_config'
          ? (valor && typeof valor === 'object' ? [{ ...valor, id: 'singleton' }] : [])
          : (Array.isArray(valor) ? valor : []);
        const atuais = new Set();
        const linhas = registros.map((item, index) => {
          if (item.id === undefined || item.id === null || item.id === '') item.id = colecao + '-' + Date.now() + '-' + index;
          const registro_id = colecao === 'ifood_config' ? 'singleton' : String(item.id);
          atuais.add(registro_id);
          const dados = { ...item };
          if (colecao === 'ifood_config') delete dados.id;
          return { colecao, registro_id, dados };
        });
        const anteriores = IDS_EXTRAS_PERSISTIDOS.get(colecao) || new Set();
        const removidos = [...anteriores].filter(id => !atuais.has(id));
        if (removidos.length) {
          const { error } = await supabase.from('erp_extra').delete().eq('colecao', colecao).in('registro_id', removidos);
          if (error) throw new Error('Falha ao excluir ' + colecao + ': ' + error.message);
        }
        if (linhas.length) {
          const { error } = await supabase.from('erp_extra').upsert(linhas, { onConflict: 'colecao,registro_id' });
          if (error) throw new Error('Falha ao salvar ' + colecao + ': ' + error.message);
        }
        IDS_EXTRAS_PERSISTIDOS.set(colecao, atuais);
      }
    }
    if (DB.controle_sistema) {
      const { error } = await supabase.from('controle_sistema').upsert(DB.controle_sistema, { onConflict: 'id' });
      if (error) throw error;
    }
  }).catch(e => { console.error('Erro ao salvar no Supabase:', e.message); });
  return filaSalvamento;
}

`, 'fila de salvamento e persistência de exclusões');

// 8) Add missing DB collections to the Supabase loader.
server = replaceOne(server,
  "const TABELAS = ['unidades','funcionarios','produtos'",
  "const TABELAS = ['unidades','funcionarios','perfis_permissao','agenda','post_its','compras','devolucoes','bank_statement','produtos'",
  'tabelas de perfis, agenda, compras e devoluções');

// 9) CRUD básico: edição em vez de duplicação, e hash de senha de funcionário.
server = replaceOne(server,
  `app.post('/api/produtos/salvar', (req, res) => {
  const { id } = req.body;
  if (id) {
    const p = (DB.produtos || []).find(x => x.id == id);
    if (p) Object.assign(p, req.body);
  } else {
    DB.produtos.push({ id: nextId('produtos'), ...req.body, status: 'ATIVO' });
  }
  saveDB();
  res.json({ sucesso: true });
});`,
  `app.post('/api/produtos/salvar', (req, res) => {
  DB.produtos = DB.produtos || [];
  const dados = payloadSemAutenticacao(req.body || {});
  const id = dados.id; delete dados.id;
  if (id) {
    const p = DB.produtos.find(x => String(x.id) === String(id));
    if (!p) return res.status(404).json({ sucesso: false, erro: 'Produto não encontrado.' });
    Object.assign(p, dados);
  } else {
    DB.produtos.push({ id: nextId('produtos'), ...dados, status: 'ATIVO' });
  }
  saveDB();
  res.json({ sucesso: true });
});`,
  'edição de produtos');
server = replaceOne(server,
  `app.post('/api/clientes/salvar', (req, res) => {
  const c = { id: nextId('clientes'), ...req.body, ativo: true, data_cadastro: hoje() };
  DB.clientes.push(c);
  DB.fidelidade.push({ id: nextId('fidelidade'), cliente_id: c.id, pontos_total: 0, pontos_disponiveis: 0, pontos_resgatados: 0, valor_total_gasto: 0, atualizado_em: agora() });
  saveDB();
  res.json({ sucesso: true });
});`,
  `app.post('/api/clientes/salvar', (req, res) => {
  DB.clientes = DB.clientes || []; DB.fidelidade = DB.fidelidade || [];
  const dados = payloadSemAutenticacao(req.body || {}); const id = dados.id; delete dados.id;
  if (id) {
    const c = DB.clientes.find(x => String(x.id) === String(id));
    if (!c) return res.status(404).json({ sucesso: false, erro: 'Cliente não encontrado.' });
    Object.assign(c, dados);
  } else {
    const c = { id: nextId('clientes'), ...dados, ativo: true, data_cadastro: hoje() };
    DB.clientes.push(c);
    DB.fidelidade.push({ id: nextId('fidelidade'), cliente_id: c.id, pontos_total: 0, pontos_disponiveis: 0, pontos_resgatados: 0, valor_total_gasto: 0, atualizado_em: agora() });
  }
  saveDB(); res.json({ sucesso: true });
});`,
  'edição de clientes');
server = replaceOne(server,
  "app.post('/api/fornecedores/salvar', (req, res) => { DB.fornecedores.push({ id: nextId('fornecedores'), ...req.body, status: 'ATIVO' }); saveDB(); res.json({ sucesso: true }); });",
  `app.post('/api/fornecedores/salvar', (req, res) => {
  DB.fornecedores = DB.fornecedores || []; const dados = payloadSemAutenticacao(req.body || {}); const id = dados.id; delete dados.id;
  if (id) { const f = DB.fornecedores.find(x => String(x.id) === String(id)); if (!f) return res.status(404).json({ sucesso:false, erro:'Fornecedor não encontrado.' }); Object.assign(f, dados); }
  else DB.fornecedores.push({ id: nextId('fornecedores'), ...dados, status: 'ATIVO' });
  saveDB(); res.json({ sucesso: true });
});`,
  'edição de fornecedores');
server = replaceOne(server,
  "app.post('/api/funcionarios/salvar', (req, res) => { DB.funcionarios.push({ id: nextId('funcionarios'), ...req.body, status: 'ATIVO', data_admissao: hoje() }); saveDB(); res.json({ sucesso: true }); });",
  `app.post('/api/funcionarios/salvar', (req, res) => {
  DB.funcionarios = DB.funcionarios || []; const dados = payloadSemAutenticacao(req.body || {}); const id = dados.id; const senha = String(dados.senha || '').trim();
  delete dados.id; delete dados.senha; delete dados.senha_hash; delete dados.ultimas_senhas;
  const papel = String(dados.role || '').toLowerCase().trim();
  const perfilCustomizado = (DB.perfis_permissao || []).some(p => String(p.id) === String(dados.role));
  const nivelAlvo = perfilCustomizado ? 1 : nivelPermissaoUsuario({ role: papel, nivel_permissao: dados.nivel_permissao });
  if (!usuarioEhAdmin(req.authUser) && (nivelAlvo >= 6 || papel === 'admin' || perfilCustomizado || nivelAlvo > nivelPermissaoUsuario(req.authUser))) {
    return res.status(403).json({ sucesso:false, erro:'Você não pode atribuir um perfil superior ao seu.' });
  }
  if (id) {
    const f = DB.funcionarios.find(x => String(x.id) === String(id));
    if (!f) return res.status(404).json({ sucesso:false, erro:'Funcionário não encontrado.' });
    if (!usuarioEhAdmin(req.authUser) && String(f.id) === String(req.authUser.id)) return res.status(403).json({ sucesso:false, erro:'Não é permitido alterar o próprio cadastro por esta tela.' });
    Object.assign(f, dados); if (senha) { if (senha.length < 8) return res.status(400).json({ sucesso:false, erro:'A nova senha deve ter pelo menos 8 caracteres.' }); f.senha_hash = hashSenha(senha); }
  } else {
    if (senha.length < 8) return res.status(400).json({ sucesso:false, erro:'A senha inicial deve ter pelo menos 8 caracteres.' });
    DB.funcionarios.push({ id: nextId('funcionarios'), ...dados, senha_hash: hashSenha(senha), status: 'ATIVO', data_admissao: hoje() });
  }
  saveDB(); res.json({ sucesso:true });
});`,
  'edição e hash de funcionários');
server = replaceOne(server,
  "({ senha_hash, ultimas_senhas, ...f })",
  "({ senha_hash, senha, ultimas_senhas, ...f })",
  'remover senha da resposta de funcionários');
server = replaceOne(server,
  "app.get('/api/funcionarios', (req, res) => res.json({ funcionarios: (DB.funcionarios || []).map(({ senha_hash, senha, ultimas_senhas, ...f }) => ({ ...f, unidade_nome: ((DB.unidades || []).find(u => u.id === f.unidade_id) || {}).nome })) }));",
  "app.get('/api/funcionarios', (req, res) => res.json({ funcionarios: (DB.funcionarios || []).filter(f => !['INATIVO','ARQUIVADO'].includes(String(f.status || '').toUpperCase())).map(({ senha_hash, senha, ultimas_senhas, dados_sensiveis, ...f }) => ({ ...f, unidade_nome: ((DB.unidades || []).find(u => u.id === f.unidade_id) || {}).nome })) }));",
  'lista de funcionários sem dados sensíveis e sem arquivados');
server = replaceOne(server,
  `app.put('/api/funcionarios/:id', async (req, res) => {
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
});`,
  `app.put('/api/funcionarios/:id', (req, res) => {
  const funcionario = (DB.funcionarios || []).find(f => String(f.id) === String(req.params.id));
  if (!funcionario) return res.status(404).json({ sucesso:false, erro:'Funcionário não encontrado.' });
  const dados = payloadSemAutenticacao(req.body || {});
  const novaSenha = String(dados.senha || '');
  delete dados.id; delete dados.senha; delete dados.senha_hash; delete dados.ultimas_senhas; delete dados.dados_sensiveis;
  if (novaSenha) { if (novaSenha.length < 8) return res.status(400).json({ sucesso:false, erro:'A nova senha deve ter pelo menos oito caracteres.' }); funcionario.senha_hash = hashSenha(novaSenha); }
  Object.assign(funcionario, dados, { permissao_alterada_por:req.authUser.nome, permissao_alterada_em:agora() });
  saveDB(); const { senha_hash, senha, ultimas_senhas, dados_sensiveis, ...seguro } = funcionario;
  res.json({ sucesso:true, dados:seguro });
});`,
  'atualização segura de funcionário');


// 9a) Editing existing assets, real estate and technical sheets updates records.
server = replaceOne(server,
  `app.post('/api/patrimonio/salvar', (req, res) => {
  const codigo = 'PAT-' + new Date().getFullYear() + '-' + String((DB.patrimonio || []).length + 1).padStart(5, '0');
  DB.patrimonio.push({ id: nextId('patrimonio'), codigo_etiqueta: codigo, ...req.body, status: 'ativo', condicao_atual: req.body.condicao_atual || 'bom', data_ultima_verificacao: hoje() });
  saveDB();
  res.json({ sucesso: true, codigo_etiqueta: codigo });
});`,
  `app.post('/api/patrimonio/salvar', (req, res) => {
  DB.patrimonio = DB.patrimonio || [];
  const dados = payloadSemAutenticacao(req.body || {}); const id = dados.id; delete dados.id;
  if (id) {
    const bem = DB.patrimonio.find(x => String(x.id) === String(id));
    if (!bem) return res.status(404).json({ sucesso:false, erro:'Bem patrimonial não encontrado.' });
    Object.assign(bem, dados, { data_ultima_verificacao: hoje() });
    saveDB(); return res.json({ sucesso:true, codigo_etiqueta:bem.codigo_etiqueta });
  }
  const codigo = 'PAT-' + new Date().getFullYear() + '-' + String(DB.patrimonio.length + 1).padStart(5, '0');
  DB.patrimonio.push({ id: nextId('patrimonio'), codigo_etiqueta: codigo, ...dados, status: 'ativo', condicao_atual: dados.condicao_atual || 'bom', data_ultima_verificacao: hoje() });
  saveDB(); res.json({ sucesso: true, codigo_etiqueta: codigo });
});`,
  'edição de patrimônio');
server = replaceOne(server,
  `app.post('/api/imoveis/salvar', (req, res) => { DB.imoveis.push({ id: nextId('imoveis'), ...req.body, status: 'ativo' }); saveDB(); res.json({ sucesso: true }); });`,
  `app.post('/api/imoveis/salvar', (req, res) => {
  DB.imoveis = DB.imoveis || []; const dados = payloadSemAutenticacao(req.body || {}); const id = dados.id; delete dados.id;
  if (id) { const item = DB.imoveis.find(x => String(x.id) === String(id)); if (!item) return res.status(404).json({ sucesso:false, erro:'Imóvel não encontrado.' }); Object.assign(item, dados); }
  else DB.imoveis.push({ id: nextId('imoveis'), ...dados, status: 'ativo' });
  saveDB(); res.json({ sucesso:true });
});`,
  'edição de imóveis');
server = replaceOne(server,
  `app.post('/api/fichas-tecnicas/salvar', (req, res) => {
  const { tempo_producao_min, tempo_embalagem_min, tempo_acondicionamento_min } = req.body;
  const tempo_total = Number(tempo_producao_min || 0) + Number(tempo_embalagem_min || 0) + Number(tempo_acondicionamento_min || 0);
  DB.fichas_tecnicas.push({ id: nextId('fichas_tecnicas'), ...req.body, tempo_total_min: tempo_total, ativo: true });
  saveDB();
  res.json({ sucesso: true });
});`,
  `app.post('/api/fichas-tecnicas/salvar', (req, res) => {
  DB.fichas_tecnicas = DB.fichas_tecnicas || [];
  const dados = payloadSemAutenticacao(req.body || {}); const id = dados.id; delete dados.id;
  const tempo_total = Number(dados.tempo_producao_min || 0) + Number(dados.tempo_embalagem_min || 0) + Number(dados.tempo_acondicionamento_min || 0);
  if (id) { const ficha = DB.fichas_tecnicas.find(x => String(x.id) === String(id)); if (!ficha) return res.status(404).json({ sucesso:false, erro:'Ficha técnica não encontrada.' }); Object.assign(ficha, dados, { tempo_total_min:tempo_total }); }
  else DB.fichas_tecnicas.push({ id: nextId('fichas_tecnicas'), ...dados, tempo_total_min: tempo_total, ativo: true });
  saveDB(); res.json({ sucesso: true });
});`,
  'edição de fichas técnicas');

// 9b) Prevent duplicate receiving/refunds and make bank imports repeat-safe.
server = replaceOne(server,
  `app.post('/api/compras/receber', (req, res) => {
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
});`,
  `app.post('/api/compras/receber', (req, res) => {
  const c = (DB.compras || []).find(x => String(x.id) === String(req.body.compra_id));
  if (!c) return res.status(404).json({ sucesso:false, erro:'Compra não encontrada.' });
  if (c.status === 'recebida') return res.status(409).json({ sucesso:false, erro:'Esta compra já foi recebida; o estoque não será atualizado novamente.' });
  if (c.status === 'cancelada') return res.status(409).json({ sucesso:false, erro:'Compra cancelada não pode ser recebida.' });
  if (!Array.isArray(c.itens) || !c.itens.length) return res.status(400).json({ sucesso:false, erro:'A compra não possui itens para receber.' });
  DB.estoque = DB.estoque || [];
  for (const i of c.itens) {
    const quantidade = Number(i.qty ?? i.quantidade ?? 0);
    if (!Number.isFinite(quantidade) || quantidade <= 0) return res.status(400).json({ sucesso:false, erro:'A compra contém quantidade inválida.' });
  }
  c.itens.forEach(i => {
    const quantidade = Number(i.qty ?? i.quantidade);
    let e = DB.estoque.find(x => String(x.produto_id) === String(i.produto_id));
    if (e) e.qty = Number(e.qty || 0) + quantidade;
    else DB.estoque.push({ id:nextId('estoque'), produto_id:i.produto_id, produto_nome:i.produto_nome || i.nome || '', qty:quantidade, valor_unitario:Number(i.valor_unitario || i.preco_unitario || 0), lote:'CMP-'+c.id, validade:req.body.validade || null });
  });
  c.status = 'recebida'; c.recebido_em = agora(); c.observacao_recebimento = String(req.body.observacao || '').slice(0,500);
  saveDB(); res.json({ sucesso:true, mensagem:'Compra '+c.protocolo+' recebida! Estoque atualizado.' });
});`,
  'recebimento de compra idempotente');
server = replaceOne(server,
  `app.post('/api/devolucoes/registrar', (req, res) => {
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
});`,
  `app.post('/api/devolucoes/registrar', (req, res) => {
  DB.devolucoes = DB.devolucoes || [];
  const venda = (DB.vendas || []).find(v => String(v.id) === String(req.body?.venda_id));
  if (!venda) return res.status(404).json({ sucesso:false, erro:'Venda não encontrada.' });
  if (['ESTORNADA','DEVOLVIDA'].includes(String(venda.status || '').toUpperCase()) || DB.devolucoes.some(d => String(d.venda_id) === String(venda.id))) return res.status(409).json({ sucesso:false, erro:'Esta venda já foi devolvida ou estornada.' });
  const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
  if (!itens.length) return res.status(400).json({ sucesso:false, erro:'Informe os itens devolvidos.' });
  for (const item of itens) {
    const quantidade = Number(item.qty_devolvido ?? item.quantidade ?? 0);
    const produtoId = item.produto_id ?? item.product_id;
    const original = (venda.itens || []).find(i => String(i.product_id ?? i.produto_id) === String(produtoId));
    if (!original || !Number.isFinite(quantidade) || quantidade <= 0 || quantidade > Number(original.qty ?? original.quantidade ?? 0)) return res.status(400).json({ sucesso:false, erro:'Quantidade ou produto da devolução não confere com a venda.' });
  }
  const protocolo = 'DEV-' + hoje().replace(/-/g,'') + '-' + String(DB.devolucoes.length+1).padStart(4,'0');
  DB.devolucoes.push({ id:nextId('devolucoes'), protocolo, venda_id:venda.id, motivo:String(req.body?.motivo || '').slice(0,300), itens, criado_em:agora() });
  DB.estoque = DB.estoque || [];
  itens.forEach(i => {
    const produtoId = i.produto_id ?? i.product_id; const quantidade = Number(i.qty_devolvido ?? i.quantidade);
    let e = DB.estoque.find(x => String(x.produto_id) === String(produtoId));
    if (e) e.qty = Number(e.qty || 0) + quantidade;
    else DB.estoque.push({ id:nextId('estoque'), produto_id:produtoId, produto_nome:i.produto_nome || i.nome || '', qty:quantidade, lote:'DEV-'+protocolo });
  });
  venda.status = 'DEVOLVIDA'; venda.devolvida_em = agora(); venda.protocolo_devolucao = protocolo;
  saveDB(); res.json({ sucesso:true, protocolo, mensagem:'Devolução registrada e estoque atualizado.' });
});`,
  'devolução idempotente');
server = replaceOne(server,
  `app.post('/api/banco/extrato/importar', (req, res) => {
  DB.bank_statement = DB.bank_statement || [];
  const linhas = req.body.linhas || [];
  linhas.forEach(l => DB.bank_statement.push({ id: nextId('bank'), ...l, conciliado: false, importado_em: agora() }));
  saveDB();
  res.json({ sucesso: true, importadas: linhas.length });
});`,
  `app.post('/api/banco/extrato/importar', (req, res) => {
  DB.bank_statement = DB.bank_statement || [];
  const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas.slice(0,5000) : [];
  if (!linhas.length) return res.status(400).json({ sucesso:false, erro:'Nenhum lançamento válido foi enviado.' });
  let importadas = 0, duplicadas = 0;
  for (const l of linhas) {
    const data = String(l.data || '').slice(0,10), descricao = String(l.descricao || '').trim().slice(0,240), valor = Number(l.valor);
    if (!data || !descricao || !Number.isFinite(valor)) continue;
    const referencia = String(l.referencia || '').trim().slice(0,100);
    const repetido = DB.bank_statement.some(x => referencia && x.referencia ? String(x.referencia) === referencia : String(x.data).slice(0,10) === data && String(x.descricao).trim() === descricao && Number(x.valor) === valor);
    if (repetido) { duplicadas++; continue; }
    DB.bank_statement.push({ id:nextId('bank_statement'), data, descricao, valor, referencia, conciliado:false, importado_em:agora() }); importadas++;
  }
  if (importadas) saveDB();
  res.json({ sucesso:true, importadas, duplicadas });
});`,
  'importação de extrato sem duplicar lançamentos');

server = replaceOne(server,
  `app.get('/api/funcionarios/:id/sensiveis', async (req, res) => {
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
});`,
  `app.get('/api/funcionarios/:id/sensiveis', (req, res) => {
  if (nivelPermissaoUsuario(req.authUser) < 5 || !req.authAdmin) return res.status(403).json({ sucesso:false, erro:'Dados sensíveis exigem perfil Gerente/Admin e confirmação de administrador.' });
  const funcionario = (DB.funcionarios || []).find(f => String(f.id) === String(req.params.id));
  if (!funcionario) return res.status(404).json({ sucesso:false, erro:'Funcionário não encontrado.' });
  const dados = funcionario.dados_sensiveis && typeof funcionario.dados_sensiveis === 'object' ? funcionario.dados_sensiveis : {};
  const { senha_hash, senha, ultimas_senhas, dados_sensiveis, ...basicos } = funcionario;
  res.json({ sucesso:true, funcionario:{ ...basicos, ...dados } });
});`,
  'rota de dados sensíveis validada por sessão');

server = replaceOne(server,
  "app.get('/api/unidades', (req, res) => {\n  const unidades = (DB.unidades || []).map(u => ({",
  "app.get('/api/unidades', (req, res) => {\n  const unidades = (DB.unidades || []).filter(u => u.ativo !== false && u.status !== 'ARQUIVADO').map(u => ({",
  'filtragem de unidades arquivadas');
server = replaceOne(server,
  `app.post('/api/unidades/excluir', (req, res) => {
  const u = (DB.unidades || []).find(x => x.id == req.body.id);
  if (u && u.tipo === 'matriz') return res.json({ erro: 'Não é possível excluir a Matriz!' });
  DB.unidades = (DB.unidades || []).filter(x => x.id != req.body.id);
  saveDB();
  res.json({ sucesso: true });
});`,
  `app.post('/api/unidades/excluir', (req, res) => {
  const u = (DB.unidades || []).find(x => String(x.id) === String(req.body?.id));
  if (!u) return res.status(404).json({ sucesso:false, erro:'Unidade não encontrada.' });
  if (u.tipo === 'matriz' || u.e_matriz) return res.status(409).json({ sucesso:false, erro:'A Matriz não pode ser excluída.' });
  const vinculados = (DB.funcionarios || []).some(f => String(f.unidade_id) === String(u.id) && !['INATIVO','ARQUIVADO'].includes(String(f.status||'').toUpperCase()));
  if (vinculados) return res.status(409).json({ sucesso:false, erro:'Transfira ou inative os funcionários desta unidade antes de arquivá-la.' });
  u.ativo = false; u.status = 'ARQUIVADO'; u.excluido_em = agora();
  saveDB(); res.json({ sucesso:true });
});`,
  'exclusão segura de unidade');

// 10) Replace permissões stub by real persisted CRUD.
server = replaceRegexOne(server,
  /app\.get\('\/api\/perfis-permissao'[\s\S]*?app\.post\('\/api\/perfis-permissao',[\s\S]*?\n\}\);/,
  `app.get('/api/perfis-permissao', (req, res) => {
  DB.perfis_permissao = DB.perfis_permissao || [];
  res.json({ perfis: DB.perfis_permissao.filter(p => p.ativo !== false).sort((a,b) => String(a.nome).localeCompare(String(b.nome))), total: DB.perfis_permissao.filter(p => p.ativo !== false).length });
});
app.post('/api/perfis-permissao', (req, res) => {
  if (!usuarioEhAdmin(req.authUser)) return res.status(403).json({ sucesso:false, erro:'Somente administrador pode criar ou editar perfis.' });
  DB.perfis_permissao = DB.perfis_permissao || [];
  const nome = String(req.body?.nome || '').trim().slice(0,60);
  const descricao = String(req.body?.descricao || '').trim().slice(0,180);
  const modulos = Array.isArray(req.body?.modulos) ? [...new Set(req.body.modulos.filter(x => typeof x === 'string').map(x => x.slice(0,64)))].slice(0,100) : [];
  if (nome.length < 2 || !modulos.length) return res.status(400).json({ sucesso:false, erro:'Informe o nome e selecione ao menos um módulo.' });
  const existente = DB.perfis_permissao.find(p => String(p.nome).toLowerCase() === nome.toLowerCase() && String(p.id) !== String(req.body.id || ''));
  if (existente) return res.status(409).json({ sucesso:false, erro:'Já existe um perfil com esse nome.' });
  let perfil;
  if (req.body.id) {
    perfil = DB.perfis_permissao.find(p => String(p.id) === String(req.body.id) && p.ativo !== false);
    if (!perfil) return res.status(404).json({ sucesso:false, erro:'Perfil não encontrado.' });
    Object.assign(perfil, { nome, descricao, modulos, atualizado_em: agora() });
  } else {
    perfil = { id: nextId('perfis_permissao'), nome, descricao, modulos, ativo: true, criado_em: agora() };
    DB.perfis_permissao.push(perfil);
  }
  saveDB(); res.json({ sucesso:true, perfil });
});
app.post('/api/perfis-permissao/excluir', (req, res) => {
  if (!usuarioEhAdmin(req.authUser)) return res.status(403).json({ sucesso:false, erro:'Somente administrador pode excluir perfis.' });
  const perfil = (DB.perfis_permissao || []).find(p => String(p.id) === String(req.body?.id) && p.ativo !== false);
  if (!perfil) return res.status(404).json({ sucesso:false, erro:'Perfil não encontrado.' });
  const emUso = (DB.funcionarios || []).some(f => String(f.role) === String(perfil.id) && f.status !== 'INATIVO');
  if (emUso) return res.status(409).json({ sucesso:false, erro:'Este perfil está atribuído a funcionários. Altere esses funcionários antes de excluir.' });
  perfil.ativo = false; perfil.excluido_em = agora();
  saveDB(); res.json({ sucesso:true });
});`,
  'rotas reais de perfil de acesso');

// 11) Session endpoints and missing screens/APIs. All writes are scoped to the authenticated user.
const routes = `
// ===== SESSÃO =====
app.get('/api/session', (req, res) => {
  const { senha_hash, senha, ultimas_senhas, ...usuario } = req.authUser || {};
  res.json({ sucesso:true, usuario });
});
app.post('/api/logout', (req, res) => {
  if (req.authToken) { SESSOES_REVOGADAS.add(req.authToken); if (SESSOES_REVOGADAS.size > 10000) SESSOES_REVOGADAS.delete(SESSOES_REVOGADAS.values().next().value); }
  res.json({ sucesso:true });
});

// ===== AGENDA E POST-ITS =====
app.get('/api/agenda', (req, res) => {
  const matricula = req.authUser.matricula;
  const compromissos = (DB.agenda || []).filter(x => x.ativo !== false && x.matricula === matricula);
  res.json({ compromissos });
});
app.post('/api/agenda', (req, res) => {
  const titulo = String(req.body?.titulo || '').trim().slice(0,100);
  const data_hora = String(req.body?.data_hora || '').trim();
  if (!titulo || !data_hora || Number.isNaN(new Date(data_hora).getTime())) return res.status(400).json({ sucesso:false, erro:'Informe título e data válidos.' });
  DB.agenda = DB.agenda || [];
  const item = { id:nextId('agenda'), funcionario_id:req.authUser.id, matricula:req.authUser.matricula, titulo, data_hora:new Date(data_hora).toISOString(), descricao:String(req.body?.descricao || '').slice(0,500), ativo:true, criado_em:agora() };
  DB.agenda.push(item); saveDB(); res.json({ sucesso:true, compromisso:item });
});
app.post('/api/agenda/excluir', (req, res) => {
  const item = (DB.agenda || []).find(x => String(x.id) === String(req.body?.id) && x.matricula === req.authUser.matricula && x.ativo !== false);
  if (!item) return res.status(404).json({ sucesso:false, erro:'Compromisso não encontrado.' });
  item.ativo = false; item.excluido_em = agora(); saveDB(); res.json({ sucesso:true });
});
app.get('/api/post-its', (req, res) => {
  res.json({ notas:(DB.post_its || []).filter(x => x.ativo !== false && x.matricula === req.authUser.matricula) });
});
app.post('/api/post-its', (req, res) => {
  const titulo=String(req.body?.titulo||'').trim().slice(0,80), texto=String(req.body?.texto||'').trim().slice(0,1000);
  const cor=['amarelo','azul','verde','rosa'].includes(req.body?.cor)?req.body.cor:'amarelo';
  if(!titulo||!texto) return res.status(400).json({sucesso:false,erro:'Informe título e anotação.'});
  DB.post_its=DB.post_its||[]; DB.post_its.push({id:nextId('post_its'),funcionario_id:req.authUser.id,matricula:req.authUser.matricula,titulo,texto,cor,ativo:true,criado_em:agora()});
  saveDB(); res.json({sucesso:true});
});
app.post('/api/post-its/excluir', (req, res) => {
  const nota=(DB.post_its||[]).find(x=>String(x.id)===String(req.body?.id)&&x.matricula===req.authUser.matricula&&x.ativo!==false);
  if(!nota) return res.status(404).json({sucesso:false,erro:'Anotação não encontrada.'});
  nota.ativo=false; nota.excluido_em=agora(); saveDB(); res.json({sucesso:true});
});

// ===== PONTO E CONSULTAS DO OPERADOR =====
function dataHoraBrasil() {
  const agoraData = new Date();
  return {
    data: new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(agoraData),
    hora: new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit',hour12:false}).format(agoraData)
  };
}
function horasTrabalhadasPonto(registro) {
  if (!registro.entrada || !registro.saida) return '';
  const minutos = valor => { const [h,m]=String(valor).split(':').map(Number); return h*60+m; };
  let total = minutos(registro.saida)-minutos(registro.entrada);
  if (registro.saida_almoco && registro.retorno_almoco) total -= Math.max(0,minutos(registro.retorno_almoco)-minutos(registro.saida_almoco));
  return total > 0 ? (total/60).toFixed(2) : '0.00';
}
app.get('/api/pdv/usuario/ponto', (req, res) => {
  const registros=(DB.ponto||[]).filter(x=>x.matricula===req.authUser.matricula).sort((a,b)=>String(b.data_registro).localeCompare(String(a.data_registro))).slice(0,90);
  res.json({ registros });
});
app.post('/api/pdv/usuario/ponto', (req, res) => {
  const acao=String(req.body?.acao||'');
  if(!['entrada','saida_almoco','retorno_almoco','saida'].includes(acao)) return res.status(400).json({sucesso:false,erro:'Marcação de ponto inválida.'});
  const {data,hora}=dataHoraBrasil(); DB.ponto=DB.ponto||[];
  let registro=DB.ponto.find(x=>x.matricula===req.authUser.matricula&&x.data_registro===data);
  if(!registro){ if(acao!=='entrada') return res.status(409).json({sucesso:false,erro:'Registre a entrada antes desta marcação.'}); registro={id:nextId('ponto'),funcionario_id:req.authUser.id,matricula:req.authUser.matricula,data_registro:data}; DB.ponto.push(registro); }
  if(registro[acao]) return res.status(409).json({sucesso:false,erro:'Esta marcação já foi registrada.'});
  if(acao==='retorno_almoco'&&!registro.saida_almoco) return res.status(409).json({sucesso:false,erro:'Registre a saída para intervalo antes do retorno.'});
  if(acao==='saida'&&!registro.entrada) return res.status(409).json({sucesso:false,erro:'Registre a entrada antes da saída.'});
  if(acao==='saida_almoco'&&registro.saida) return res.status(409).json({sucesso:false,erro:'A jornada já foi encerrada.'});
  if(acao==='retorno_almoco'&&registro.saida) return res.status(409).json({sucesso:false,erro:'A jornada já foi encerrada.'});
  registro[acao]=hora; registro.atualizado_em=agora(); registro.horas_trabalhadas=horasTrabalhadasPonto(registro);
  saveDB(); res.json({sucesso:true,registro});
});
app.get('/api/pdv/usuario/consultas', (req, res) => {
  const matricula=req.authUser.matricula;
  const vendas=(DB.vendas||[]).filter(v=>v.operador_matricula===matricula||v.matricula===matricula).slice(-200).reverse();
  res.json({ vendas });
});

// ===== CONFIGURAÇÃO DO PDV =====
function lerConfigBotJson(nome, padrao) {
  const item=(DB.bot_config||[]).find(x=>x.nome===nome);
  try { return item ? JSON.parse(item.valor||'null') ?? padrao : padrao; } catch { return padrao; }
}
function gravarConfigBotJson(nome, valor) {
  DB.bot_config=DB.bot_config||[];
  let item=DB.bot_config.find(x=>x.nome===nome);
  if(!item){item={id:nextId('bot_config'),nome,valor:'{}'};DB.bot_config.push(item);}
  item.valor=JSON.stringify(valor); item.atualizado_em=agora();
}
const CONFIG_PDV_PADRAO={fundo_inicial:100,formas_pagamento:['DINHEIRO','PIX','CARTAO','BOLETO','IFOOD'],forma_padrao:'DINHEIRO',habilitar_balanca:true,rodape_cupom:'Obrigado, volte sempre!'};
app.get('/api/pdv/configuracoes',(req,res)=>res.json({configuracao:{...CONFIG_PDV_PADRAO,...lerConfigBotJson('pdv_config',{})}}));
app.post('/api/pdv/configuracoes',(req,res)=>{
  const formas=Array.isArray(req.body?.formas_pagamento)?req.body.formas_pagamento.filter(x=>['DINHEIRO','PIX','CARTAO','BOLETO','IFOOD'].includes(x)):[];
  if(!formas.length) return res.status(400).json({sucesso:false,erro:'Selecione ao menos uma forma de pagamento.'});
  const cfg={fundo_inicial:Math.max(0,Number(req.body.fundo_inicial)||0),formas_pagamento:formas,forma_padrao:formas.includes(req.body.forma_padrao)?req.body.forma_padrao:formas[0],habilitar_balanca:Boolean(req.body.habilitar_balanca),rodape_cupom:String(req.body.rodape_cupom||'').slice(0,160)};
  gravarConfigBotJson('pdv_config',cfg); saveDB(); res.json({sucesso:true,configuracao:cfg});
});

// ===== BOT: ESTADO REAL E CHAT LOCAL =====
app.get('/api/bot/status',(req,res)=>{
  const configurado=Boolean(process.env.WHATSAPP_API_URL&&process.env.WHATSAPP_API_TOKEN&&process.env.WHATSAPP_INSTANCE);
  res.json({configurado,conectado:false,status:configurado?'credenciais_configuradas':'nao_configurado',mensagem:configurado?'Credenciais configuradas; a conexão com o provedor ainda precisa ser verificada.':'Integração WhatsApp não configurada no servidor.'});
});
app.post('/api/bot/chat',(req,res)=>{
  const mensagem=String(req.body?.mensagem||'').trim().slice(0,1000);
  if(!mensagem) return res.status(400).json({sucesso:false,erro:'Digite uma mensagem.'});
  const resposta=typeof responderBot==='function'?responderBot(mensagem):'Atendimento automático indisponível no momento.';
  DB.bot_log=DB.bot_log||[]; DB.bot_log.push({id:nextId('bot_log'),remetente:'site/erp',mensagem,resposta,data:agora()}); saveDB();
  res.json({sucesso:true,resposta});
});

// ===== INTEGRAÇÕES PERSONALIZADAS =====
app.get('/api/integracoes/personalizadas',(req,res)=>res.json({integracoes:lerConfigBotJson('integracoes_personalizadas',[])}));
app.post('/api/integracoes/personalizadas',(req,res)=>{
  const nome=String(req.body?.nome||'').trim().slice(0,80); if(!nome) return res.status(400).json({sucesso:false,erro:'Informe o nome da integração.'});
  let lista=lerConfigBotJson('integracoes_personalizadas',[]); if(!Array.isArray(lista)) lista=[];
  const item={id:'int-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),nome,categoria:String(req.body?.categoria||'Outra').slice(0,40),descricao:String(req.body?.descricao||'').slice(0,240),url:String(req.body?.url||'').trim().slice(0,500),criado_em:agora()};
  if(item.url){try{const u=new URL(item.url);if(u.protocol!=='https:') return res.status(400).json({sucesso:false,erro:'A URL deve usar HTTPS.'});}catch{return res.status(400).json({sucesso:false,erro:'URL inválida.'});}}
  lista.push(item); gravarConfigBotJson('integracoes_personalizadas',lista); saveDB(); res.json({sucesso:true,integracao:item});
});
app.post('/api/integracoes/personalizadas/excluir',(req,res)=>{
  const lista=lerConfigBotJson('integracoes_personalizadas',[]); const atual=Array.isArray(lista)?lista:[];
  const nova=atual.filter(x=>String(x.id)!==String(req.body?.id)); if(nova.length===atual.length) return res.status(404).json({sucesso:false,erro:'Integração não encontrada.'});
  gravarConfigBotJson('integracoes_personalizadas',nova); saveDB(); res.json({sucesso:true});
});

// ===== ARQUIVAMENTO SEGURO DE CADASTROS =====
app.post('/api/registros/arquivar',(req,res)=>{
  const permitidas=new Set(['produtos','clientes','fornecedores','funcionarios','patrimonio','imoveis','fichas_tecnicas','eventos']);
  const colecao=String(req.body?.colecao||''); if(!permitidas.has(colecao)) return res.status(400).json({sucesso:false,erro:'Tipo de cadastro não permitido para arquivamento.'});
  const item=(DB[colecao]||[]).find(x=>String(x.id)===String(req.body?.id));
  if(!item) return res.status(404).json({sucesso:false,erro:'Cadastro não encontrado.'});
  if(colecao==='funcionarios'&&String(item.id)===String(req.authUser.id)) return res.status(409).json({sucesso:false,erro:'Não é possível arquivar o próprio usuário conectado.'});
  item.status='ARQUIVADO';
  saveDB(); res.json({sucesso:true});
});
`;
server = replaceOne(server,
  '// ===== STARTUP (carrega Supabase antes de subir) =====',
  routes + '\n// ===== STARTUP (carrega Supabase antes de subir) =====',
  'rotas ausentes do dashboard');

// 12) Keep profile ID comparisons stable (numeric ID in Supabase, string in the HTML select).
// This is handled in the separate corrected dashboard file delivered with this patch.

// 13) Avoid writing secrets / auth metadata from old customer and login code to responses.
server = server.replaceAll('res.json({clientes:data||[]});', 'res.json({clientes:(data||[]).map(({senha,senha_hash,...cliente})=>cliente)});');
// Upgrade password changes in the ERP customer-edit route to scrypt hashes.
server = replaceOne(server,
  `app.post('/api/site/cliente/editar', async (req,res)=>{
  try{
    const {id, nome, telefone, email, senha} = req.body;
    if(!id) return res.status(400).json({sucesso:false, erro:'ID obrigatório'});
    
    const update = {};
    if(nome) update.nome = nome;
    if(telefone) update.telefone = telefone;
    if(email) update.email = email.toLowerCase();
    if(senha) update.senha = senha;
    
    const {data, error} = await supabase.from('site_clientes').update(update).eq('id', id).select().single();
    if(error) throw error;
    
    res.json({sucesso:true, cliente:data});
  }catch(e){
    res.status(500).json({sucesso:false, erro:e.message});
  }
});`,
  `app.post('/api/site/cliente/editar', async (req,res)=>{
  try{
    const {id, nome, telefone, email} = req.body; const senha = String(req.body?.senha || '');
    if(!id) return res.status(400).json({sucesso:false, erro:'ID obrigatório'});
    const update = {};
    if(nome) update.nome = String(nome).trim().slice(0,100);
    if(telefone) update.telefone = String(telefone).trim().slice(0,24);
    if(email) update.email = String(email).trim().toLowerCase().slice(0,120);
    if(senha){ if(senha.length<8) return res.status(400).json({sucesso:false,erro:'A nova senha deve ter pelo menos 8 caracteres.'}); update.senha_hash=hashSenha(senha); update.senha=null; }
    const {data,error}=await supabase.from('site_clientes').update(update).eq('id',id).select().single();
    if(error) throw error;
    const {senha:senhaLegada,senha_hash,...clienteSeguro}=data;
    res.json({sucesso:true,cliente:clienteSeguro});
  }catch(e){ res.status(500).json({sucesso:false,erro:e.message}); }
});`,
  'hash de senha na edição de cliente do site');
server = server.replaceAll("insert({nome, telefone, email: email.toLowerCase(), senha, origem:'site'})", "insert({nome, telefone, email: email.toLowerCase(), senha_hash: hashSenha(senha), origem:'site'})");
server = server.replaceAll("insert({nome,telefone,email:email.toLowerCase(),senha,origem:'site'})", "insert({nome,telefone,email:email.toLowerCase(),senha_hash:hashSenha(senha),origem:'site'})");
// The old password column becomes nullable through the migration; legacy accounts are upgraded after a successful login.
server = server.replaceAll(".or(`telefone.eq.${identificador},email.eq.${idLower}`).eq('senha', senha).limit(1).single()", ".or(`telefone.eq.${identificador},email.eq.${idLower}`).limit(1).single()");
server = server.replaceAll(".or(`telefone.eq.${identificador},email.eq.${idLower}`).eq('senha', senha)", ".or(`telefone.eq.${identificador},email.eq.${idLower}`)");
// Add hash verification to customer login handlers immediately after their not-found check.
server = server.replaceAll(
  "if(error||!data) return res.status(401).json({sucesso:false, erro:'Telefone/e-mail ou senha incorretos'});",
  `if(error||!data||!(data.senha_hash ? verificarSenha(data.senha_hash, senha) : data.senha === senha)) return res.status(401).json({sucesso:false, erro:'Telefone/e-mail ou senha incorretos'});
    if(!data.senha_hash){const novoHash=hashSenha(senha);const {error:upErro}=await supabase.from('site_clientes').update({senha_hash:novoHash,senha:null}).eq('id',data.id);if(upErro) console.error('Falha ao migrar senha antiga do cliente:',upErro.message);data.senha_hash=novoHash;data.senha=null;}`);
server = server.replaceAll(
  "res.json({sucesso:true, cliente:data});",
  "const {senha,senha_hash,...clienteSeguro}=data; res.json({sucesso:true, cliente:clienteSeguro});");

// Validate patches were applied before writing.
if (!server.includes('criarTokenSessao(f)')) fail('Token seguro não foi aplicado.');
if (server.includes('AUTO-FIX ASSADOS') || server.includes("senha === '123'")) fail('Ainda há código de reset/bypass automático.');
if (!server.includes("app.post('/api/agenda'")) fail('Rotas de agenda não foram incluídas.');
if (!server.includes('x-admin-confirm-password')) fail('Confirmação administrativa não foi aplicada.');
if (!server.includes('senha.length<8||senha.length>200')) fail('Validação mínima da senha do cliente não foi aplicada.');

// Write server after every transform succeeded.
fs.writeFileSync(SERVER, server, 'utf8');

// Repair the actual entrypoint used by npm start.
pkg.main = 'server-supabase.js';
pkg.scripts = { ...(pkg.scripts || {}), start: 'node server-supabase.js', dev: 'node server-supabase.js', local: 'node server-supabase.js' };
fs.writeFileSync(PACKAGE, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

console.log('\nServidor corrigido. Próximos passos:');
console.log('1. Execute a migração sql/03-funcionalidades-operacionais.sql no SQL Editor do Supabase.');
console.log('2. Configure SESSION_SECRET com um segredo aleatório forte no ambiente do servidor.');
console.log('3. Configure SUPABASE_URL e SUPABASE_KEY (service_role somente no servidor).');
console.log('4. Faça deploy e teste /api/health, login, permissões, compras, ponto e loja.');
console.log('Backups .bak foram criados ao lado dos arquivos originais.');
