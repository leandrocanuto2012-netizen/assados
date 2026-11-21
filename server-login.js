const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ⚙️ CONFIGURAÇÕES — AJUSTE AQUI SE PRECISAR
const LOGIN_MAX_ATTEMPTS = 5;
const ADMIN1_MATRICULA = "SV-2026-0001";
const ADMIN1_WHATSAPP = "5541999999999"; // SEU NÚMERO COM DDD — ALTERE AQUI
const DATA_FILE = path.join(__dirname, 'data.json');
// ==========================================
 // VALIDA FORÇA DA SENHA
 // ==========================================
 function validarSenha(senha) {
     const erros = [];
     
     // Mínimo 6 números
     const numeros = senha.match(/\d/g) || [];
     if (numeros.length < 6) erros.push("mínimo 6 números");
     
     // Pelo menos 2 letras
     const letras = senha.match(/[a-zA-Z]/g) || [];
     if (letras.length < 2) erros.push("mínimo 2 letras");
     
     // Pelo menos 1 maiúscula
     if (!/[A-Z]/.test(senha)) erros.push("1 letra maiúscula");
     
     // Pelo menos 1 minúscula
     if (!/[a-z]/.test(senha)) erros.push("1 letra minúscula");
     
     // Pelo menos 1 caractere especial
     if (!/[!@#$%&*?]/.test(senha)) erros.push("1 caractere especial (!@#$%&*?)");
     
     if (erros.length === 0) return { valida: true };
     return { valida: false, mensagem: "A senha precisa de: " + erros.join(", ") };
 }
// ==========================================
// PERMISSÃO DE RESET DE SENHA
// ==========================================
const ADMIN_MATRICULA = "SV-2026-0001";
const ADMIN_CELULAR = "+5541984865913";

function podeResetarSenha(matricula) {
    // SÓ o admin mestre pode resetar
    if (matricula === ADMIN_MATRICULA) {
        return { permitido: true, celular: ADMIN_CELULAR };
    }
    return { 
        permitido: false, 
        mensagem: "Usuário não permite reset de senha. Contate o administrador."
    };
}
// ==========================================
 // VERIFICA SE PRECISA TROCAR SENHA
 // ==========================================
 function precisaTrocarSenha(usuario) {
     // Se senha atual é 123 → OBRIGA troca
     return usuario.senha_temporaria === true;
 }
 function processarTrocaSenha(usuario, senhaNova, senhaRepetida) {
     // 1. Verifica se são iguais
     if (senhaNova !== senhaRepetida) {
         return { sucesso: false, mensagem: "As senhas não coincidem. Tente novamente." };
     }
     
     // 2. Valida regras da senha
     const validacao = validarSenha(senhaNova);
     if (!validacao.valida) {
         return { sucesso: false, mensagem: validacao.mensagem };
     }
     
     // 3. Tudo certo → salva nova senha
     usuario.senha_hash = hashSenha(senhaNova);
     usuario.senha_temporaria = false; // libera acesso
     
     return { sucesso: true, mensagem: "Senha alterada com sucesso!" };
 }
// ==========================================
 // FLUXO DE RESET DE SENHA
 // ==========================================
 async function solicitarResetSenha(matricula) {
     // Verifica permissão
     const permissao = podeResetarSenha(matricula);
     if (!permissao.permitido) {
         return { sucesso: false, mensagem: permissao.mensagem };
     }
     
     // Gera código de confirmação
     const codigoConfirmacao = gerarCodigo();
     
     // Salva solicitação pendente
     salvarPendenciaReset(matricula, codigoConfirmacao);
     
     // Envia SMS
     await enviarSMS(permissao.celular, 
         `Seu pedido de reset de senha foi recebido. Responda SIM para confirmar.`);
     
     return { sucesso: true, mensagem: "SMS enviado. Confirme respondendo SIM." };
 }
 async function confirmarResetSenha(matricula, resposta) {
     // Verifica se resposta é SIM
     if (resposta.trim().toUpperCase() !== "SIM") {
         return { sucesso: false, mensagem: "Reset cancelado." };
     }
     
     // Reseta senha para 123 temporariamente
     const usuario = buscarUsuario(matricula);
     usuario.senha_hash = hashSenha("123");
     usuario.senha_temporaria = true; // força troca no próximo login
     
     // Envia SMS de confirmação
     await enviarSMS(ADMIN_CELULAR,
         "Senha resetada com sucesso. Use 123 e cadastre uma nova agora.");
     
     return { sucesso: true, mensagem: "Senha resetada. Use 123 para entrar e cadastre uma nova." };
 }
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
  return { funcionarios: [] };
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

// 🌐 Páginas
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/login.html', (_, res) => res.sendFile(path.join(__dirname, 'login.html')));

// 🔐 ROTA DE LOGIN — REGRAS CORRIGIDAS
app.post('/api/login', async (req, res) => {
  try {
    const { matricula, senha } = req.body;
    const dados = carregarDados();
    
    const usuario = dados.funcionarios.find(u => u.matricula === matricula);
    
    if (!usuario) {
      return res.status(401).json({ erro: 'Matrícula ou senha incorretos.' });
    }
    
    if (!usuario.ativo) {
      return res.status(403).json({ erro: 'Usuário inativo. Contate o administrador.' });
    }
    
    // ✅ Verificar se está bloqueado
    const statusBloqueio = verificarBloqueio(usuario);
    if (statusBloqueio.bloqueado) {
      return res.status(403).json({
        erro: statusBloqueio.mensagem,
        bloqueado: true,
        mostrarWhatsApp: usuario.matricula === ADMIN1_MATRICULA,
        whatsappLink: `https://wa.me/${ADMIN1_WHATSAPP}?text=${encodeURIComponent('Olá! Preciso desbloquear meu acesso ao sistema Assados Nobre.')}`
      });
    }
    
    // ✅ Senha correta
    if (await verificarSenha(senha, usuario.senha)) {
      usuario.tentativas_login = 0;
      await salvarDados(dados);
      return res.json({
        sucesso: true,
        nome: usuario.nome,
        matricula: usuario.matricula
      });
    }
    
    // ❌ Senha errada
    usuario.tentativas_login = (usuario.tentativas_login || 0) + 1;
    const restantes = LOGIN_MAX_ATTEMPTS - usuario.tentativas_login;
    
    if (usuario.tentativas_login >= LOGIN_MAX_ATTEMPTS) {
      // 🔒 BLOQUEIA — SEM RENOVAÇÃO DE TEMPO
      usuario.bloqueado = true;
      usuario.tentativas_login = 0;
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
      u => u.matricula === ADMIN1_MATRICULA && u.ativo
    );
    
    if (!admin || !(await verificarSenha(senha_admin, admin.senha))) {
      return res.status(403).json({ erro: 'Sem permissão.' });
    }
    
    const alvo = dados.funcionarios.find(u => u.id === parseInt(id_usuario));
    if (!alvo) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }
    
    // ✅ Desbloquear
    alvo.bloqueado = false;
    alvo.tentativas_login = 0;
    await salvarDados(dados);
    
    res.json({ sucesso: true, mensagem: `Usuário "${alvo.nome}" desbloqueado!` });
    
  } catch {
    res.status(500).json({ erro: 'Erro ao desbloquear.' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Servidor de Login rodando na porta ${PORT}`);
  console.log(`🔒 Máximo de tentativas: ${LOGIN_MAX_ATTEMPTS}`);
  console.log(`📱 WhatsApp Admin: ${ADMIN1_WHATSAPP}`);
});
