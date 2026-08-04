'use strict';

const { exigirAuth } = require('../_lib/auth');
const { DESVIOS } = require('../_lib/motor/desvios');

/** Catálogo dos desvios conhecidos, para o painel de diagnóstico das telas. */
async function handler(req, res) {
  if (!exigirAuth(req, res)) return;
  res.json({ desvios: DESVIOS });
}

module.exports = { handler };
