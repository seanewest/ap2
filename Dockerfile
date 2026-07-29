FROM mcr.microsoft.com/playwright:v1.61.1-noble AS build

WORKDIR /app
COPY .dockerignore Dockerfile package.json package-lock.json tsconfig.json tsconfig.api.json vite.api.config.ts ./
RUN npm ci
COPY api ./api
COPY scripts ./scripts
COPY src/api ./src/api
COPY src/scenarios ./src/scenarios
COPY src/ui ./src/ui
RUN npm run build:api && rm -f dist-api/*.map
RUN npm prune --omit=dev
RUN node scripts/api-container-provenance.ts --output container-provenance.json

FROM mcr.microsoft.com/playwright:v1.61.1-noble

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist-api ./dist-api
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/container-provenance.json ./container-provenance.json
USER pwuser
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist-api/index.js"]
