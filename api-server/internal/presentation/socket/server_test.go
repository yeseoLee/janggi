package socketapi

import (
	"context"
	"net/http"
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

func TestNewServer(t *testing.T) {
	service := application.NewService(application.Config{JWTSecret: "secret"}, noopDatabase{}, time.Now, func() string { return "id" }, noopHTTPDoer{})
	server := NewServer(service)
	if server == nil {
		t.Fatal("expected socket server")
	}
}
