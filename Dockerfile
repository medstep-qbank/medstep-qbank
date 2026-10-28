FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

# Runs as root: hosting disks (Render, Railway) are mounted root-owned, so a non-root user could not write the database.
RUN mkdir -p /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:${PORT:-3000}/api/health > /dev/null || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
