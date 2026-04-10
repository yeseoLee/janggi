package main

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestExtractBearerToken(t *testing.T) {
	t.Parallel()

	if token := extractBearerToken(""); token != "" {
		t.Fatalf("expected empty token, got %q", token)
	}
	if token := extractBearerToken("Basic abc"); token != "" {
		t.Fatalf("expected empty token, got %q", token)
	}
	if token := extractBearerToken("Bearer abc123 "); token != "abc123" {
		t.Fatalf("expected trimmed bearer token, got %q", token)
	}
}

func TestBuildSessionRecord(t *testing.T) {
	t.Parallel()

	record := buildSessionRecord("session-1")
	if record.SessionID != "session-1" {
		t.Fatalf("expected session id to be preserved, got %q", record.SessionID)
	}
	if record.Sockets == nil || len(record.Sockets) != 0 {
		t.Fatalf("expected an empty sockets map, got %#v", record.Sockets)
	}
}

func TestSignAuthToken(t *testing.T) {
	t.Parallel()

	now := time.Date(2030, 4, 10, 12, 0, 0, 0, time.UTC)
	tokenString, err := signAuthToken("secret", now, 7, "tester", "sid-1")
	if err != nil {
		t.Fatalf("signAuthToken returned error: %v", err)
	}

	claims := &authClaims{}
	parsed, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
		return []byte("secret"), nil
	})
	if err != nil || !parsed.Valid {
		t.Fatalf("expected a valid token, err=%v", err)
	}
	if claims.ID != 7 || claims.Username != "tester" || claims.SID != "sid-1" {
		t.Fatalf("unexpected claims: %#v", claims)
	}
	if claims.ExpiresAt == nil || !claims.ExpiresAt.Time.Equal(now.Add(time.Hour)) {
		t.Fatalf("expected expiry at %v, got %#v", now.Add(time.Hour), claims.ExpiresAt)
	}
}
