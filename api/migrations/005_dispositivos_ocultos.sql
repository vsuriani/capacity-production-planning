-- Dispositivo fora de uso sai das telas e da conta por `ativo = false`, nunca por DELETE.
--
-- As FKs de cenario_meta, cenario_demanda, cenario_formula_par, metrica_componente,
-- dispositivo_metrica e global_ajuste são todas ON DELETE CASCADE: apagar a linha levaria junto
-- a meta e a demanda gravadas nos 24 cenários importados da planilha. Marcar inativo esconde sem
-- perder o histórico, e voltar atrás é o UPDATE inverso.
--
--   "Ima na Base"  — saiu de uso.
--   "Tampografia"  — do Planejamento Mensal antigo; o Semanal já quebrou em "Tampografia Case"
--                    e "Tampografia Sensor", que continuam ativos.

UPDATE dispositivo SET ativo = false WHERE nome IN ('Ima na Base', 'Tampografia');
