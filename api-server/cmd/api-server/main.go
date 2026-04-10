package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/yeseolee/janggi/api-server/internal/application"
	"github.com/yeseolee/janggi/api-server/internal/dataaccess"
	"github.com/yeseolee/janggi/api-server/internal/platform"
	httpapi "github.com/yeseolee/janggi/api-server/internal/presentation/http"
	socketapi "github.com/yeseolee/janggi/api-server/internal/presentation/socket"
)

func main() {
	cfg := platform.LoadConfig()
	ctx := context.Background()

	dbPool, err := platform.ConnectDatabaseWithRetry(ctx, cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer dbPool.Close()

	if err := dataaccess.InitDB(ctx, dbPool); err != nil {
		log.Fatal(err)
	}

	service := application.NewService(cfg, dbPool, time.Now, uuid.NewString, http.DefaultClient)
	router := httpapi.NewRouter(service)
	socketServer := socketapi.NewServer(service)

	mux := http.NewServeMux()
	socketHandler := socketServer.ServeHandler(nil)
	mux.Handle("/socket.io", socketHandler)
	mux.Handle("/socket.io/", socketHandler)
	mux.Handle("/api", router)
	mux.Handle("/api/", router)
	mux.Handle("/", platform.NewFrontendHandler(filepath.Join("..", "frontend", "dist")))

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           mux,
		ReadHeaderTimeout: 15 * time.Second,
	}

	log.Printf("API server running on port %s", cfg.Port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
