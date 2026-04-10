package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"path/filepath"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func main() {
	cfg := loadConfig()
	ctx := context.Background()

	dbPool, err := connectDatabaseWithRetry(ctx, cfg)
	if err != nil {
		log.Fatal(err)
	}
	defer dbPool.Close()

	app := &app{
		cfg:        cfg,
		db:         dbPool,
		state:      newServerState(),
		now:        time.Now,
		newID:      uuid.NewString,
		httpClient: http.DefaultClient,
		distDir:    filepath.Join("..", "frontend", "dist"),
	}

	if err := app.initDB(ctx); err != nil {
		log.Fatal(err)
	}

	app.api = gin.New()
	app.api.Use(gin.Recovery())
	app.api.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	app.registerRoutes()
	app.setupSocketServer()

	mux := http.NewServeMux()
	socketHandler := app.io.ServeHandler(nil)
	mux.Handle("/socket.io", socketHandler)
	mux.Handle("/socket.io/", socketHandler)
	mux.Handle("/api", app.api)
	mux.Handle("/api/", app.api)
	mux.Handle("/", app.frontendHandler())

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           mux,
		ReadHeaderTimeout: 15 * time.Second,
	}

	log.Printf("Server running on port %s", cfg.Port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
