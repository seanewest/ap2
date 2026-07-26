FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.calling-bot.json ./
RUN npm ci
COPY teams-calling-bot ./teams-calling-bot
RUN npm run build:calling-bot
RUN npm prune --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist-calling-bot ./dist-calling-bot
COPY --from=build /app/node_modules ./node_modules
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist-calling-bot/index.js"]
