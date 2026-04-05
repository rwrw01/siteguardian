# Build stage
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Install Playwright chromium and its OS dependencies
RUN npx playwright install --with-deps chromium

COPY prisma ./prisma/
RUN npx prisma generate

COPY . .
RUN mkdir -p public
RUN npm run build

# Migration stage — includes prisma CLI for db push
FROM node:22-bookworm-slim AS migrator
WORKDIR /app

# Required for Prisma to detect OpenSSL 3.x (Bookworm default) on ARM64
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./

# Entrypoint reads Docker secrets and constructs DATABASE_URL from components
COPY migrate-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/migrate-entrypoint.sh
ENTRYPOINT ["migrate-entrypoint.sh"]

# Runtime stage — non-root, Playwright chromium available
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Install chromium runtime dependencies for Playwright + gosu for privilege drop
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    tini \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --home /home/nextjs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=1001:1001 /app/.next/standalone ./
COPY --from=builder --chown=1001:1001 /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy Playwright browsers from builder stage
ENV PLAYWRIGHT_BROWSERS_PATH=/home/nextjs/.cache/ms-playwright
COPY --from=builder /root/.cache/ms-playwright /home/nextjs/.cache/ms-playwright
RUN chown -R 1001:1001 /home/nextjs/.cache

# Copy Playwright package so it can find the browser
COPY --from=builder /app/node_modules/playwright-core ./node_modules/playwright-core
COPY --from=builder /app/node_modules/@playwright ./node_modules/@playwright

# Entrypoint reads Docker secrets into env vars
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER 1001

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -q --spider http://127.0.0.1:8080/api/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
