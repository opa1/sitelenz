# syntax=docker/dockerfile:1
#
# Production image for OCI ARM64 (also builds fine on amd64 — see the CI
# workflow's multi-platform build). Replaces the previous Render-specific
# image (mcr.microsoft.com/playwright:*-noble) entirely.

# =============================================================================
# Builder — full (dev+prod) dependencies and the TypeScript build. Nothing
# from this stage ships except the compiled `dist/` output and the generated
# Prisma client (copied explicitly below, not the whole node_modules).
# =============================================================================
FROM node:24-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

# `postinstall` runs `prisma generate`, which only reads prisma/schema.prisma
# (no DB connection needed — this app uses @prisma/adapter-pg driver
# adapters, so Prisma's own DATABASE_URL resolution is never invoked either
# at generate time or at runtime) — the schema must exist before this runs.
RUN npm ci

COPY . .

RUN npm run build

# =============================================================================
# Production — lean runtime image.
# =============================================================================
FROM node:24-bookworm-slim AS production

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# System libraries Chromium needs to actually render pages — Playwright
# ships the browser binary but never these. This exact list (both the
# `chromium` libs and the `tools` font packages) is taken verbatim from
# Playwright 1.62.1's own dependency registry for "debian12-x64"/
# "debian12-arm64" (playwright-core/src/server/registry/nativeDeps.ts,
# checked directly against the installed package — not assembled by hand or
# copied from a blog post, which is exactly the kind of list that works on
# amd64 and silently breaks on arm64 three months later). The font packages
# aren't cosmetic: without them Chromium still runs, but screenshots of any
# page using non-Latin scripts or emoji render as tofu boxes instead of
# actual glyphs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-unifont \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-tlwg-loma-otf \
    fonts-freefont-ttf \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY prisma ./prisma/

# --omit=dev: `prisma` (the CLI) is a devDependency — only @prisma/client and
# @prisma/adapter-pg (the runtime pieces) are real dependencies. --ignore-scripts
# is required because of that: without it, npm's own `postinstall` hook would
# try to run `prisma generate` with no `prisma` CLI present and fail the
# build outright. The already-generated client is copied in from the builder
# stage below instead of being regenerated here.
RUN npm ci --omit=dev --ignore-scripts

# The client Prisma actually generates (query compiler + types) lives in
# node_modules/.prisma/client — @prisma/client itself (installed above) is
# just the static package that re-exports from it at runtime. Prisma 7's
# query compiler is WASM, not a native binary, so this is safe to copy
# as-is between two stages built from the identical base image/Node version.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Downloads the Chromium build matching the `playwright` version installed
# above. No `--with-deps`: the system libraries it would otherwise try to
# apt-get itself are already installed explicitly above, pinned to what this
# exact base image/architecture actually needs.
RUN npx playwright install chromium

COPY --from=builder /app/dist ./dist

# BrowserService (src/common/browser/browser.service.ts) already launches
# Chromium with --no-sandbox/--disable-setuid-sandbox — that's what makes it
# safe to run this process as a non-root user: Chromium's kernel sandbox
# needs privileges this user doesn't have, and those launch args are how
# it's told not to rely on it.
RUN chown -R node:node /app /ms-playwright
USER node

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3002/health',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# Real entry point — the project's own package.json ("start"/"start:prod")
# and nest-cli.json (sourceRoot: "src") both confirm the build output lands
# at dist/src/main.js, not dist/main.js.
CMD ["node", "dist/src/main.js"]
