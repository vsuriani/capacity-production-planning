'use strict';

const { exigirAuth } = require('../_lib/auth');

async function handler(req, res) {
  const email = exigirAuth(req, res);
  if (!email) return;
  res.json({ email });
}

module.exports = { handler };
