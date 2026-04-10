package application

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/yeseolee/janggi/api-server/internal/domain"
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

type stubHTTPDoer struct {
	do func(*http.Request) (*http.Response, error)
}

func (s stubHTTPDoer) Do(req *http.Request) (*http.Response, error) {
	return s.do(req)
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
	router.GET("/ok", app.AuthenticateToken(), func(c *gin.Context) {
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
	router.GET("/ok", app.AuthenticateToken(), func(c *gin.Context) {
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
	router.POST("/api/coins/spend-ai-match", app.AuthenticateToken(), func(c *gin.Context) { app.HandleSpendAIMatch(c) })
	router.POST("/api/coins/recharge", app.AuthenticateToken(), func(c *gin.Context) { app.HandleRecharge(c) })

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
	router.POST("/api/ai/move", func(c *gin.Context) { app.HandleAIMove(c) })

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

func createStartBoard() [][]map[string]any {
	board := make([][]map[string]any, domain.BoardRows)
	for r := range board {
		board[r] = make([]map[string]any, domain.BoardCols)
	}

	board[0][0] = map[string]any{"team": teamHan, "type": "cha"}
	board[0][1] = map[string]any{"team": teamHan, "type": "ma"}
	board[0][2] = map[string]any{"team": teamHan, "type": "sang"}
	board[0][3] = map[string]any{"team": teamHan, "type": "sa"}
	board[0][5] = map[string]any{"team": teamHan, "type": "sa"}
	board[0][6] = map[string]any{"team": teamHan, "type": "sang"}
	board[0][7] = map[string]any{"team": teamHan, "type": "ma"}
	board[0][8] = map[string]any{"team": teamHan, "type": "cha"}
	board[1][4] = map[string]any{"team": teamHan, "type": "wang"}
	board[2][1] = map[string]any{"team": teamHan, "type": "po"}
	board[2][7] = map[string]any{"team": teamHan, "type": "po"}
	board[3][0] = map[string]any{"team": teamHan, "type": "jol"}
	board[3][2] = map[string]any{"team": teamHan, "type": "jol"}
	board[3][4] = map[string]any{"team": teamHan, "type": "jol"}
	board[3][6] = map[string]any{"team": teamHan, "type": "jol"}
	board[3][8] = map[string]any{"team": teamHan, "type": "jol"}
	board[6][0] = map[string]any{"team": teamCho, "type": "jol"}
	board[6][2] = map[string]any{"team": teamCho, "type": "jol"}
	board[6][4] = map[string]any{"team": teamCho, "type": "jol"}
	board[6][6] = map[string]any{"team": teamCho, "type": "jol"}
	board[6][8] = map[string]any{"team": teamCho, "type": "jol"}
	board[7][1] = map[string]any{"team": teamCho, "type": "po"}
	board[7][7] = map[string]any{"team": teamCho, "type": "po"}
	board[8][4] = map[string]any{"team": teamCho, "type": "wang"}
	board[9][0] = map[string]any{"team": teamCho, "type": "cha"}
	board[9][1] = map[string]any{"team": teamCho, "type": "ma"}
	board[9][2] = map[string]any{"team": teamCho, "type": "sang"}
	board[9][3] = map[string]any{"team": teamCho, "type": "sa"}
	board[9][5] = map[string]any{"team": teamCho, "type": "sa"}
	board[9][6] = map[string]any{"team": teamCho, "type": "sang"}
	board[9][7] = map[string]any{"team": teamCho, "type": "ma"}
	board[9][8] = map[string]any{"team": teamCho, "type": "cha"}
	return board
}
