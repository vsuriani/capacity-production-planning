'use strict';

/**
 * Auth pelo gateway da Vibe: o proxy injeta X-Auth-Email em toda request que chega
 * ao cluster. Não implementamos login — só lemos o header.
 *
 * No dev local o header não existe; aceitamos DEV_FAKE_EMAIL apenas fora de produção.
 *
 * Nas Raspberry da rede interna também não há gateway, mas o container roda com
 * NODE_ENV=production — daí AUTH_FALLBACK_EMAIL, que vale em qualquer ambiente e é
 * explícito o bastante para não ser ligado por acidente. Quem define é o deploy.
 */
function emailDoUsuario(req) {
  const doGateway = req.headers['x-auth-email'];
  if (typeof doGateway === 'string' && doGateway.endsWith('@tractian.com')) {
    return doGateway;
  }
  const fixo = process.env.AUTH_FALLBACK_EMAIL;
  if (typeof fixo === 'string' && fixo.endsWith('@tractian.com')) {
    return fixo;
  }
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_FAKE_EMAIL) {
    return process.env.DEV_FAKE_EMAIL;
  }
  return null;
}

/**
 * Responde 401 e retorna null quando não há usuário — o handler deve dar `return`.
 */
function exigirAuth(req, res) {
  const email = emailDoUsuario(req);
  if (!email) {
    res.status(401).json({ erro: 'Não autenticado' });
    return null;
  }
  return email;
}

module.exports = { emailDoUsuario, exigirAuth };
