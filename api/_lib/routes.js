'use strict';

const fs = require('fs');
const path = require('path');

const HANDLERS_DIR = path.join(__dirname, '..', '_handlers');

/**
 * Roteamento file-based: api/_handlers/<nome>.js -> /api/<nome>.
 * Arquivos com prefixo "_" são auxiliares e não viram rota.
 */
function loadRoutes(app) {
  const nomes = fs
    .readdirSync(HANDLERS_DIR)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_') && !f.endsWith('.test.js'))
    .map((f) => f.replace(/\.js$/, ''));

  for (const nome of nomes) {
    const { handler } = require(path.join(HANDLERS_DIR, `${nome}.js`));
    if (typeof handler !== 'function') {
      throw new Error(`api/_handlers/${nome}.js precisa exportar "handler(req, res)"`);
    }
    app.all(`/api/${nome}`, (req, res) => {
      Promise.resolve(handler(req, res)).catch((erro) => {
        console.error(`[api/${nome}]`, erro);
        if (!res.headersSent) res.status(500).json({ erro: 'Erro interno' });
      });
    });
  }

  return nomes;
}

module.exports = { loadRoutes };
