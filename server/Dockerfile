# Match server image. Build from the REPO ROOT (fly.toml does this), because
# the server depends on the shared workspace (@rune/shared).
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

# npm validates the lockfile against every workspace listed in the root
# package.json, so each workspace's manifest has to exist — but only the
# server's dependencies are installed.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
COPY xr/package.json xr/
RUN npm ci --omit=dev --workspace server --include-workspace-root=false \
 && npm cache clean --force

COPY shared shared
COPY server/src server/src

USER node
EXPOSE 3001
CMD ["node", "server/src/index.js"]
