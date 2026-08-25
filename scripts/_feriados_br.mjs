/**
 * Feriados nacionais brasileiros, por ano.
 *
 * **Só os feriados por lei** (decisão do usuário em 25/08/2026): Lei 662/1949 e 10.607/2002
 * para os fixos, Lei 9.093/1995 para a Sexta-feira Santa e Lei 14.759/2023 para o 20 de
 * novembro, que virou feriado nacional em 2024.
 *
 * **Carnaval e Corpus Christi ficam de fora**: são ponto facultativo federal, não feriado. Se
 * a linha passar a parar neles, é acrescentar aqui — as datas saem da mesma `pascoa()`
 * (Carnaval = Páscoa − 48/− 47, Corpus Christi = Páscoa + 60).
 *
 * Feriado estadual ou municipal não entra: depende de onde a planta está. Cadastre pela rota
 * `POST /api/parametros?feriado=1`, que grava na mesma tabela `feriado`.
 */

/** Domingo de Páscoa pelo computus de Meeus/Jones/Butcher. */
export function pascoa(ano) {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(ano, mes - 1, dia))
}

const iso = (d) => d.toISOString().slice(0, 10)

/** @returns {{data: string, descricao: string}[]} ordenado por data. */
export function feriadosNacionais(ano) {
  const santa = new Date(pascoa(ano).getTime() - 2 * 864e5)

  return [
    [`${ano}-01-01`, 'Confraternização Universal'],
    [iso(santa), 'Sexta-feira Santa'],
    [`${ano}-04-21`, 'Tiradentes'],
    [`${ano}-05-01`, 'Dia do Trabalho'],
    [`${ano}-09-07`, 'Independência'],
    [`${ano}-10-12`, 'Nossa Senhora Aparecida'],
    [`${ano}-11-02`, 'Finados'],
    [`${ano}-11-15`, 'Proclamação da República'],
    [`${ano}-11-20`, 'Consciência Negra'],
    [`${ano}-12-25`, 'Natal'],
  ]
    .map(([data, descricao]) => ({ data, descricao }))
    .sort((a, b) => a.data.localeCompare(b.data))
}
