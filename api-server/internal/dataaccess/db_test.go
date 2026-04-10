package dataaccess

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
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
	rows pgx.Rows
}

func (f *fakeDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}
func (f *fakeDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return f.rows, nil
}
func (f *fakeDB) QueryRow(context.Context, string, ...any) pgx.Row { return nil }

func TestRowsToMaps(t *testing.T) {
	rows := &fakeRows{
		fields: []pgconn.FieldDescription{
			{Name: "id"},
			{Name: "payload", DataTypeOID: pgtype.JSONBOID},
		},
		rows: [][]any{{1, []byte(`{"ok":true}`)}},
	}

	items, err := RowsToMaps(rows)
	if err != nil {
		t.Fatalf("RowsToMaps returned error: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 row, got %d", len(items))
	}
	if items[0]["id"] != 1 {
		t.Fatalf("unexpected id payload: %#v", items[0])
	}
}

func TestQueryOneMap(t *testing.T) {
	db := &fakeDB{
		rows: &fakeRows{
			fields: []pgconn.FieldDescription{{Name: "id"}},
			rows:   [][]any{{7}},
		},
	}

	item, err := QueryOneMap(context.Background(), db, "select 1")
	if err != nil {
		t.Fatalf("QueryOneMap returned error: %v", err)
	}
	if item["id"] != 7 {
		t.Fatalf("unexpected item: %#v", item)
	}
}
