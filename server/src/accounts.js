// Player accounts on the match server: who a signed-in player is, and
// recording finished matches (which moves ranked ratings).
//
// The server holds the service role key and is the ONLY writer of results.
// Clients never report their own win; the duel is simulated here, and what
// this file records is what actually happened.
//
// Without SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY everything here is a
// no-op, so local development and the socket tests run with guests only.
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = URL && KEY
  ? createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

export const accountsEnabled = !!db;

// Resolve a client's access token to its account. Returns null for guests,
// expired or forged tokens, or when accounts are not configured.
export async function identify(token) {
  if (!db || typeof token !== 'string' || !token || token.length > 4096) return null;
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) return null;
    const { data: profile } = await db
      .from('profiles')
      .select('display_name, rating')
      .eq('id', data.user.id)
      .single();
    return {
      id: data.user.id,
      name: profile?.display_name || null,
      rating: profile?.rating ?? 1000,
    };
  } catch (err) {
    console.error('[accounts] identify failed:', err.message);
    return null;
  }
}

// Record a finished match. `a` and `b` are the room's two players (side 0 and
// 1). Rated only when it was a quick match between two signed-in players; the
// database function decides that, inside one transaction.
export async function recordMatch({ mode, a, b, result, reason, durationMs, hpA, hpB }) {
  if (!db) return null;
  try {
    const { data, error } = await db.rpc('record_match', {
      p_mode: mode,
      p_player_a: a.userId || null,
      p_player_b: b.userId || null,
      p_name_a: a.name,
      p_name_b: b.name,
      p_result: result,
      p_reason: reason,
      p_duration_ms: Math.max(0, Math.round(durationMs)),
      p_hp_a: Math.max(0, Math.round(hpA)),
      p_hp_b: Math.max(0, Math.round(hpB)),
    });
    if (error) {
      console.error('[accounts] record_match failed:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.error('[accounts] record_match failed:', err.message);
    return null;
  }
}
