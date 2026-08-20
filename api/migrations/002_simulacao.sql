-- Simulação Ideal: o dia em que o supervisor decide que o processo vai acontecer de verdade.
--
-- Fica separado de dia_processo de propósito. dia_processo é o que a geração calculou (as 8
-- regras caso-a-caso do Código.gs, que ignoram feriados); dia_ideal é a decisão. Guardar os
-- dois dá o "gerado × ideal" e deixa simular sem mexer na Lista de demanda nem no heat map —
-- só o botão Aplicar copia um para o outro.
--
-- NULL = ainda não alocada, o que na tela é o pool de demandas por posicionar.
ALTER TABLE demanda_processo ADD COLUMN dia_ideal date;

CREATE INDEX demanda_processo_ideal_idx ON demanda_processo (cenario_id, dia_ideal);
