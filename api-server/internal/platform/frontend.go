package platform

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func NewFrontendHandler(distDir string) http.Handler {
	if strings.TrimSpace(distDir) == "" {
		distDir = filepath.Join("..", "frontend", "dist")
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api") {
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
			_, _ = w.Write([]byte("API server running. Frontend build not found."))
			return
		}
		http.ServeFile(w, r, indexFile)
	})
}
