DROP INDEX IF EXISTS idx_fileinfo_channel_id_is_pinned;

ALTER TABLE fileinfo DROP COLUMN IF EXISTS ispinned;
