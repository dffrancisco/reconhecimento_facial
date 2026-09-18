-- migrate:target vps
-- migrate:up
CREATE TABLE so_vps (id int);

-- migrate:down
DROP TABLE so_vps;
