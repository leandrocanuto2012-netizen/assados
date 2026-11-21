const express = require('express');
 const cors = require('cors');
 const fs = require('fs');
 const path = require('path');
 const crypto = require('crypto');
 const cookieParser = require('cookie-parser');
 const { createClient } = require('@supabase/supabase-js');
 const app = express();
 const PORT = process.env.PORT || 8080;
 app.use(cors());
 app.use(express.json());
 app.use(cookieParser());
 // ⚙️ CONFIGURAÇÕES
 const LOGIN_MAX_ATTEMPTS = 5;
 const ADMIN1_MATRICULA = "SV-2026-0001";
 const ADMIN1_WHATSAPP = "5541999999999";
 // 🛡️ PÁGINAS PROTEGIDAS
 const paginasRestritas = [
   '/dashboard.html',
   '/caixa.html',
   '/estoque.html',
   '/funcionarios.html',
   '/contabilidade.html',
   '/relatorios.html'
 ];
 // 🔗 SUPABASE
 const supabaseUrl = process.env.SUPABASE_URL;
 const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
 const supabase = createClient(supabaseUrl, supabaseKey);
 // 🧠 Verificar bloqueio — SEM TEMPO, só desbloqueio manual
 function verificarBloqueio(usuario) {
   if (!usuario.bloqueado) return { bloqueado: false };
   
   return {
     bloqueado: true,
     mensagem: usuario.matricula === ADMIN1_MATRICULA
       ? `⚠️ Acesso bloqueado após ${LOGIN_MAX_ATTEMPTS} tentativas. Contate o administrador.`
       : `⚠️ Acesso bloqueado. Contate o administrador da sua unidade.`
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
 // 🏠 RAIZ → REDIRECIONA PARA LOGIN
 app.get('/', (_, res) => {
   res.redirect('/login.html');
 });
 // 🌐 ARQUIVOS PÚBLICOS — pasta public
 app.use(express.static(path.join(__dirname, 'public')));
 // 🔐 ROTA DE LOGIN
 app.post('/api/login', async (req, res) => {
   try {
     const { matricula, senha } = req.body;
     
     const { data: usuario, error } = await supabase
       .from('funcionarios')
       .select('*')
       .eq('matricula', matricula)
       .single();
     
     if (error || !usuario) {
       return res.status(401).json({ erro: 'Matrícula ou senha incorretos.' });
     }
     
     if (usuario.ativo !== true) {
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
     
     // ✅ Verificar senha
     const senhaCorreta = senha === 'admin123';
     
     if (senhaCorreta) {
       // Resetar tentativas
       await supabase
         .from('funcionarios')
         .update({ tentativas_login: 0 })
         .eq('id', usuario.id);
       
       // Criar sessão
       const token = crypto.randomBytes(32).toString('hex');
       res.cookie('assados_session', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 });
       
       return res.json({
         sucesso: true,
         nome: usuario.nome,
         matricula: usuario.matricula,
         role: usuario.role || 'operador',
         unidade_id: usuario.unidade_id
       });
     }
     
     // ❌ Senha errada
     const novasTentativas = (usuario.tentativas_login || 0) + 1;
     
     if (novasTentativas >= LOGIN_MAX_ATTEMPTS) {
       await supabase
         .from('funcionarios')
         .update({ bloqueado: true, tentativas_login: 0 })
         .eq('id', usuario.id);
       
       return res.status(403).json({
         erro: usuario.matricula === ADMIN1_MATRICULA
           ? `⚠️ Bloqueado após ${LOGIN_MAX_ATTEMPTS} tentativas.`
           : `⚠️ Bloqueado. Contate o administrador.`,
         bloqueado: true,
         mostrarWhatsApp: usuario.matricula === ADMIN1_MATRICULA,
         whatsappLink: `https://wa.me/${ADMIN1_WHATSAPP}?text=${encodeURIComponent('Olá! Preciso desbloquear meu acesso ao sistema Assados Nobre.')}`
       });
     }
     
     await supabase
       .from('funcionarios')
       .update({ tentativas_login: novasTentat
