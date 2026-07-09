# Legacy AI — Ticket Board (Next.js). Lightweight: no headless browser.
FROM node:22-slim
ENV NEXT_TELEMETRY_DISABLED=1 \
    TICKETS_DATA_DIR=/data

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# Ensure the data dir is node-owned BEFORE VOLUME so a fresh named volume
# inherits node ownership on first mount (Docker copies the image dir's
# ownership to a new volume). Then drop to non-root for the runtime.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
USER node
CMD ["npm", "run", "start"]
