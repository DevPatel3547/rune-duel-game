# ⚡ Rune Duel

Draw runes. Cast spells. Out-draw your rival.

A 1v1 real-time spell-dueling game for **desktop and mobile browsers** (iPhone +
Android). Draw a rune in one stroke — accuracy and speed determine its power.
First wizard to 0 HP loses. No install needed; runs in any browser and installs
as a PWA. Gesture spellcasting in the spirit of *War of Wizards*, built for flat
touchscreens and mouse instead of a headset.

## Run it

```bash
npm install
npm run dev          # starts the game server + the web client
```

- **Desktop:** open http://localhost:5173 and **drag to draw** your rune.
- **Phone:** Vite prints a `http://<your-LAN-ip>:5173` URL — open it on your phone
  (same wifi) and **draw with your finger**. Add to Home Screen to play full-screen.

The game server runs on `:3001`; Vite proxies the websocket so the same URL works
for online play.

## Game modes

| Mode | What |
|---|---|
| 🌐 Online Duel | Create a room, share the 6-letter code, duel a friend anywhere. |
| 🤖 VS the Machine | 3 AI difficulties — sloppy apprentice up to a near-perfect archmage. |
| 📱 Pass & Play | Two players, one phone — hand it back and forth between turns. |
| ✍️ Rune Training | Practice each rune and chase your best accuracy. |

Each round you're offered **two** spells from your deck; pick one and draw its
rune fast and clean. Sloppy draws fizzle.

## Tests

```bash
npm test                      # recognizer confusion matrix + combat math (25 checks)
npm run test:smoke            # boots the client in headless Chrome on a mobile
                              # viewport, plays into a real match, asserts it loads
# full online match over real sockets:
node server/src/index.js &    # then:
node server/test/e2e.js
```

## Architecture

```
shared/   spell data, rune templates, $1 gesture recognizer, combat resolution
server/   Node + Socket.io — authoritative: re-recognizes strokes server-side
          so a hacked client can't lie about its draw quality (anti-cheat)
client/   React + Vite PWA — HTML5 Canvas drawing, all UI, Web Audio synth SFX.
          THE game. `npm run dev` / `npm run build`.
xr/       a WebXR/VR experiment — NOT the product. Parked behind `npm run dev:vr`.
```

The recognition + resolution code runs identically on the client (offline AI /
Pass & Play) and the server (online), so the combat math can never disagree.

## Deploy

- **Client** → Vercel/Netlify: `npm run build` → output `client/dist`.
  Point `/socket.io` (or `VITE_SERVER_URL`) at the deployed server.
- **Server** → Railway/Fly.io: `node server/src/index.js`, expose `PORT`.

## The 12 runes

Bolt ⚡ · Vortex 🌀 · Shield 🛡️ · Quake 🌋 · Pierce 🗡️ · Reflect 🪞 ·
Leech 🧛 · Surge 🔺 · Void ⭕ · Anchor ⚓ · Drain 🌙 · Nova ⭐

Every rune is a single stroke. Power = accuracy × 0.6 + speed × 0.4.
Shield blocks Bolt, Pierce ignores Shield, Reflect bounces Pierce, Void strips
Reflect. Read the deck, read your opponent.
