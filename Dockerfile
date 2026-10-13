# The game server (src/server.ts), bundled with the games and run on plain Node; and, from the same
# image, the sandbox machine's program (src/sandbox.ts: `node dist-sandbox/sandbox.js`).
# Build context: this repo with the engine already built (`npm run wasm` makes engine/pkg).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY engine/pkg ./engine/pkg
RUN npx vite build --ssr src/serve.ts --outDir dist-server
# The sandbox machine's program (uploaded games' rooms: fly.sandbox.toml runs it from this image).
COPY scripts/build-sandbox.mjs ./scripts/
RUN node scripts/build-sandbox.mjs --out dist-sandbox/sandbox.js

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/dist-sandbox ./dist-sandbox
COPY engine/pkg/voxel_engine_bg.wasm ./engine/pkg/voxel_engine_bg.wasm
EXPOSE 8080
# Worlds, players and game data live in /data (a volume). SIGINT saves them before exiting.
STOPSIGNAL SIGINT
CMD ["node", "--disable-warning=ExperimentalWarning", "dist-server/serve.js", "--port", "8080", "--data", "/data"]
