ALTER TABLE fileinfo ADD COLUMN IF NOT EXISTS ispinned boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_fileinfo_channel_id_is_pinned ON fileinfo(channelid, ispinned);
