-- migrate:target vps
-- migrate:up
CREATE TABLE IF NOT EXISTS calibracao (
    id_calibracao serial      PRIMARY KEY,
    id_evento     int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    rotulo        varchar(60) NOT NULL,
    -- [{ similaridade, correta }]: sem imagem nem vetor.
    amostras      jsonb       NOT NULL,
    criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evento_resumo (
    id_evento                int         PRIMARY KEY REFERENCES evento (id_evento) ON DELETE CASCADE,
    qtd_fotos                int         NOT NULL DEFAULT 0,
    qtd_buscas               int         NOT NULL DEFAULT 0,
    qtd_buscas_com_resultado int         NOT NULL DEFAULT 0,
    qtd_verificados          int         NOT NULL DEFAULT 0,
    qtd_leads_marketing      int         NOT NULL DEFAULT 0,
    qtd_downloads            int         NOT NULL DEFAULT 0,
    qtd_zips                 int         NOT NULL DEFAULT 0,
    congelado_em             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS estacao_sinal (
    id_estacao_sinal serial      PRIMARY KEY,
    recebido_em      timestamptz NOT NULL DEFAULT now(),
    dados            jsonb       NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_estacao_sinal_recebido ON estacao_sinal (recebido_em);

CREATE TABLE IF NOT EXISTS log (
    id_log      serial      PRIMARY KEY,
    id_operador int         REFERENCES operador (id_operador),
    tela        varchar(60) NOT NULL,
    log         text        NOT NULL,
    criado_em   timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE IF EXISTS log;
DROP TABLE IF EXISTS estacao_sinal;
DROP TABLE IF EXISTS evento_resumo;
DROP TABLE IF EXISTS calibracao;
