# syntax=docker/dockerfile:1
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 KaiserHomeLab
#
# Media Review image, built the linuxserver.io way like Media Ops: their Alpine base (s6-overlay,
# PUID/PGID, UMASK, TZ, Docker Mods) plus Node.js and this app. See THIRD-PARTY-NOTICES.md.
# Build from the top of the repo (it needs LICENSE from there): docker build -f src/Dockerfile .

# Pinned to an exact build (the digest), the same one Media Ops uses.
FROM ghcr.io/linuxserver/baseimage-alpine:3.24@sha256:52106d187a66ccb92e3289cb6dd25c549cb0b6b7bfec38a51994434c96db2d35

# set version label
ARG BUILD_DATE
ARG VERSION
LABEL build_version="Media Review version:- ${VERSION} Build-date:- ${BUILD_DATE}"
LABEL maintainer="KaiserHomeLab"
LABEL org.opencontainers.image.title="Media Review"
LABEL org.opencontainers.image.description="Downvotes and a Review Queue for a Plex server, decided by the Owner in Media Ops"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/KaiserHomeLab/media-review"
LABEL org.opencontainers.image.url="https://github.com/KaiserHomeLab/media-review"
# Unraid shows this icon for the container (the template's <Icon> says the same)
LABEL net.unraid.docker.icon="https://raw.githubusercontent.com/KaiserHomeLab/media-review/main/src/public/icon.png"

# environment settings: the database lives in /config, the one volume
ENV DATA_DIR="/config" \
  PORT="8485" \
  NODE_ENV="production"

RUN \
  echo "**** install runtime packages ****" && \
  apk add --no-cache \
    nodejs && \
  echo "**** cleanup ****" && \
  rm -rf \
    /tmp/*

# app
COPY LICENSE src/package.json src/server.js src/THIRD-PARTY-NOTICES.md /app/media-review/
COPY src/lib/ /app/media-review/lib/
COPY src/public/ /app/media-review/public/

# add local files
COPY src/root/ /
# in case the repo was uploaded without exec bits (e.g. via GitHub's web UI), or checked out
# on Windows with CRLF line endings (s6 can't run a script whose first line ends in \r)
RUN \
  find /etc/s6-overlay/s6-rc.d/*-media-review* -type f -exec sed -i 's/\r$//' {} + && \
  chmod +x /etc/s6-overlay/s6-rc.d/*-media-review*/run

# lets Docker, Unraid and Portainer show whether it's healthy
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT:-8485}/healthz" > /dev/null || exit 1

# ports and volumes
EXPOSE 8485
VOLUME /config
