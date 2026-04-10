package main

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type stubHTTPDoer struct {
	do func(*http.Request) (*http.Response, error)
}

func (s stubHTTPDoer) Do(req *http.Request) (*http.Response, error) {
	return s.do(req)
}

func TestCalculateAIMoveTimeout(t *testing.T) {
	t.Parallel()

	if got := calculateAIMoveTimeout(700); got.Milliseconds() != 15000 {
		t.Fatalf("expected minimum timeout of 15000ms, got %d", got.Milliseconds())
	}
	if got := calculateAIMoveTimeout(2500); got.Milliseconds() != 20000 {
		t.Fatalf("expected scaled timeout of 20000ms, got %d", got.Milliseconds())
	}
}

func TestBuildAIMovePayload(t *testing.T) {
	t.Parallel()

	level := aiLevel{
		MoveTimeMS:       700,
		Depth:            8,
		SkillLevel:       4,
		UseLimitStrength: true,
		UCIElo:           nil,
	}
	payload := buildAIMovePayload("fen-string", level)
	if payload["fen"] != "fen-string" || payload["movetime"] != 700 || payload["depth"] != 8 {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestRequestAIResult(t *testing.T) {
	t.Parallel()

	level := aiLevel{MoveTimeMS: 700, Depth: 8, SkillLevel: 3}
	client := stubHTTPDoer{
		do: func(req *http.Request) (*http.Response, error) {
			if req.URL.String() != "http://ai/move" {
				t.Fatalf("unexpected request url: %s", req.URL.String())
			}
			if req.Method != http.MethodPost {
				t.Fatalf("unexpected method: %s", req.Method)
			}
			body, err := io.ReadAll(req.Body)
			if err != nil {
				t.Fatalf("failed to read body: %v", err)
			}
			if !strings.Contains(string(body), `"fen":"fen"`) {
				t.Fatalf("expected fen in body, got %s", string(body))
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Body:       io.NopCloser(bytes.NewBufferString(`{"bestmove":"a10a9"}`)),
			}, nil
		},
	}

	result, err := requestAIResult(context.Background(), client, "http://ai", "fen", level)
	if err != nil {
		t.Fatalf("requestAIResult returned error: %v", err)
	}
	if result["bestmove"] != "a10a9" {
		t.Fatalf("unexpected result: %#v", result)
	}
}
