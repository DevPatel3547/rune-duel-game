// Where the multiplayer server lives.
//
// In local development the Vite dev server proxies /socket.io to the Node
// server on :3001, so the client connects to its own origin and this is empty.
//
// On a static host (GitHub Pages and friends) there is no Node process behind
// the site, so the online mode needs an absolute URL to a separately-hosted
// server. That is supplied at build time as VITE_SERVER_URL.
//
// When it is unset on a static build, online play is simply unavailable — the
// menu says so plainly instead of offering a button that hangs on a connection
// that can never succeed. Practice mode is fully offline and always works.
export const SERVER_URL = (import.meta.env?.VITE_SERVER_URL || '').replace(/\/+$/, '');

// True when the app is served from a plain static host with no server wired up.
// `import.meta.env.DEV` covers `npm run dev`, where the proxy handles it.
export const ONLINE_AVAILABLE = !!SERVER_URL || !!import.meta.env?.DEV;

// socket.io-client treats undefined as "same origin", which is what we want
// during development.
export const socketTarget = () => SERVER_URL || undefined;
