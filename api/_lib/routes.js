'use strict';

const fs = require('fs');
const path = require('path');

const HANDLERS_DIR = path.join(__dirname, '..', '_handlers');

/**
 * Roteamento file-based: api/_handlers/<nome>.js -> /api/<nome>.
 * Arquivos com prefixo "_" são auxiliares e não viram rota.
 *
 * `recarregar` (só o dev server liga) relê o arquivo do handler a cada request, para editar
 * uma rota não exigir reiniciar o processo. Fora dele o handler é carregado uma vez, no boot.
 */
function loadRoutes(app, { recarregar = false } = {}) {
  const nomes = fs
    .readdirSync(HANDLERS_DIR)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_') && !f.endsWith('.test.js'))
    .map((f) => f.replace(/\.js$/, ''));

  for (const nome of nomes) {
    const arquivo = path.join(HANDLERS_DIR, `${nome}.js`);

    // No boot, sempre: é aqui que um handler quebrado ou sem export derruba o processo cedo,
    // em vez de virar 500 no primeiro request.
    const { handler } = require(arquivo);
    if (typeof handler !== 'function') {
      throw new Error(`api/_handlers/${nome}.js precisa exportar "handler(req, res)"`);
    }

    /**
     * Só a entrada do próprio handler sai do cache — as dependências (`_lib/db.js`,
     * `_lib/auth.js`, o motor) continuam sendo o mesmo módulo. É o que preserva a troca do
     * banco que o dev server faz por require.cache, e o estado do PGlite junto.
     */
    const atual = () => {
      if (!recarregar) return handler;
      delete require.cache[require.resolve(arquivo)];
      return require(arquivo).handler;
    };

    app.all(`/api/${nome}`, (req, res) => {
      // O `async` também transforma em rejeição um erro de sintaxe do arquivo recarregado.
      Promise.resolve()
        .then(async () => atual()(req, res))
        .catch((erro) => {
          console.error(`[api/${nome}]`, erro);
          if (!res.headersSent) res.status(500).json({ erro: 'Erro interno' });
        });
    });
  }

  return nomes;
}

module.exports = { loadRoutes };
