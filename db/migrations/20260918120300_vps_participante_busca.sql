-- migrate:target vps
-- migrate:up
CREATE TABLE IF NOT EXISTS participante (
    id_participante serial       PRIMARY KEY,
    telefone        varchar(20)  NOT NULL UNIQUE,
    nome_whatsapp   varchar(100),
    criado_em       timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS participante_evento (
    id_participante_evento serial      PRIMARY KEY,
    id_participante        int         NOT NULL REFERENCES participante (id_participante) ON DELETE CASCADE,
    id_evento              int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    aceita_marketing       varchar(1)  NOT NULL DEFAULT 'N' CHECK (aceita_marketing IN ('S', 'N')),
    primeira_verificacao   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_participante_evento UNIQUE (id_participante, id_evento)
);

CREATE TABLE IF NOT EXISTS aparelho (
    id_aparelho            serial      PRIMARY KEY,
    id_participante_evento int         NOT NULL REFERENCES participante_evento (id_participante_evento) ON DELETE CASCADE,
    chave_hash             varchar(64) NOT NULL UNIQUE,
    criado_em              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS busca (
    id_busca         serial      PRIMARY KEY,
    id_evento        int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    token            varchar(40) NOT NULL UNIQUE,
    codigo           varchar(5),
    status           varchar(20) NOT NULL CHECK (status IN ('aguardando', 'liberada', 'expirada')),
    qtd_fotos        int         NOT NULL DEFAULT 0,
    qtd_downloads    int         NOT NULL DEFAULT 0,
    consentimento_em timestamptz NOT NULL,
    versao_termo     varchar(20) NOT NULL,
    aceita_marketing varchar(1)  NOT NULL DEFAULT 'N' CHECK (aceita_marketing IN ('S', 'N')),
    id_participante  int         REFERENCES participante (id_participante),
    -- Preenchida no "buscar de novo". SET NULL para a exclusão LGPD apagar buscas em lote.
    id_busca_origem  int         REFERENCES busca (id_busca) ON DELETE SET NULL,
    criado_em        timestamptz NOT NULL DEFAULT now(),
    verificada_em    timestamptz,
    codigo_expira_em timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_busca_codigo_aguardando ON busca (codigo) WHERE status = 'aguardando';
CREATE INDEX IF NOT EXISTS ix_busca_evento ON busca (id_evento);
CREATE INDEX IF NOT EXISTS ix_busca_participante ON busca (id_participante);

CREATE TABLE IF NOT EXISTS busca_foto (
    id_busca     int    NOT NULL REFERENCES busca (id_busca) ON DELETE CASCADE,
    id_foto      int    NOT NULL REFERENCES foto (id_foto) ON DELETE CASCADE,
    -- Rosto do melhor match. Sem FK: a exclusão LGPD apaga o rosto a partir deste valor.
    id_rosto     bigint,
    similaridade real   NOT NULL,
    PRIMARY KEY (id_busca, id_foto)
);
CREATE INDEX IF NOT EXISTS ix_busca_foto_foto ON busca_foto (id_foto);

CREATE TABLE IF NOT EXISTS arquivo_zip (
    id_arquivo_zip serial      PRIMARY KEY,
    id_evento      int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    id_busca       int         REFERENCES busca (id_busca) ON DELETE CASCADE,
    parte          int         NOT NULL DEFAULT 1,
    status         varchar(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pronto', 'erro')),
    qtd_fotos      int         NOT NULL DEFAULT 0,
    bytes          bigint,
    criado_em      timestamptz NOT NULL DEFAULT now(),
    expira_em      timestamptz NOT NULL
);

-- migrate:down
DROP TABLE IF EXISTS arquivo_zip;
DROP TABLE IF EXISTS busca_foto;
DROP TABLE IF EXISTS busca;
DROP TABLE IF EXISTS aparelho;
DROP TABLE IF EXISTS participante_evento;
DROP TABLE IF EXISTS participante;
