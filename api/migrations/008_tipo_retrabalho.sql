-- "Retrabalho" entra no enum `tipo_linha`, para a Lista de demanda poder classificar assim uma
-- linha manual.
--
-- Escopo deliberado (decisão do usuário): o tipo vale só na demanda. `Processos e sequências`
-- segue oferecendo três tipos, então **nenhum processo nasce como retrabalho** — e por isso a
-- explosão não precisou mudar: `explosao.js` casa por `TIPOS_DA_PRODUCAO` (defasagem +
-- produção/montagem) ou por `industrializacao`, e retrabalho não está em nenhum dos dois.
-- Retrabalho é atividade não planejada; quem a lança é o supervisor, na mão.
--
-- Vai no FIM da ordem do enum de propósito: várias consultas fazem `ORDER BY tipo_linha`
-- (demandas.js, roteiros.js, simulacao.js) e a ordenação de um enum é a ordem de declaração.
-- Inserir no meio reordenaria telas que ninguém pediu para mexer.
--
-- `IF NOT EXISTS` para a migration ser reentrante. Desde o PG 12 isto roda dentro de transação
-- (o runner de `db.js` envolve cada arquivo em uma) — a restrição que sobra é não USAR o valor
-- novo na mesma transação, e aqui não se usa.

ALTER TYPE tipo_linha ADD VALUE IF NOT EXISTS 'retrabalho' AFTER 'producao_montagem';
