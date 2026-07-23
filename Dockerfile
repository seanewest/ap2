FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.api.json ./
RUN npm ci
COPY api ./api
RUN npm run build:api
RUN npm prune --omit=dev

FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist-api ./dist-api
COPY --from=build /app/node_modules ./node_modules
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist-api/index.js"]
