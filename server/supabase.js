require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
let isConfigured = false;

if (supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project-id')) {
    try {
        supabase = createClient(supabaseUrl, supabaseKey, {
            auth: { persistSession: false }
        });
        isConfigured = true;
        console.log('⚡ Supabase client initialized successfully.');
    } catch (err) {
        console.warn('⚠️ Failed to initialize Supabase client:', err.message);
    }
} else {
    console.log('ℹ️ Supabase credentials not set. Running with high-performance in-memory room persistence.');
}

/**
 * Checks if Supabase is connected.
 * @returns {boolean}
 */
function isSupabaseEnabled() {
    return isConfigured && supabase !== null;
}

/**
 * Fetches room record and snapshot from Supabase PostgreSQL by code.
 * @param {string} code
 * @returns {Promise<Object|null>}
 */
async function fetchRoomFromDB(code) {
    if (!isSupabaseEnabled()) return null;

    try {
        const cleanCode = String(code).trim().toUpperCase();
        const { data, error } = await supabase
            .from('rooms')
            .select('*')
            .eq('code', cleanCode)
            .single();

        if (error) {
            if (error.code !== 'PGRST116') { // PGRST116 = no rows returned
                console.warn(`[Supabase] Error fetching room ${cleanCode}:`, error.message);
            }
            return null;
        }

        return data;
    } catch (err) {
        console.error('[Supabase] Unexpected error fetching room:', err.message);
        return null;
    }
}

/**
 * Creates or updates a room record in Supabase.
 * @param {string} code
 * @param {string} name
 * @param {Object} snapshot
 * @returns {Promise<Object|null>}
 */
async function saveRoomToDB(code, name = 'Untitled Canvas', snapshot = null) {
    if (!isSupabaseEnabled()) return null;

    try {
        const cleanCode = String(code).trim().toUpperCase();
        const payload = {
            code: cleanCode,
            name: name || `Canvas ${cleanCode}`,
            updated_at: new Date().toISOString()
        };

        if (snapshot) {
            payload.snapshot = snapshot;
        }

        const { data, error } = await supabase
            .from('rooms')
            .upsert(payload, { onConflict: 'code' })
            .select()
            .single();

        if (error) {
            console.warn(`[Supabase] Error saving room ${cleanCode}:`, error.message);
            return null;
        }

        return data;
    } catch (err) {
        console.error('[Supabase] Unexpected error saving room:', err.message);
        return null;
    }
}

/**
 * Updates snapshot of an existing room in Supabase (debounced/background).
 * @param {string} code
 * @param {Object} snapshot
 */
async function updateRoomSnapshotInDB(code, snapshot) {
    if (!isSupabaseEnabled()) return;

    try {
        const cleanCode = String(code).trim().toUpperCase();
        const { error } = await supabase
            .from('rooms')
            .update({
                snapshot,
                updated_at: new Date().toISOString()
            })
            .eq('code', cleanCode);

        if (error) {
            console.warn(`[Supabase] Error updating snapshot for ${cleanCode}:`, error.message);
        }
    } catch (err) {
        console.error('[Supabase] Failed updating snapshot:', err.message);
    }
}

module.exports = {
    isSupabaseEnabled,
    fetchRoomFromDB,
    saveRoomToDB,
    updateRoomSnapshotInDB
};
