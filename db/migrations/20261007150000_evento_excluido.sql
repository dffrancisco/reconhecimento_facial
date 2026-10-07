-- migrate:target vps
-- migrate:up
-- Fica depois que o evento sai de vez: diz quem apagou e quando, e avisa a estação, que
-- apaga a parte dela (originais e cópias) na sincronização. Sem foto e sem participante.
CREATE TABLE IF NOT EXISTS evento_excluido (
    id_evento   int          PRIMARY KEY,
    nome        varchar(150) NOT NULL,
    slug        varchar(80)  NOT NULL,
    qtd_fotos   int          NOT NULL,
    id_operador int          REFERENCES operador (id_operador),
    excluido_em timestamptz  NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE IF EXISTS evento_excluido;
