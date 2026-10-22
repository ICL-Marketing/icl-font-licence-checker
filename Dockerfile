# ICL Sales on Google Cloud Run (or any Docker host). Build: docker build -t icl-sales .
# 1. Install and build
FROM mirror.gcr.io/library/node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG GIT_SHA=local
ENV GIT_SHA=$GIT_SHA NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# 2. Run: the standalone server plus Chromium for the part-of-a-page screenshots
FROM mirror.gcr.io/library/node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0 \
  CHROME_PATH=/usr/bin/chromium CHROME_ARGS="--disable-dev-shm-usage --disable-gpu"
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
