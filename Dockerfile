FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.ts ./next.config.ts
COPY --from=build --chown=node:node /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=node:node /app/src/db ./src/db
# src/db imports the shared config module, and the migration script imports src/db.
COPY --from=build --chown=node:node /app/src/opspilot/server ./src/opspilot/server
COPY --from=build --chown=node:node /app/opspilot/migrations ./opspilot/migrations
COPY --from=build --chown=node:node /app/opspilot/scripts/migrate.ts ./opspilot/scripts/migrate.ts
USER node
EXPOSE 3000
# Migrations run as a separate one-shot job (see docker-compose.yml) so that
# scaling the app to several replicas cannot race the same schema change.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0"]
