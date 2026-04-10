package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/yeseolee/janggi/api-server/internal/application"
)

type noopDatabase struct{}

func (noopDatabase) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}
func (noopDatabase) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, nil
}
func (noopDatabase) QueryRow(context.Context, string, ...any) pgx.Row { return nil }
func (noopDatabase) Begin(context.Context) (pgx.Tx, error)            { return nil, nil }

type noopHTTPDoer struct{}

func (noopHTTPDoer) Do(*http.Request) (*http.Response, error) { return nil, nil }

func TestNewRouterNoRoute(t *testing.T) {
	service := application.NewService(application.Config{JWTSecret: "secret"}, noopDatabase{}, time.Now, func() string { return "id" }, noopHTTPDoer{})
	router := NewRouter(service)

	request := httptest.NewRequest(http.MethodGet, "/api/does-not-exist", nil)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", recorder.Code)
	}
}
