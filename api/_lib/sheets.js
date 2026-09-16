'use strict';

/**
 * Leitura de uma aba do Google Sheets com service account.
 *
 * Feito na mão, com `crypto` e `fetch` nativos, em vez de `googleapis`. O runtime do app tem
 * duas dependências no total (`express` e `pg`, ver api/package.json) e o cluster é air-gapped —
 * `googleapis` traria ~50 pacotes transitivos para fazer o que cabe em 40 linhas: assinar um JWT,
 * trocar por um access token e fazer um GET.
 *
 * Escopo somente leitura, sempre. Este app NUNCA escreve em planilha — a de Dimensionamento é
 * usada diariamente pelo PCP e tem 18 editores, e a de tempos é da Engenharia.
 *
 * A credencial chega pelo ambiente, nunca do disco do repo:
 *
 *   GOOGLE_SA_JSON   o JSON da service account inteiro, como string
 *
 * É o formato que sai de um secret manager (e do GitHub Secrets, no deploy das Pis). Em dev dá
 * para apontar GOOGLE_APPLICATION_CREDENTIALS para o arquivo, que `credencial()` também aceita.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');

const ESCOPO = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';

const base64url = (entrada) =>
  Buffer.from(entrada).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Prioridade: GOOGLE_SA_JSON (produção) > GOOGLE_APPLICATION_CREDENTIALS (dev).
 * Devolve null quando não há credencial — quem chama decide se isso é erro ou se é só
 * "o sync não está configurado neste ambiente".
 */
function credencial() {
  const inline = process.env.GOOGLE_SA_JSON;
  if (inline && inline.trim()) return JSON.parse(inline);

  const caminho = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (caminho && fs.existsSync(caminho)) {
    return JSON.parse(fs.readFileSync(caminho, 'utf8'));
  }
  return null;
}

const configurado = () => credencial() !== null;

/**
 * Access token via JWT bearer (RFC 7523), que é o fluxo de service account sem usuário.
 *
 * Cache até 60 s antes do vencimento: o sync roda de hora em hora no máximo, então o cache é
 * quase sempre irrelevante — existe para o caso de um `?acao=sync` manual em sequência.
 */
let cache = { token: null, expiraEm: 0 };

async function token() {
  const agora = Math.floor(Date.now() / 1000);
  if (cache.token && agora < cache.expiraEm - 60) return cache.token;

  const sa = credencial();
  if (!sa) throw new Error('credencial da service account ausente (GOOGLE_SA_JSON)');
  if (!sa.client_email || !sa.private_key) {
    throw new Error('JSON da service account sem client_email/private_key');
  }

  const cabecalho = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: ESCOPO,
      aud: TOKEN_URL,
      iat: agora,
      exp: agora + 3600,
    }),
  );

  const assinatura = crypto
    .createSign('RSA-SHA256')
    .update(`${cabecalho}.${corpo}`)
    .sign(sa.private_key);

  const jwt = `${cabecalho}.${corpo}.${base64url(assinatura)}`;

  const resposta = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    // `error_description` do Google costuma dizer exatamente o que está errado ("Invalid JWT
    // Signature", "Not authorized"), e é o que a tela vai mostrar em tempo_sync.erro.
    throw new Error(
      `token recusado (${resposta.status}): ${dados.error_description || dados.error || 'sem detalhe'}`,
    );
  }

  cache = { token: dados.access_token, expiraEm: agora + Number(dados.expires_in || 3600) };
  return cache.token;
}

/**
 * Lê uma aba inteira e devolve objetos, usando a primeira linha como cabeçalho.
 *
 * O cabeçalho passa por trim: a aba Perfomancedev tem a coluna `"process "`, com espaço no fim,
 * e ninguém deveria ter que saber disso do lado de cá.
 *
 * Linhas curtas são completadas com string vazia — o Sheets corta a linha no último preenchido,
 * então sem isso a última coluna some justamente nas linhas incompletas, que são as que
 * interessam para diagnóstico.
 */
async function lerAba(spreadsheetId, aba) {
  const acesso = await token();
  const url = `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(aba)}`;

  const resposta = await fetch(url, { headers: { Authorization: `Bearer ${acesso}` } });
  if (!resposta.ok) {
    const texto = await resposta.text().catch(() => '');
    throw new Error(`leitura da aba "${aba}" falhou (${resposta.status}): ${texto.slice(0, 200)}`);
  }

  const { values } = await resposta.json();
  if (!Array.isArray(values) || values.length === 0) return [];

  const colunas = values[0].map((c) => String(c ?? '').trim());
  return values
    .slice(1)
    .filter((linha) => linha.some((c) => String(c ?? '').trim() !== ''))
    .map((linha) =>
      Object.fromEntries(colunas.map((coluna, i) => [coluna, String(linha[i] ?? '').trim()])),
    );
}

module.exports = { lerAba, credencial, configurado };
