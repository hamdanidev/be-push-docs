# ══════════════════════════════════════════════════════════════
# Stage 1 — Builder
# Install build deps & compile native modules (better-sqlite3)
# ══════════════════════════════════════════════════════════════
FROM node:20-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files dulu — biar cache efisien
COPY package*.json ./

# --omit=dev → skip devDependencies (tidak ada di project ini, tapi aman)
RUN npm ci --omit=dev

# ══════════════════════════════════════════════════════════════
# Stage 2 — Runtime
# Image final — hanya node + app, tanpa build tools
# ══════════════════════════════════════════════════════════════
FROM node:20-slim AS runtime

# tini → signal handling bersih (SIGTERM dari docker stop sampai ke node)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy node_modules dari builder (sudah include hasil compile)
COPY --from=builder /app/node_modules ./node_modules

# Copy source
COPY package*.json ./
COPY lib ./lib
COPY server.js ./
COPY index.js ./

# Folder output (ditimpa volume saat run)
RUN mkdir -p output

# Non-root user (uid 1001)
RUN useradd -r -u 1001 -g root appuser \
    && chown -R appuser:root /app
USER appuser

EXPOSE 3001

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]