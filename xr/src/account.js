// Player accounts in the game: sign in with Apple or Google, your profile and
// rating, the leaderboard, and match history. Guests keep playing without an
// account; their record is kept on this device only.
//
// Built for three homes at once:
//   * web      — the OAuth redirect returns to this page, and the session is
//                picked up from the URL.
//   * iOS / Android app — the sign-in page opens in the system's secure
//                in-app browser and returns through the runeduel://auth link,
//                where the one-time code is exchanged for a session (PKCE).
//
// Without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY accounts are simply
// unavailable and the game is guest-only, exactly as before.
import { createClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';

const URL = import.meta.env?.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env?.VITE_SUPABASE_ANON_KEY;
const NATIVE = Capacitor.isNativePlatform();

// Where the native sign-in flow comes back to. Registered as a URL scheme in
// the iOS Info.plist and the Android manifest.
export const NATIVE_REDIRECT = 'runeduel://auth';

export const supabase = URL && ANON_KEY
  ? createClient(URL, ANON_KEY, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      // on the web the provider redirects back to this page with the code
      detectSessionInUrl: !NATIVE,
    },
  })
  : null;

export const ACCOUNTS_AVAILABLE = !!supabase;

export const useAccount = create(() => ({
  session: null,     // Supabase session, or null for a guest
  profile: null,     // { id, display_name, rating, peak_rating, wins, losses, draws, games }
  ready: !supabase,  // false until the stored session has been checked
  error: null,
}));

const setAccount = useAccount.setState;

// ── session lifecycle ──────────────────────────────────────────────────────
let started = false;

export async function initAccount() {
  if (!supabase || started) return;
  started = true;

  supabase.auth.onAuthStateChange((_event, session) => {
    setAccount({ session });
    if (session) loadProfile();
    else setAccount({ profile: null });
  });

  const { data } = await supabase.auth.getSession();
  setAccount({ session: data.session, ready: true });
  if (data.session) loadProfile();

  if (NATIVE) {
    const { App } = await import('@capacitor/app');
    App.addListener('appUrlOpen', async ({ url }) => {
      if (!url?.startsWith(NATIVE_REDIRECT)) return;
      const params = new globalThis.URL(url.replace('runeduel://', 'https://x/')).searchParams;
      const code = params.get('code');
      const { Browser } = await import('@capacitor/browser');
      Browser.close().catch(() => {});
      if (!code) {
        setAccount({ error: params.get('error_description') || 'Sign-in was cancelled.' });
        return;
      }
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) setAccount({ error: error.message });
    });
  }
}

// provider: 'apple' | 'google'
export async function signIn(provider) {
  if (!supabase) return;
  setAccount({ error: null });
  // On iPhone and iPad, Apple is the system sheet (Face ID), not a web page.
  // Supabase verifies Apple's identity token against the app's bundle ID.
  if (provider === 'apple' && NATIVE_APPLE) return signInWithAppleNative();
  if (!NATIVE) {
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) setAccount({ error: error.message });
    return;
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: NATIVE_REDIRECT, skipBrowserRedirect: true },
  });
  if (error || !data?.url) {
    setAccount({ error: error?.message || 'Could not start sign-in.' });
    return;
  }
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: data.url, presentationStyle: 'popover' });
}

// Apple's native sheet exists only in the iOS app. Elsewhere (web, Android)
// the Apple button is hidden: Google covers those.
export const NATIVE_APPLE = NATIVE && Capacitor.getPlatform() === 'ios';
export const PROVIDERS = NATIVE_APPLE ? ['apple', 'google'] : ['google'];

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function signInWithAppleNative() {
  // Apple receives the hash of the nonce; Supabase checks it against the raw one,
  // so a stolen identity token cannot be replayed.
  const raw = crypto.randomUUID() + crypto.randomUUID();
  try {
    const { SignInWithApple } = await import('@capacitor-community/apple-sign-in');
    const { response } = await SignInWithApple.authorize({
      clientId: 'com.devpatel3547.runeduel',
      redirectURI: NATIVE_REDIRECT,
      scopes: 'name email',
      nonce: await sha256Hex(raw),
    });
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple', token: response.identityToken, nonce: raw,
    });
    if (error) setAccount({ error: error.message });
  } catch (err) {
    // closing the sheet is a cancel, not a failure worth shouting about
    const msg = String(err?.message || err);
    if (!/cancel|1001/i.test(msg)) setAccount({ error: 'Apple sign-in failed: ' + msg });
  }
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  setAccount({ session: null, profile: null });
}

// The token the match server verifies to attach a duel to this account.
export async function accessToken() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || null;
}

// ── profile, leaderboard, history ──────────────────────────────────────────
export async function loadProfile() {
  const { session } = useAccount.getState();
  if (!supabase || !session) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, rating, peak_rating, wins, losses, draws, games')
    .eq('id', session.user.id)
    .single();
  if (error) {
    setAccount({ error: error.message });
    return null;
  }
  setAccount({ profile: data });
  return data;
}

export async function renameMe(displayName) {
  const { session } = useAccount.getState();
  const name = String(displayName || '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 16);
  if (!supabase || !session || !name) return false;
  const { error } = await supabase
    .from('profiles')
    .update({ display_name: name, updated_at: new Date().toISOString() })
    .eq('id', session.user.id);
  if (error) {
    setAccount({ error: error.message });
    return false;
  }
  await loadProfile();
  return true;
}

export async function fetchLeaderboard() {
  if (!supabase) return [];
  const { data, error } = await supabase.from('leaderboard').select('*');
  if (error) throw error;
  return data || [];
}

export async function fetchMyMatches(limit = 20) {
  const { session } = useAccount.getState();
  if (!supabase || !session) return [];
  const id = session.user.id;
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .or(`player_a.eq.${id},player_b.eq.${id}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((m) => {
    const mine = m.player_a === id ? 'a' : 'b';
    return {
      ...m,
      opponent: mine === 'a' ? m.name_b : m.name_a,
      won: m.result === mine,
      draw: m.result === 'draw',
      delta: mine === 'a' ? m.rating_delta_a : m.rating_delta_b,
    };
  });
}

// ── guest record, on this device only ──────────────────────────────────────
const LOCAL_KEY = 'rd.guestStats';

export function localStats() {
  try {
    const s = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    if (s && typeof s.wins === 'number') return s;
  } catch { /* storage unavailable */ }
  return { wins: 0, losses: 0, draws: 0 };
}

// outcome: { won, draw } from a finished duel. mode: 'online' | 'practice'.
export function recordLocalResult(outcome, mode) {
  if (!outcome || mode !== 'online') return;
  const s = localStats();
  if (outcome.draw) s.draws += 1;
  else if (outcome.won) s.wins += 1;
  else s.losses += 1;
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
