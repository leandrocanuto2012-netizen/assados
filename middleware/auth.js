// Middleware: verifica a sessão pelo sistema próprio do servidor (cookie/token assados_session)
const verificarSessao = (req, res, next) => {
  try {
    // require tardio evita dependência circular na inicialização
    const { usuarioPorToken } = require('../server-supabase.js');
    const usuario = usuarioPorToken(req);
    if (!usuario) return res.status(401).json({ erro: 'Sessão inválida ou expirada' });
    req.usuario = usuario;
    next();
  } catch (err) {
    return res.status(500).json({ erro: 'Erro na verificação de sessão' });
  }
};

const verificarUnidade = (req, res, next) => {
  const idUnidade = parseInt(req.headers['x-id-unidade'], 10);
  if (!idUnidade || Number.isNaN(idUnidade)) {
    return res.status(400).json({ erro: 'Unidade não informada' });
  }
  req.idUnidade = idUnidade;
  next();
};

module.exports = { verificarSessao, verificarUnidade };
