-- migrate:target ambos
-- migrate:up
CREATE TABLE boa (id int);

-- migrate:down
DROP TABLE boa;
