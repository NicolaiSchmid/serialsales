CREATE TABLE videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT,
  updated_at TEXT,
  thumbnail_url TEXT,
  caption_status TEXT NOT NULL DEFAULT 'pending',
  caption_language TEXT,
  transcript_r2_key TEXT,
  last_checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE transcript_segments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  start_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  text TEXT NOT NULL
);

CREATE VIRTUAL TABLE transcript_segments_fts USING fts5(
  text,
  title,
  video_id UNINDEXED,
  segment_id UNINDEXED
);

CREATE TABLE update_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_videos_published_at ON videos(published_at DESC);
CREATE INDEX idx_transcript_segments_video_id ON transcript_segments(video_id);
