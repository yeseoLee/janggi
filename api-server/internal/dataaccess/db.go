package dataaccess

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type DBQuerier interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type Database interface {
	DBQuerier
	Begin(context.Context) (pgx.Tx, error)
}

func RowsToMaps(rows pgx.Rows) ([]map[string]any, error) {
	fieldDescriptions := rows.FieldDescriptions()
	items := make([]map[string]any, 0)

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, err
		}

		row := make(map[string]any, len(values))
		for idx, value := range values {
			field := fieldDescriptions[idx]
			row[string(field.Name)] = ConvertDBValue(field, value)
		}
		items = append(items, row)
	}

	if rows.Err() != nil {
		return nil, rows.Err()
	}

	return items, nil
}

func QueryMaps(ctx context.Context, db DBQuerier, sql string, args ...any) ([]map[string]any, error) {
	rows, err := db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return RowsToMaps(rows)
}

func QueryOneMap(ctx context.Context, db DBQuerier, sql string, args ...any) (map[string]any, error) {
	items, err := QueryMaps(ctx, db, sql, args...)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, pgx.ErrNoRows
	}
	return items[0], nil
}

func ConvertDBValue(field pgconn.FieldDescription, value any) any {
	if value == nil {
		return nil
	}

	switch typed := value.(type) {
	case []byte:
		if field.DataTypeOID == pgtype.JSONOID || field.DataTypeOID == pgtype.JSONBOID {
			var decoded any
			if err := json.Unmarshal(typed, &decoded); err == nil {
				return decoded
			}
		}
		return string(typed)
	case string:
		if field.DataTypeOID == pgtype.JSONOID || field.DataTypeOID == pgtype.JSONBOID {
			var decoded any
			if err := json.Unmarshal([]byte(typed), &decoded); err == nil {
				return decoded
			}
		}
		return typed
	case time.Time:
		return typed
	default:
		return typed
	}
}

func IsUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
