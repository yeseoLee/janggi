package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (app *app) frontendHandler() http.Handler {
	distDir := app.distDir
	if stringsTrimSpace(distDir) == "" {
		distDir = filepath.Join("..", "frontend", "dist")
	}
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
