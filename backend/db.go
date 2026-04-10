package main

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

func rowsToMaps(rows pgx.Rows) ([]map[string]any, error) {
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
			row[string(field.Name)] = convertDBValue(field, value)
		}
		items = append(items, row)
	}

	if rows.Err() != nil {
		return nil, rows.Err()
	}

	return items, nil
}

func queryMaps(ctx context.Context, db dbQuerier, sql string, args ...any) ([]map[string]any, error) {
	rows, err := db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return rowsToMaps(rows)
}

func queryOneMap(ctx context.Context, db dbQuerier, sql string, args ...any) (map[string]any, error) {
	items, err := queryMaps(ctx, db, sql, args...)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, pgx.ErrNoRows
	}
	return items[0], nil
}

func convertDBValue(field pgconn.FieldDescription, value any) any {
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

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
