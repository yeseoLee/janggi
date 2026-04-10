package platform

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNewFrontendHandlerServesDistFilesAndFallback(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "index.html"), []byte("index"), 0o644); err != nil {
		t.Fatalf("failed to write index: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "asset.js"), []byte("asset"), 0o644); err != nil {
		t.Fatalf("failed to write asset: %v", err)
	}

	handler := NewFrontendHandler(dir)
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
