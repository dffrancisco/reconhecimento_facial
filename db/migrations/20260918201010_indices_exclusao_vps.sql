-- migrate:target vps
-- migrate:up
-- Expurgo e exclusão LGPD apagam em lote por essas colunas de FK.
CREATE INDEX IF NOT EXISTS ix_busca_origem ON busca (id_busca_origem);
CREATE INDEX IF NOT EXISTS ix_arquivo_zip_busca ON arquivo_zip (id_busca);
CREATE INDEX IF NOT EXISTS ix_arquivo_zip_evento ON arquivo_zip (id_evento);
CREATE INDEX IF NOT EXISTS ix_participante_evento_evento ON participante_evento (id_evento);
CREATE INDEX IF NOT EXISTS ix_aparelho_participante_evento ON aparelho (id_participante_evento);
CREATE INDEX IF NOT EXISTS ix_calibracao_evento ON calibracao (id_evento);

-- migrate:down
DROP INDEX IF EXISTS ix_calibracao_evento;
DROP INDEX IF EXISTS ix_aparelho_participante_evento;
DROP INDEX IF EXISTS ix_participante_evento_evento;
DROP INDEX IF EXISTS ix_arquivo_zip_evento;
DROP INDEX IF EXISTS ix_arquivo_zip_busca;
DROP INDEX IF EXISTS ix_busca_origem;
