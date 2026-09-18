-- migrate:target estacao
-- migrate:up
-- Encerramento apaga os rostos do evento.
CREATE INDEX IF NOT EXISTS ix_rosto_evento ON rosto (id_evento);

-- migrate:down
DROP INDEX IF EXISTS ix_rosto_evento;
