-- migrate:target estacao
-- migrate:up
ALTER TABLE evento ADD COLUMN IF NOT EXISTS encerrado_em timestamptz;

CREATE TABLE IF NOT EXISTS upload (
    id_upload           serial       PRIMARY KEY,
    id_evento_fotografo int          NOT NULL REFERENCES evento_fotografo (id_evento_fotografo),
    nome_arquivo        varchar(255) NOT NULL,
    tamanho             bigint       NOT NULL,
    hash_arquivo        varchar(64)  NOT NULL,
    bytes_recebidos     bigint       NOT NULL DEFAULT 0,
    status              varchar(20)  NOT NULL DEFAULT 'recebendo' CHECK (status IN ('recebendo', 'completo', 'cancelado')),
    criado_em           timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_upload_fotografo_hash ON upload (id_evento_fotografo, hash_arquivo);

CREATE TABLE IF NOT EXISTS foto (
    id_foto             serial       PRIMARY KEY,
    id_evento           int          NOT NULL REFERENCES evento (id_evento),
    id_evento_fotografo int          REFERENCES evento_fotografo (id_evento_fotografo),
    hash_arquivo        varchar(64)  NOT NULL,
    nome_arquivo        varchar(255) NOT NULL,
    caminho_original    text,
    largura             int,
    altura              int,
    bytes_original      bigint,
    bytes_web           int,
    capturada_em        timestamptz,
    camera              varchar(80),
    qtd_rostos          int,
    etapa               varchar(20)  NOT NULL DEFAULT 'registrada'
                        CHECK (etapa IN ('registrada', 'original', 'rostos', 'derivados', 'publicada')),
    erro                text,
    erro_etapa          varchar(20),
    criado_em           timestamptz  NOT NULL DEFAULT now(),
    processada_em       timestamptz,
    publicada_em        timestamptz,
    CONSTRAINT ux_foto_evento_hash UNIQUE (id_evento, hash_arquivo)
);
CREATE INDEX IF NOT EXISTS ix_foto_etapa ON foto (id_evento, etapa);

-- Igual à VPS, sem o índice HNSW: a estação não faz busca.
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
DROP TABLE IF EXISTS upload;
ALTER TABLE evento DROP COLUMN IF EXISTS encerrado_em;
