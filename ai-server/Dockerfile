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


FROM golang:1.22-bookworm AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} go build -trimpath -ldflags="-s -w" -o /out/ai-server .

FROM debian:bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /out/ai-server /app/ai-server
COPY --from=engine-builder /src/Fairy-Stockfish/src/stockfish /usr/local/bin/fairy-stockfish

ENV PORT=4000
ENV STOCKFISH_PATH=/usr/local/bin/fairy-stockfish
ENV AI_VARIANT=janggi
ENV AI_MOVE_TIME_MS=700

EXPOSE 4000

CMD ["/app/ai-server"]
