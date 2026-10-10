# Hearthvale: one container serves the game client, the REST API and the
# real-time WebSocket game server. Mount a volume at /data so saves persist.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production DATA_DIR=/data PORT=8787
VOLUME /data
EXPOSE 8787
CMD ["node", "--no-warnings", "server/index.js"]
