# Deploying Rune Duel

Three pieces, deployed separately:

| Piece | What it is | Where it runs |
|---|---|---|
| Match server | Socket.io server for online play (quick match, rooms) | **Fly.io**, one always-on machine |
| Web game | The 3D duel as a static site + installable PWA | **Vercel** — <https://rune-duel.vercel.app> |
| iOS app | The same game wrapped with Capacitor | **App Store** (TestFlight first) |

Web and iOS players share the one match server, so they play each other.

Practice mode needs none of this: it is fully offline.

---

## 1. Match server → Fly.io

Config: `fly.toml` (repo root) and `server/Dockerfile`.

**One machine, always.** Matches, rooms and the quick-match queue live in the
server's memory. Two machines would split players into two worlds that cannot
see each other. `npm run deploy:server` passes `--ha=false` for that reason.
Scale up (a bigger VM in `fly.toml`), never out.

First time (needs the account owner — a card is required, ~$2–5/month):

```bash
flyctl auth login                      # opens the browser
flyctl launch --no-deploy --copy-config --name rune-duel-server
npm run deploy:server
curl https://rune-duel-server.fly.dev/health
```

After that, `npm run deploy:server` ships a new build. Players in a match when
it restarts see "server restarting" and are reconnected.

Browser origins allowed to connect are listed in `fly.toml` (`ALLOWED_ORIGINS`).
Add a custom domain there when you get one. The iOS app sends no Origin
header, so it is always allowed.

---

## 2. Web game → Vercel

`vercel.json` holds the build config: build the `xr` workspace, serve `xr/dist`,
rewrite unknown paths to `index.html`, cache hashed assets forever and `sw.js`
never.

The game finds the match server through **`VITE_SERVER_URL`**, which is baked
in at build time. Set it once in the Vercel project:

```bash
npx vercel env add VITE_SERVER_URL production   # value: https://rune-duel-server.fly.dev
npm run deploy                                  # vercel deploy --prod
```

Without it the menu says online play is unavailable, rather than showing a
button that hangs.

Auto-deploy on push is optional. Install Vercel's GitHub App on the repo, then
run `npx vercel git connect`.

**Protocol versions.** When the server's `PROTOCOL_VERSION`
(`shared/src/protocol.js`) changes, deploy the **server first**, then the web
build. The iOS app has to go through App Store review. An outdated client is
told to update, and it is never allowed to join a match it would misread.

---

## 3. iOS app → TestFlight → App Store

Capacitor project: `xr/ios/App`. Bundle ID `com.devpatel3547.runeduel`,
signing team `DBR7ZU9GS7`. You can change either in Xcode before the first
upload. After that the bundle ID is permanent.

```bash
npm run ios:sync -w xr     # native web build (server URL baked in) + copy into Xcode
npm run ios:open -w xr     # opens Xcode
```

In Xcode:

1. Sign in: **Xcode → Settings → Accounts** with the Apple ID on the developer
   program.
2. **App target → Signing & Capabilities**: confirm the team, automatic signing.
3. Bump **Version** / **Build** for every upload.
4. **Product → Archive**, then **Distribute App → App Store Connect → Upload**.

In App Store Connect (<https://appstoreconnect.apple.com>):

1. **Apps → + → New App**, same bundle ID.
2. Add the build to **TestFlight** and install it on a real iPhone first. This
   is where framerate and haptics get checked for real.
3. For the store listing you need screenshots (6.9" and 6.5" iPhone), a
   description, a privacy policy URL, age rating, and category **Games**.
   Privacy answers: no data collected. There are no accounts; a display name
   is sent to the match server and kept only for the match.
4. Submit for review.

`ITSAppUsesNonExemptEncryption` is already `false` in `Info.plist` (the app
only uses standard HTTPS), so uploads skip the export-compliance question.

**Icon and splash** come from `xr/branding/icon.svg`. Re-render them with
`node tools/render_icons.mjs`, then copy them into
`xr/ios/App/App/Assets.xcassets`.

---

## Local development

```bash
npm run dev     # game on :5173 (LAN-exposed for phones) + server on :3001
```

Vite proxies `/socket.io` and `/health` to the local server, so online play
works locally with no configuration.

## Checks

```bash
npm test                 # recognizer, combat math, duel simulation rules
npm run test:online      # socket clients against the real server: duel, quick match,
                         # anti-cheat, dodge, reconnect, forfeit, loading handshake
npm run test:online2p    # two real browsers duel through the real server
npm run test:smoke       # the game boots in Chrome and plays a live practice duel
npm run test:dodge       # sidestepping evades, standing still does not
```

The browser tests render through SwiftShader on the CPU and can run slowly on a
busy machine. They wait on outcomes, not on fixed delays.
