# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────────────────────────────
# Rademics ERP — single-image monorepo build.
#
# One image builds the whole pnpm/turbo workspace (types, permissions, api,
# internal, portal). docker-compose runs three services from this same image
# with different commands (api / internal / portal), so we build once and share
# layers instead of maintaining three near-identical Dockerfiles.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# openssl + ca-certificates are required by Prisma's query engine at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
WORKDIR /app

FROM base AS build
# Copy the whole workspace (node_modules excluded via .dockerignore) and install
# with dev deps present — the build needs nest/next/tsup/ts-node/typescript.
COPY . .
RUN pnpm install --frozen-lockfile

# Prisma client must be generated before the API is compiled.
RUN pnpm --filter @rademics/api prisma:generate

# Public build-time config. NEXT_PUBLIC_API_URL is baked into the browser bundle;
# PUBLIC_HTTPS=false drops HSTS + upgrade-insecure-requests so the app works when
# served over plain HTTP by IP (flip to true once a domain + TLS are in place).
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api
ARG PUBLIC_HTTPS=false
# Turnstile site key is public by design (embedded in the login page's HTML) —
# empty default keeps the widget a no-op (Turnstile component) until configured.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=""
# Browser error reporting (Spec §11) — one var per Next.js app since both build from
# this same image; empty defaults keep Sentry a no-op until configured.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_PORTAL_SENTRY_DSN=""
# Release identifier (Spec §11): the deployed git SHA, stamped onto every Sentry event
# and used as the key the source maps are uploaded under. Public (it's just a SHA).
ARG SENTRY_RELEASE=""
# Source map upload targets. Slugs aren't secret; the auth token IS — see the RUN below.
ARG SENTRY_ORG=""
ARG SENTRY_PROJECT=""
ARG SENTRY_PORTAL_PROJECT=""
ARG SENTRY_AUTH_TOKEN=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV PUBLIC_HTTPS=$PUBLIC_HTTPS
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_PORTAL_SENTRY_DSN=$NEXT_PUBLIC_PORTAL_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_RELEASE=$SENTRY_RELEASE
ENV SENTRY_ORG=$SENTRY_ORG
ENV SENTRY_PROJECT=$SENTRY_PROJECT
ENV SENTRY_PORTAL_PROJECT=$SENTRY_PORTAL_PROJECT
ENV NODE_ENV=production
# Cap the heap and build one package at a time — this box is memory-constrained.
ENV NODE_OPTIONS=--max-old-space-size=2048
# SENTRY_AUTH_TOKEN is passed inline rather than via ENV on purpose: this build stage
# IS the runtime image (see below), so an ENV would bake the token into every running
# container. Inline, it lives only for this RUN. Scope the token to project:releases.
RUN SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN pnpm exec turbo run build --concurrency=1

# The build stage IS the runtime image: it already contains every app's compiled
# output plus the full node_modules (incl. Prisma CLI for migrate/seed).
ENV NODE_ENV=production
ENV NODE_OPTIONS=
EXPOSE 3000 3001 4000
