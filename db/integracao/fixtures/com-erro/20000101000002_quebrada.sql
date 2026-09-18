-- migrate:target vps
-- migrate:up
CREATE TABLE parcial (id int);
SELECT * FROM tabela_que_nao_existe;

-- migrate:down
DROP TABLE parcial;
