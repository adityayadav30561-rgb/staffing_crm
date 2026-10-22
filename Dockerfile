# Single container: the API serves the built web app. Migrations run on start.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm --filter @crm/api deploy --prod --legacy /out

FROM node:22-slim
ENV NODE_ENV=production TZ=Asia/Kolkata PORT=3001
WORKDIR /app
COPY --from=build /out/node_modules ./apps/api/node_modules
COPY --from=build /out/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=build /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 3001
CMD ["node", "--enable-source-maps", "apps/api/dist/main.js"]
