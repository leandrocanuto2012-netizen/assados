const express = require('express');
 const cors = require('cors');
 const fs = require('fs');
 const path = require('path');
 const crypto = require('crypto');
 const cookieParser = require('cookie-parser');
 const app = express();
 const PORT = process.env.PORT || 8080;
 app.use(cors());
 app.use(express.json());
 app.use(cookieParser());
 // ⚙️ CONFIGURAÇÕES
 const LOGIN_MAX_ATTEMPTS = 5;
 const ADMIN1_MATRICULA = "SV-2026-0001";
 const ADMIN1_WHATSAPP = "5541999999999"; // SEU NÚMERO AQUI
 const DATA_FILE = path.join(__dirname, 'data.json');
 // 🛡️ PÁGINAS PROTEGIDAS
 const paginasRestritas = [
   '/dashboard.html',
   '/caixa.html',
   '/estoque.html',
   '/funcionarios.html'
 ];
 // 🔐 Funções de senha
 async function hashSenha(senha) {
   return new Promise((resolve) => {
     crypto.scrypt(senha, 'sal_fixo_assados', 64, (_, k) => {
       resolve(k.toString('hex'));
     });
   });
 }
 async function verificarSenha(senha, hash) {
   return await hashSenha(senha) === hash;
 }
 // 📦 Ler e salvar dados
 function carregarDados() {
   try {
     if (fs.existsSync(DATA_FILE)) {
       return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
     }
   } catch (e) {
     console.error('Erro ao ler dados:', e);
   }
   return { funcionarios: [], login_security: [] };
 }
 async function salvarDados(dados) {
   fs.writeFileSync(DATA_FILE, JSON.stringify(dados, null, 2));
 }
 // 🧠 Verificar bloqueio — SEM TEMPO, só desbloqueio manual
 function verificarBloqueio(usuario) {
   if (!usuario.bloqueado) return { bloqueado: false };
   
   return {
     bloqueado: true,
     mensagem: usuario.matricula === ADMIN1_MATRICULA
       ? `⚠️ Acesso bloqueado após ${LOGIN_MAX_ATTEMPTS} tentativas. Solicite desbloqueio abaixo.`
       : `⚠️ Acesso bloqueado. Contate o administrador.`
   };
 }
 // 🛡️ PROTEGER PÁGINAS INTERNAS
 app.use((req, res, next) => {
   const ehRestrito = paginasRestritas.some(p => req.path.includes(p));
   
   if (ehRestrito) {
     const token = req.cookies?.assados_session;
     if (!token) {
       return res.redirect('/login.html');
     }
   }
   next();
 });
 // 🌐 ARQUIVOS PÚBLICOS
 app.use(express.static(__dirname));
 // 🔐 ROTA DE LOGIN
 app.post('/api/login', async (req, res) => {
   try {
     const { matricula, senha } = req.body;
     const dados = carregarDados();
     
     const usuario = dados.funcionarios.find(u => u.matricula === matricula);
     
     if (!usuario) {
       return res.status(401).json({ erro: 'Matrícula ou senha incorretos.' });
     }
     
     if (usuario.status !== 'ATIVO' && usuario.ativo !== true) {
       return res.status(403).json({ erro: 'Usuário inativo. Contate o administrador.' });
     }
     
     // ✅ Verificar bloqueio
     const statusBloqueio = verificarBloqueio(usuario);
     if (statusBloqueio.bloqueado) {
       return res.status(403).json({
         erro: statusBloqueio.mensagem,
         bloqueado: true,
         mostrarWhatsApp: usuario.matricula === ADMIN1_MATRICULA,
         whatsappLink: `https://wa.me/${ADMIN1_WHATSAPP}?text=${encodeURIComponent('Olá! Preciso desbloquear meu acesso ao sistema Assados Nobre.')}`
       });
     }
     
     // ✅ Verificar hash de senha
     const senhaHash = usuario.senha_hash || usuario.senha;
     const senhaCorreta = senhaHash 
       ? await verificarSenha(senha, senhaHash)
       : senha === usuario.senha;
     
     if (senhaCorreta) {
       usuario.tentativas_login = 0;
       
       // Atualizar login_security se existir
       if (dados.login_security) {
         const sec = dados.login_security.find(s => s.matricula === matricula);
         if (sec) {
           sec.tentativas = 0;
           sec.bloqueado_ate = null;
           sec.ultima_tentativa = new Date().toISOString();
         }
       }
       
       await salvarDados(dados);
       
       // Criar sessão
       const token = crypto.randomBytes(32).toString('hex');
       res.cookie('assados_session', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
       
       return res.json({
         sucesso: true,
         nome: usuario.nome,
         matricula: usuario.matricula,
         role: usuario.role || 'operador'
       });
     }
     
     // ❌ Senha errada
     usuario.tentativas_login = (usuario.tentativas_login || 0) + 1;
     
     // Atualizar login_security
     if (dados.login_security) {
       const sec = dados.login_security.find(s => s.matricula === matricula);
       if (sec) {
         sec.tentativas = (sec.tentativas || 0) + 1;
         sec.ultima_tentativa = new Date().toISOString();
       }
     }
     
     const restantes = LOGIN_MAX_ATTEMPTS - usuario.tentativas_login;
     
     if (usuario.tentativas_login >= LOGIN_MAX_ATTEMPTS) {
       usuario.bloqueado = true;
       usuario.tentativas_login = 0;
       
       if (dados.login_security) {
         const sec = dados.login_security.find(s => s.matricula === matricula);
         if (sec) {
           sec.tentativas = 0;
           sec.bloqueado_ate = null; // ✅ SEM TEMPO DE BLOQUEIO
         }
       }
       
       await salvarDados(dados);
       
       return res.status(403).json({
         erro: usuario.matricula === ADMIN1_MATRICULA
           ? `⚠️ Bloqueado após ${LOGIN_MAX_ATTEMPTS} tentativas.`
           : `⚠️ Bloqueado. Contate o administrador.`,
         bloqueado: true,
         mostrarWhatsApp: usuario.matricula === ADMIN1_MATRICULA,
         whatsappLink: `https://wa.me/${ADMIN1_WHATSAPP}?text=${encodeURIComponent('Olá! Preciso desbloquear meu acesso ao sistema Assados Nobre.')}`
       });
     }
     
     await salvarDados(dados);
     return res.status(401).json({
       erro: `Senha incorreta. Tentativas restantes: ${restantes}`
     });
     
   } catch (erro) {
     console.error('Erro no login:', erro);
     res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
   }
 });
 // 🔓 ROTA DE DESBLOQUEIO MANUAL
 app.post('/api/admin/desbloquear', async (req, res) => {
   try {
     const { id_usuario, senha_admin } = req.body;
     const dados = carregarDados();
     
     // Verificar se é admin
     const admin = dados.funcionarios.find(
       u => u.matricula === ADMIN1_MATRICULA && (u.status === 'ATIVO' || u.ativo === true)
     );
     
     if (!admin || !(await verificarSenha(senha_admin, admin.senha_hash || admin.senha))) {
       return res.status(403).json({ erro: 'Sem permissão.' });
     }
     
     const alvo = dados.funcionarios.find(u => u.id === parseInt(id_usuario));
     if (!alvo) {
       return res.status(404).json({ erro: 'Usuário não encontrado.' });
     }
     
     // ✅ Desbloquear
     alvo.bloqueado = false;
     alvo.tentativas_login = 0;
     
     if (dados.login_security) {
       const sec = dados.login_security.find(s => s.matricula === alvo.matricula);
       if (sec) {
         sec.tentativas = 0;
         sec.bloqueado_ate = null;
       }
     }
     
     await salvarDados(dados);
     
     res.json({ sucesso: true, mensagem: `Usuário "${alvo.nome}" desbloqueado!` });
     
   } catch {
     res.status(500).json({ erro: 'Erro ao desbloquear.' });
   }
 });
 // 🔑 RECUPERAR SENHA — Usuário solicita redefinição
 app.post('/api/recuperar-senha', async (req, res) => {
   try {
     const { matricula } = req.body;
     const dados = carregarDados();
     
     const usuario = dados.funcionarios.find(u => u.matricula === matricula);
     
     if (!usuario) {
       return res.status(404).json({ 
         mensagem: 'Se a matrícula existir, você receberá instruções.' 
       });
     }
     
     // Gerar token temporário
     const token = crypto.randomBytes(16).toString('hex');
     usuario.token_recuperacao = token;
     usuario.token_expira = Date.now() + 3600000; // 1 hora
     
     await salvarDados(dados);
     
     // Se for Admin 1 → WhatsApp
     if (matricula === ADMIN1_MATRICULA) {
       const msg = encodeURIComponent(
         `🔑 Recuperação de Senha\n\n` +
         `Olá ${usuario.nome},\n\n` +
         `Para redefinir sua senha, acesse:\n` +
         `seuendereco.com/redefinir.html?token=${token}\n\n` +
         `Válido por 1 hora.`
       );
       return res.json({
         sucesso: true,
         mensagem: 'Link de recuperação enviado para o WhatsApp.',
         whatsapp: `https://wa.me/${ADMIN1_WHATSAPP}?text=${msg}`
       });
     }
     
     // Outros usuários → avisar para contatar admin
     res.json({
       sucesso: true,
       mensagem: 'Solicitação enviada. Contate o administrador para redefinir sua senha.',
       instrucao: `Informe ao administrador sua matrícula: ${matricula}`
     });
     
   } catch {
     res.status(500).json({ erro: 'Erro ao solicitar recuperação.' });
   }
 });
 // 🔐 REDEFINIR SENHA — Pelo token ou pelo admin
 app.post('/api/redefinir-senha', async (req, res) => {
   try {
     const { token, nova_senha, matricula, senha_admin } = req.body;
     const dados = carregarDados();
     let usuario = null;
     
     // ✅ Via token (usuário sozinho)
     if (token) {
       usuario = dados.funcionarios.find(
         u => u.token_recuperacao === token && u.token_expira > Date.now()
       );
       if (!usuario) {
         return res.status(400).json({ erro: 'Link inválido ou expirado.' });
       }
     }
     // ✅ Via administrador
     else if (matricula && senha_admin) {
       const admin = dados.funcionarios.find(
         u => u.matricula === ADMIN1_MATRICULA && (u.status === 'ATIVO' || u.ativo === true)
       );
       if (!admin || !(await verificarSenha(senha_admin, admin.senha_hash || admin.senha))) {
         return res.status(403).json({ erro: 'Sem permissão de administrador.' });
       }
       usuario = dados.funcionarios.find(u => u.matricula === matricula);
       if (!usuario) {
         return res.status(404).json({ erro: 'Usuário não encontrado.' });
       }
     } else {
       return res.status(400).json({ erro: 'Dados incompletos.' });
     }
     
     // ✅ Atualizar senha
     usuario.senha_hash = await hashSenha(nova_senha);
     usuario.senha = undefined; // Remove senha em texto plano
     usuario.token_recuperacao = null;
     usuario.token_expira = null;
     
     await salvarDados(dados);
     
     res.json({ sucesso: true, mensagem: 'Senha atualizada com sucesso!' });
     
   } catch {
     res.status(500).json({ erro: 'Erro ao redefinir senha.' });
   }
 });
 // 🚪 LOGOUT
 app.post('/api/logout', (req, res) => {
   res.clearCookie('assados_session');
   res.json({ sucesso: true });
 });
 app.listen(PORT, () => {
   console.log(`✅ Servidor rodando na porta ${PORT}`);
   console.log(`🔒 Máximo de tentativas: ${LOGIN_MAX_ATTEMPTS}`);
   console.log(`📱 WhatsApp Admin: ${ADMIN1_WHATSAPP}`);
   console.log(`🔑 Recuperação de senha: ATIVADA`);
 });
