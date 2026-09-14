-- ==========================================================
-- CanvasCollab • Supabase PostgreSQL Schema
-- ==========================================================
-- Run this script in the Supabase SQL Editor (Dashboard > SQL Editor)
-- to initialize the database tables, indices, and RLS policies.

-- 1. Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR(12) UNIQUE NOT NULL,
    name TEXT DEFAULT 'Untitled Canvas',
    snapshot JSONB DEFAULT '{"operations": [], "activeCount": 0}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Index for instant room code lookups
CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);

-- 3. Automatic timestamp updater function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trigger_rooms_updated_at ON rooms;
CREATE TRIGGER trigger_rooms_updated_at
    BEFORE UPDATE ON rooms
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 4. Enable Row Level Security (RLS)
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- 5. Open collaborative access policies
-- Anyone with the room code/link can read, insert, and update room drawings
CREATE POLICY "Public read access for rooms"
    ON rooms FOR SELECT
    USING (true);

CREATE POLICY "Public insert access for rooms"
    ON rooms FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Public update access for rooms"
    ON rooms FOR UPDATE
    USING (true);
