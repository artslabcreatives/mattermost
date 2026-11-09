ALTER TABLE channels ADD COLUMN IF NOT EXISTS lastpictureupdate bigint DEFAULT 0;
ALTER TABLE usergroups ADD COLUMN IF NOT EXISTS lastpictureupdate bigint DEFAULT 0;
