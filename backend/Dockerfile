FROM golang:1.26-bookworm AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=linux GOARCH=${TARGETARCH:-amd64} go build -trimpath -ldflags="-s -w" -o /out/backend .

FROM debian:bookworm-slim

WORKDIR /app

COPY --from=builder /out/backend /app/backend

EXPOSE 3000

CMD ["/app/backend"]
