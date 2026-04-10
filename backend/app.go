package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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
		cfg:                    cfg,
		db:                     dbPool,
		activeSessions:         make(map[string]*sessionRecord),
		activeGames:            make(map[string]*gameState),
		pendingFriendlyInvites: make(map[string]*pendingFriendlyInvite),
		pendingFriendlyMatches: make(map[string]*pendingFriendlyMatch),
		matchQueue:             []*queueEntry{},
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

func connectDatabaseWithRetry(ctx context.Context, cfg *config) (*pgxpool.Pool, error) {
	dbConfig, err := pgxpool.ParseConfig("")
	if err != nil {
		return nil, err
	}
	dbConfig.ConnConfig.Host = cfg.DBHost
	dbConfig.ConnConfig.User = cfg.DBUser
	dbConfig.ConnConfig.Password = cfg.DBPassword
	dbConfig.ConnConfig.Database = cfg.DBName
	dbConfig.ConnConfig.Port = uint16(clampToPort(cfg.DBPort))

	var lastErr error
	for attempt := 1; attempt <= 30; attempt++ {
		dbPool, err := pgxpool.NewWithConfig(ctx, dbConfig)
		if err == nil {
			if pingErr := dbPool.Ping(ctx); pingErr == nil {
				return dbPool, nil
			} else {
				lastErr = pingErr
			}
			dbPool.Close()
		} else {
			lastErr = err
		}

		if attempt == 30 {
			break
		}
		log.Printf("database not ready (attempt %d/30): %v", attempt, lastErr)
		time.Sleep(2 * time.Second)
	}

	return nil, fmt.Errorf("database connection failed after retries: %w", lastErr)
}

func loadConfig() *config {
	return &config{
		Port:          getenvDefault("PORT", "3000"),
		DBUser:        getenvDefault("DB_USER", "janggi_user"),
		DBHost:        getenvDefault("DB_HOST", "localhost"),
		DBName:        getenvDefault("DB_NAME", "janggi_db"),
		DBPassword:    getenvDefault("DB_PASSWORD", "janggi_password"),
		DBPort:        getenvDefault("DB_PORT", "5432"),
		JWTSecret:     getenvDefault("JWT_SECRET", "secret_key"),
		AIServiceURL:  getenvDefault("AI_SERVICE_URL", "http://localhost:4000"),
		AIMoveTimeMS:  clampMoveTime(getenvDefault("AI_MOVE_TIME_MS", "700"), 700),
		AISearchDepth: clampDepth(getenvDefault("AI_SEARCH_DEPTH", "8"), 8),
	}
}

func getenvDefault(key, fallback string) string {
	value := stringsTrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func clampToPort(value string) int {
	parsed, ok := toInt(value)
	if !ok || parsed <= 0 || parsed > 65535 {
		return 5432
	}
	return parsed
}

func (app *app) registerRoutes() {
	app.api.POST("/api/auth/register", app.handleRegister)
	app.api.POST("/api/auth/login", app.handleLogin)

	authorized := app.api.Group("/api")
	authorized.Use(app.authenticateToken())
	authorized.GET("/user/me", app.handleUserMe)
	authorized.GET("/social/users/search", app.handleSocialUserSearch)
	authorized.GET("/social/friend-requests", app.handleFriendRequests)
	authorized.GET("/social/friends", app.handleFriends)
	authorized.POST("/social/friends", app.handleAddFriend)
	authorized.POST("/social/friend-requests/:requestId/accept", app.handleAcceptFriendRequest)
	authorized.POST("/social/friend-requests/:requestId/reject", app.handleRejectFriendRequest)
	authorized.DELETE("/social/friends/:friendId", app.handleDeleteFriend)
	authorized.GET("/social/villains", app.handleVillains)
	authorized.POST("/social/villains", app.handleAddVillain)
	authorized.DELETE("/social/villains/:targetUserId", app.handleDeleteVillain)
	authorized.GET("/social/friends/:friendId/games", app.handleFriendGames)
	authorized.POST("/coins/spend-ai-match", app.handleSpendAIMatch)
	authorized.POST("/ai/move", app.handleAIMove)
	authorized.POST("/games/ai", app.handleSaveAIGame)
	authorized.POST("/coins/recharge", app.handleRecharge)
	authorized.DELETE("/auth/me", app.handleDeleteMe)
	authorized.GET("/games", app.handleGames)
	authorized.GET("/games/:id", app.handleGameDetail)

	app.api.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": "API route not found"})
	})
}

func (app *app) authenticateToken() gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		tokenString := ""
		if stringsHasPrefix(authHeader, "Bearer ") {
			tokenString = stringsTrimSpace(authHeader[7:])
		}
		if tokenString == "" {
			c.Status(http.StatusUnauthorized)
			c.Abort()
			return
		}

		claims := &authClaims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
			return []byte(app.cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			c.Status(http.StatusForbidden)
			c.Abort()
			return
		}
		if claims.ID == 0 || claims.SID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid session", "code": "SESSION_INVALID"})
			c.Abort()
			return
		}
		if !app.isSessionActive(claims.ID, claims.SID) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Duplicate login detected", "code": "DUPLICATE_LOGIN"})
			c.Abort()
			return
		}

		c.Set("userClaims", claims)
		c.Next()
	}
}

func currentClaims(c *gin.Context) *authClaims {
	value, _ := c.Get("userClaims")
	claims, _ := value.(*authClaims)
	return claims
}

func (app *app) frontendHandler() http.Handler {
	distDir := filepath.Join("..", "frontend", "dist")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if stringsHasPrefix(r.URL.Path, "/api") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"API route not found"}`))
			return
		}

		path := filepath.Clean(r.URL.Path)
		if path == "." || path == "/" {
			path = "/index.html"
		}

		candidate := filepath.Join(distDir, path)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			http.ServeFile(w, r, candidate)
			return
		}

		indexFile := filepath.Join(distDir, "index.html")
		if _, err := os.Stat(indexFile); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte("Backend running. Frontend build not found."))
			return
		}
		http.ServeFile(w, r, indexFile)
	})
}

func (app *app) buildBoard(raw any) ([][]map[string]any, bool) {
	if !isValidBoardState(raw) {
		return nil, false
	}

	rawRows := raw.([]any)
	board := make([][]map[string]any, 0, len(rawRows))
	for _, rowValue := range rawRows {
		rowValues := rowValue.([]any)
		row := make([]map[string]any, 0, len(rowValues))
		for _, pieceValue := range rowValues {
			if pieceValue == nil {
				row = append(row, nil)
				continue
			}
			pieceMap, _ := pieceValue.(map[string]any)
			row = append(row, map[string]any{
				"team": toString(pieceMap["team"]),
				"type": toString(pieceMap["type"]),
			})
		}
		board = append(board, row)
	}
	return board, true
}

func stringsHasPrefix(value, prefix string) bool {
	return strings.HasPrefix(value, prefix)
}
