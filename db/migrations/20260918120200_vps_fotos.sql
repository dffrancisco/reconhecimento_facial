-- migrate:target vps
-- migrate:up
CREATE TABLE IF NOT EXISTS evento_patrocinador (
    id_evento_patrocinador serial       PRIMARY KEY,
    id_evento              int          NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    nome                   varchar(100) NOT NULL,
    site                   varchar(255),
    ordem                  int          NOT NULL DEFAULT 0,
    criado_em              timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_evento_patrocinador_evento ON evento_patrocinador (id_evento);

CREATE TABLE IF NOT EXISTS foto (
    id_foto             serial      PRIMARY KEY,
    id_evento           int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    id_evento_fotografo int         REFERENCES evento_fotografo (id_evento_fotografo),
    hash_arquivo        varchar(64) NOT NULL,
    largura             int         NOT NULL,
    altura              int         NOT NULL,
    bytes_web           int         NOT NULL,
    capturada_em        timestamptz,
    camera              varchar(80),
    qtd_rostos          int         NOT NULL DEFAULT 0,
    publicada_em        timestamptz NOT NULL DEFAULT now(),
    situacao            varchar(20) NOT NULL DEFAULT 'visivel' CHECK (situacao IN ('visivel', 'oculta', 'excluida')),
    situacao_em         timestamptz,
    CONSTRAINT ux_foto_evento_hash UNIQUE (id_evento, hash_arquivo)
);

CREATE TABLE IF NOT EXISTS rosto (
    id_rosto  bigserial   PRIMARY KEY,
    id_foto   int         NOT NULL REFERENCES foto (id_foto) ON DELETE CASCADE,
    id_evento int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    embedding vector(512) NOT NULL,
    bbox      jsonb       NOT NULL,
    det_score real        NOT NULL,
    area_px   int         NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_rosto_foto ON rosto (id_foto);
CREATE INDEX IF NOT EXISTS ix_rosto_embedding ON rosto
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);

-- Vazia até a Fase 2 do produto (OCR do número de peito).
CREATE TABLE IF NOT EXISTS numero_peito (
    id_numero_peito bigserial   PRIMARY KEY,
    id_foto         int         NOT NULL REFERENCES foto (id_foto) ON DELETE CASCADE,
    id_evento       int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    numero          varchar(20) NOT NULL,
    confianca       real        NOT NULL,
    bbox            jsonb       NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_numero_peito_evento ON numero_peito (id_evento, numero);
CREATE INDEX IF NOT EXISTS ix_numero_peito_foto ON numero_peito (id_foto);

-- migrate:down
DROP TABLE IF EXISTS numero_peito;
DROP TABLE IF EXISTS rosto;
DROP TABLE IF EXISTS foto;
DROP TABLE IF EXISTS evento_patrocinador;
