package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type noopDatabase struct{}

func (noopDatabase) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

func (noopDatabase) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, nil
}

func (noopDatabase) QueryRow(context.Context, string, ...any) pgx.Row {
	return nil
}

func (noopDatabase) Begin(context.Context) (pgx.Tx, error) {
	return nil, nil
}

func (f *fakeDB) Begin(context.Context) (pgx.Tx, error) {
	return nil, nil
}

func newTestApp() *app {
	return &app{
		cfg:        &config{JWTSecret: "secret"},
		db:         noopDatabase{},
		state:      newServerState(),
		now:        func() time.Time { return time.Date(2030, 4, 10, 12, 0, 0, 0, time.UTC) },
		newID:      func() string { return "fixed-id" },
		httpClient: stubHTTPDoer{},
	}
}

func TestAuthenticateToken(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	app := newTestApp()
	tokenString, err := signAuthToken(app.cfg.JWTSecret, app.nowTime(), 1, "tester", "sid-1")
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	app.state.activeSessions[app.getSessionKey(1)] = buildSessionRecord("sid-1")

	router := gin.New()
	router.GET("/ok", app.authenticateToken(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/ok", nil)
	request.Header.Set("Authorization", "Bearer "+tokenString)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", recorder.Code)
	}
}

func TestAuthenticateTokenRejectsInactiveSession(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	app := newTestApp()
	tokenString, err := signAuthToken(app.cfg.JWTSecret, app.nowTime(), 1, "tester", "sid-1")
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	app.state.activeSessions[app.getSessionKey(1)] = buildSessionRecord("different-sid")

	router := gin.New()
	router.GET("/ok", app.authenticateToken(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "/ok", nil)
	request.Header.Set("Authorization", "Bearer "+tokenString)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", recorder.Code)
	}
}

func TestFrontendHandlerServesDistFilesAndFallback(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("index"), 0o644); err != nil {
		t.Fatalf("failed to write index: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "asset.js"), []byte("asset"), 0o644); err != nil {
		t.Fatalf("failed to write asset: %v", err)
	}

	app := newTestApp()
	app.distDir = dir
	handler := app.frontendHandler()

	tests := []struct {
		name   string
		path   string
		status int
		body   string
	}{
		{name: "root", path: "/", status: http.StatusOK, body: "index"},
		{name: "asset", path: "/asset.js", status: http.StatusOK, body: "asset"},
		{name: "api", path: "/api/missing", status: http.StatusNotFound, body: `{"error":"API route not found"}`},
		{name: "fallback", path: "/missing", status: http.StatusOK, body: "index"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			handler.ServeHTTP(recorder, request)

			if recorder.Code != test.status {
				t.Fatalf("expected %d, got %d", test.status, recorder.Code)
			}
			body, err := io.ReadAll(recorder.Body)
			if err != nil {
				t.Fatalf("failed to read body: %v", err)
			}
			if string(body) != test.body {
				t.Fatalf("expected body %q, got %q", test.body, string(body))
			}
		})
	}
}

func TestHandleSpendAIMatchAndRecharge(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	makeRows := func(coins int) pgx.Rows {
		return &fakeRows{
			fields: []pgconn.FieldDescription{
				{Name: "id"},
				{Name: "username"},
				{Name: "nickname"},
				{Name: "rank"},
				{Name: "wins"},
				{Name: "losses"},
				{Name: "coins"},
				{Name: "rank_wins"},
				{Name: "rank_losses"},
			},
			rows: [][]any{{1, "alice", "Alice", "18급", 0, 0, coins, 0, 0}},
		}
	}

	app := newTestApp()
	db := &fakeDB{}
	app.db = db
	app.state.activeSessions[app.getSessionKey(1)] = buildSessionRecord("sid-1")
	tokenString, err := signAuthToken(app.cfg.JWTSecret, app.nowTime(), 1, "alice", "sid-1")
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	router := gin.New()
	router.POST("/api/coins/spend-ai-match", app.authenticateToken(), func(c *gin.Context) { app.handleSpendAIMatch(c) })
	router.POST("/api/coins/recharge", app.authenticateToken(), func(c *gin.Context) { app.handleRecharge(c) })

	db.rows = makeRows(9)
	spendRequest := httptest.NewRequest(http.MethodPost, "/api/coins/spend-ai-match", nil)
	spendRequest.Header.Set("Authorization", "Bearer "+tokenString)
	spendRecorder := httptest.NewRecorder()
	router.ServeHTTP(spendRecorder, spendRequest)
	if spendRecorder.Code != http.StatusOK {
		t.Fatalf("expected spend status 200, got %d", spendRecorder.Code)
	}

	db.rows = makeRows(19)
	rechargeRequest := httptest.NewRequest(http.MethodPost, "/api/coins/recharge", nil)
	rechargeRequest.Header.Set("Authorization", "Bearer "+tokenString)
	rechargeRecorder := httptest.NewRecorder()
	router.ServeHTTP(rechargeRecorder, rechargeRequest)
	if rechargeRecorder.Code != http.StatusOK {
		t.Fatalf("expected recharge status 200, got %d", rechargeRecorder.Code)
	}
}

func TestHandleAIMove(t *testing.T) {
	t.Parallel()

	gin.SetMode(gin.TestMode)
	app := newTestApp()
	app.httpClient = stubHTTPDoer{
		do: func(req *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(bytes.NewBufferString(`{"bestmove":"a10a9"}`)),
			}, nil
		},
	}

	router := gin.New()
	router.POST("/api/ai/move", func(c *gin.Context) { app.handleAIMove(c) })

	body, err := json.Marshal(aiMoveRequest{
		Board:  boardToAny(createStartBoard()),
		Turn:   teamCho,
		AITier: 0,
	})
	if err != nil {
		t.Fatalf("failed to marshal request: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/ai/move", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if !bytes.Contains(recorder.Body.Bytes(), []byte(`"bestmove":"a10a9"`)) {
		t.Fatalf("expected AI response body, got %s", recorder.Body.String())
	}
}

func boardToAny(board [][]map[string]any) []any {
	rows := make([]any, 0, len(board))
	for _, row := range board {
		rowAny := make([]any, 0, len(row))
		for _, piece := range row {
			if piece == nil {
				rowAny = append(rowAny, nil)
				continue
			}
			rowAny = append(rowAny, piece)
		}
		rows = append(rows, rowAny)
	}
	return rows
}
