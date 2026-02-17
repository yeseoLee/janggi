FROM debian:bookworm-slim AS engine-builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 https://github.com/fairy-stockfish/Fairy-Stockfish.git

WORKDIR /src/Fairy-Stockfish/src
ARG TARGETARCH
RUN case "$TARGETARCH" in \
      "amd64") FS_ARCH="x86-64-modern" ;; \
      "arm64") FS_ARCH="armv8" ;; \
      *) FS_ARCH="general-64" ;; \
    esac \
  && echo "Building Fairy-Stockfish ARCH=${FS_ARCH} (TARGETARCH=${TARGETARCH:-unknown})" \
  && make build COMP=gcc ARCH="${FS_ARCH}" largeboards=yes -j"$(nproc)" \
  && strip stockfish


FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY --from=engine-builder /src/Fairy-Stockfish/src/stockfish /usr/local/bin/fairy-stockfish

ENV PORT=4000
ENV STOCKFISH_PATH=/usr/local/bin/fairy-stockfish
ENV AI_VARIANT=janggi
ENV AI_MOVE_TIME_MS=700

EXPOSE 4000

CMD ["node", "server.js"]
