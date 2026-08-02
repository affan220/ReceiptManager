# Multi-stage Dockerfile for Masjid Receipt Manager Backend
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
COPY server/package*.json ./server/

RUN npm --prefix server install

COPY server ./server/

RUN npm --prefix server run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

COPY --from=build /app/server/package*.json ./
COPY --from=build /app/prisma ./prisma
RUN npm install --omit=dev && npx prisma generate --schema=./prisma/schema.prisma

COPY --from=build /app/server/dist ./dist

EXPOSE 5000

CMD ["node", "dist/index.js"]
