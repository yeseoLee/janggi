package main

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type fakeRows struct {
	fields []pgconn.FieldDescription
	rows   [][]any
	index  int
}

func (f *fakeRows) Close()                                       {}
func (f *fakeRows) Err() error                                   { return nil }
func (f *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (f *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return f.fields }
func (f *fakeRows) Next() bool {
	if f.index >= len(f.rows) {
		return false
	}
	f.index++
	return true
}
func (f *fakeRows) Scan(dest ...any) error { return nil }
func (f *fakeRows) Values() ([]any, error) { return f.rows[f.index-1], nil }
func (f *fakeRows) RawValues() [][]byte    { return nil }
func (f *fakeRows) Conn() *pgx.Conn        { return nil }

type fakeDB struct {
	rows     pgx.Rows
	lastSQL  string
	lastArgs []any
}

func (f *fakeDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}
func (f *fakeDB) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	f.lastSQL = sql
	f.lastArgs = args
	return f.rows, nil
}
func (f *fakeDB) QueryRow(context.Context, string, ...any) pgx.Row { return nil }

func TestSpendCoinsForAIMatch(t *testing.T) {
	db := &fakeDB{
		rows: &fakeRows{
			fields: []pgconn.FieldDescription{
				{Name: "id"},
				{Name: "coins"},
			},
			rows: [][]any{{1, 4}},
		},
	}

	result, err := spendCoinsForAIMatch(context.Background(), db, 1, aiMatchEntryCost)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["spent"] != aiMatchEntryCost {
		t.Fatalf("expected spent=%d, got %v", aiMatchEntryCost, result["spent"])
	}
	user := result["user"].(map[string]any)
	if mustInt(user["id"]) != 1 || mustInt(user["coins"]) != 4 {
		t.Fatalf("unexpected user payload: %#v", user)
	}
	if len(db.lastArgs) != 2 || db.lastArgs[0] != 1 || db.lastArgs[1] != aiMatchEntryCost {
		t.Fatalf("unexpected query args: %#v", db.lastArgs)
	}
}

func TestSpendCoinsForAIMatchNotEnough(t *testing.T) {
	db := &fakeDB{
		rows: &fakeRows{
			fields: []pgconn.FieldDescription{{Name: "id"}},
			rows:   [][]any{},
		},
	}
	if _, err := spendCoinsForAIMatch(context.Background(), db, 7, aiMatchEntryCost); err != errNotEnoughCoins {
		t.Fatalf("expected errNotEnoughCoins, got %v", err)
	}
}

func TestRechargeCoins(t *testing.T) {
	db := &fakeDB{
		rows: &fakeRows{
			fields: []pgconn.FieldDescription{
				{Name: "id"},
				{Name: "coins"},
			},
			rows: [][]any{{9, 22}},
		},
	}

	result, err := rechargeCoins(context.Background(), db, 9, manualRechargeCoin)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result["added"] != manualRechargeCoin {
		t.Fatalf("expected added=%d, got %v", manualRechargeCoin, result["added"])
	}
	user := result["user"].(map[string]any)
	if mustInt(user["id"]) != 9 || mustInt(user["coins"]) != 22 {
		t.Fatalf("unexpected user payload: %#v", user)
	}
	if len(db.lastArgs) != 2 || db.lastArgs[0] != 9 || db.lastArgs[1] != manualRechargeCoin {
		t.Fatalf("unexpected query args: %#v", db.lastArgs)
	}
}

func TestRechargeCoinsUserNotFound(t *testing.T) {
	db := &fakeDB{
		rows: &fakeRows{
			fields: []pgconn.FieldDescription{{Name: "id"}},
			rows:   [][]any{},
		},
	}
	if _, err := rechargeCoins(context.Background(), db, 99, manualRechargeCoin); err != errUserNotFound {
		t.Fatalf("expected errUserNotFound, got %v", err)
	}
}
