-- migrate:target estacao
-- migrate:up
CREATE TABLE so_estacao (id int);

-- migrate:down
DROP TABLE so_estacao;
