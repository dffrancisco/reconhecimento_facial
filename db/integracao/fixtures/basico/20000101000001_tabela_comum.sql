-- migrate:target ambos
-- migrate:up
CREATE TABLE comum (id int);

-- migrate:down
DROP TABLE comum;
