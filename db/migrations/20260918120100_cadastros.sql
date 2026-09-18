-- migrate:target ambos
-- migrate:up
-- Na estação estas tabelas são cópias da VPS, gravadas com os mesmos IDs pela sincronização.
CREATE TABLE IF NOT EXISTS operador (
    id_operador serial       PRIMARY KEY,
    nome        varchar(100) NOT NULL,
    login       varchar(60)  NOT NULL UNIQUE,
    senha_hash  varchar(200) NOT NULL,
    deletado    varchar(1)   NOT NULL DEFAULT 'N' CHECK (deletado IN ('S', 'N')),
    criado_em   timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evento (
    id_evento       serial       PRIMARY KEY,
    nome            varchar(150) NOT NULL,
    slug            varchar(80)  NOT NULL UNIQUE,
    tipo            varchar(20)  NOT NULL CHECK (tipo IN ('esportivo', 'social')),
    privado         varchar(1)   NOT NULL DEFAULT 'N' CHECK (privado IN ('S', 'N')),
    chave_acesso    varchar(40)  UNIQUE,
    chave_anfitriao varchar(40)  NOT NULL UNIQUE,
    data_inicio     date,
    data_fim        date         NOT NULL,
    ativo           varchar(1)   NOT NULL DEFAULT 'S' CHECK (ativo IN ('S', 'N')),
    config          jsonb        NOT NULL DEFAULT '{}',
    expurgado_em    timestamptz,
    deletado        varchar(1)   NOT NULL DEFAULT 'N' CHECK (deletado IN ('S', 'N')),
    criado_em       timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ck_evento_privado_com_chave CHECK (privado = 'N' OR chave_acesso IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS fotografo (
    id_fotografo serial       PRIMARY KEY,
    nome         varchar(100) NOT NULL,
    telefone     varchar(20),
    deletado     varchar(1)   NOT NULL DEFAULT 'N' CHECK (deletado IN ('S', 'N')),
    criado_em    timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evento_fotografo (
    id_evento_fotografo serial      PRIMARY KEY,
    id_evento           int         NOT NULL REFERENCES evento (id_evento),
    id_fotografo        int         NOT NULL REFERENCES fotografo (id_fotografo),
    token_upload        varchar(40) NOT NULL UNIQUE,
    ativo               varchar(1)  NOT NULL DEFAULT 'S' CHECK (ativo IN ('S', 'N')),
    criado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_evento_fotografo UNIQUE (id_evento, id_fotografo)
);

-- migrate:down
DROP TABLE IF EXISTS evento_fotografo;
DROP TABLE IF EXISTS fotografo;
DROP TABLE IF EXISTS evento;
DROP TABLE IF EXISTS operador;
