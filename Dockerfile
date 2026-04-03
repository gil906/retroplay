FROM node:20-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY package.json .
RUN npm install --omit=dev

COPY server.js .
COPY public/ ./public/

RUN mkdir -p /data/roms /data/saves /data/covers

ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --spider -q http://localhost:3000/api/systems || exit 1

CMD ["node", "server.js"]
