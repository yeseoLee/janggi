package main

import (
	"bufio"
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type engineConfig struct {
	Port              string
	StockfishPath     string
	Variant           string
	DefaultMoveTimeMS int
	DefaultSkillLevel int
	DefaultUCIElo     int
}

type moveRequest struct {
	FEN              string `json:"fen"`
	MoveTime         any    `json:"movetime"`
	Depth            any    `json:"depth"`
	SkillLevel       any    `json:"skillLevel"`
	UseLimitStrength any    `json:"useLimitStrength"`
	UCIElo           any    `json:"uciElo"`
}

type moveResponse struct {
	BestMove string `json:"bestmove"`
	Ponder   any    `json:"ponder"`
}

type fairyStockfishEngine struct {
	mu              sync.Mutex
	binaryPath      string
	variant         string
	defaultMoveTime int
	defaultSkill    int
	defaultUCIElo   int

	cmd         *exec.Cmd
	stdin       io.WriteCloser
	lineCh      chan string
	doneCh      chan error
	initialized bool
}

func main() {
	cfg := loadEngineConfig()
	engine := newFairyStockfishEngine(cfg)

	router := gin.New()
	router.Use(gin.Recovery())
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"ok":          true,
			"initialized": engine.Initialized(),
			"variant":     cfg.Variant,
			"pid":         engine.PID(),
		})
	})
	router.POST("/move", func(c *gin.Context) {
		var req moveRequest
		if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.FEN) == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "fen is required"})
			return
		}

		result, err := engine.GetBestMove(c.Request.Context(), req)
		if err != nil {
			log.Printf("Failed to calculate AI move: %v", err)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to calculate AI move"})
			return
		}
		c.JSON(http.StatusOK, result)
	})

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 15 * time.Second,
	}

	go func() {
		if err := engine.EnsureInitialized(context.Background()); err != nil {
			log.Printf("Failed to initialize Fairy-Stockfish on startup: %v", err)
		}
	}()

	log.Printf("AI server listening on port %s", cfg.Port)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func loadEngineConfig() engineConfig {
	return engineConfig{
		Port:              getenvDefault("PORT", "4000"),
		StockfishPath:     getenvDefault("STOCKFISH_PATH", "/usr/local/bin/fairy-stockfish"),
		Variant:           getenvDefault("AI_VARIANT", "janggi"),
		DefaultMoveTimeMS: clampMoveTime(getenvDefault("AI_MOVE_TIME_MS", "700"), 700),
		DefaultSkillLevel: clampSkillLevel(getenvDefault("AI_SKILL_LEVEL", "0"), 0),
		DefaultUCIElo:     clampUCIElo(getenvDefault("AI_UCI_ELO", "1500"), 1500),
	}
}

func newFairyStockfishEngine(cfg engineConfig) *fairyStockfishEngine {
	return &fairyStockfishEngine{
		binaryPath:      cfg.StockfishPath,
		variant:         cfg.Variant,
		defaultMoveTime: cfg.DefaultMoveTimeMS,
		defaultSkill:    cfg.DefaultSkillLevel,
		defaultUCIElo:   cfg.DefaultUCIElo,
	}
}

func (e *fairyStockfishEngine) Initialized() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.initialized
}

func (e *fairyStockfishEngine) PID() any {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.cmd == nil || e.cmd.Process == nil {
		return nil
	}
	return e.cmd.Process.Pid
}

func (e *fairyStockfishEngine) EnsureInitialized(ctx context.Context) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.ensureInitializedLocked(ctx)
}

func (e *fairyStockfishEngine) GetBestMove(ctx context.Context, req moveRequest) (moveResponse, error) {
	e.mu.Lock()
	defer e.mu.Unlock()

	if err := e.ensureInitializedLocked(ctx); err != nil {
		return moveResponse{}, err
	}
	if err := e.sendCommandLocked("setoption name Skill Level value " + itoa(clampSkillLevel(req.SkillLevel, e.defaultSkill))); err != nil {
		return moveResponse{}, err
	}
	useLimitStrength := false
	switch value := req.UseLimitStrength.(type) {
	case bool:
		useLimitStrength = value
	case string:
		useLimitStrength = strings.EqualFold(strings.TrimSpace(value), "true")
	}
	limitStrengthValue := "false"
	if useLimitStrength {
		limitStrengthValue = "true"
	}
	if err := e.sendCommandLocked("setoption name UCI_LimitStrength value " + limitStrengthValue); err != nil {
		return moveResponse{}, err
	}
	if err := e.sendCommandLocked("setoption name UCI_Elo value " + itoa(clampUCIElo(req.UCIElo, e.defaultUCIElo))); err != nil {
		return moveResponse{}, err
	}
	if _, err := e.commandAndWaitLocked(ctx, "isready", func(line string) bool { return line == "readyok" }, 12*time.Second); err != nil {
		return moveResponse{}, err
	}

	if err := e.sendCommandLocked("position fen " + strings.TrimSpace(req.FEN)); err != nil {
		return moveResponse{}, err
	}

	depth, depthOK := toInt(req.Depth)
	moveTime := clampMoveTime(req.MoveTime, e.defaultMoveTime)
	goCommand := "go movetime " + itoa(moveTime)
	timeout := maxInt(8000, moveTime*4)
	if depthOK && depth > 0 {
		goCommand = "go depth " + itoa(depth)
		timeout = 15000
	}

	bestMoveLine, err := e.commandAndWaitLocked(ctx, goCommand, func(line string) bool {
		return strings.HasPrefix(line, "bestmove ")
	}, time.Duration(timeout)*time.Millisecond)
	if err != nil {
		return moveResponse{}, err
	}

	parts := strings.Fields(bestMoveLine)
	response := moveResponse{
		BestMove: "(none)",
		Ponder:   nil,
	}
	if len(parts) > 1 {
		response.BestMove = parts[1]
	}
	if len(parts) > 3 {
		response.Ponder = parts[3]
	}
	return response, nil
}

func (e *fairyStockfishEngine) ensureInitializedLocked(ctx context.Context) error {
	if e.initialized && e.cmd != nil && e.cmd.Process != nil {
		return nil
	}
	if err := e.startProcessLocked(); err != nil {
		return err
	}
	if _, err := e.commandAndWaitLocked(ctx, "uci", func(line string) bool { return line == "uciok" }, 12*time.Second); err != nil {
		return err
	}
	if err := e.sendCommandLocked("setoption name UCI_Variant value " + e.variant); err != nil {
		return err
	}
	if _, err := e.commandAndWaitLocked(ctx, "isready", func(line string) bool { return line == "readyok" }, 12*time.Second); err != nil {
		return err
	}
	e.initialized = true
	return nil
}

func (e *fairyStockfishEngine) startProcessLocked() error {
	if e.cmd != nil && e.cmd.Process != nil {
		return nil
	}

	cmd := exec.Command(e.binaryPath)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}

	e.cmd = cmd
	e.stdin = stdin
	e.lineCh = make(chan string, 512)
	e.doneCh = make(chan error, 1)
	e.initialized = false

	go func() {
		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			e.lineCh <- strings.TrimSpace(scanner.Text())
		}
		if err := scanner.Err(); err != nil {
			log.Printf("[fairy-stockfish] stdout error: %v", err)
		}
	}()

	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			message := strings.TrimSpace(scanner.Text())
			if message != "" {
				log.Printf("[fairy-stockfish] %s", message)
			}
		}
	}()

	go func() {
		e.doneCh <- cmd.Wait()
	}()

	return nil
}

func (e *fairyStockfishEngine) sendCommandLocked(command string) error {
	if e.stdin == nil {
		return errors.New("Fairy-Stockfish process is not writable")
	}
	_, err := e.stdin.Write([]byte(command + "\n"))
	return err
}

func (e *fairyStockfishEngine) commandAndWaitLocked(ctx context.Context, command string, matcher func(string) bool, timeout time.Duration) (string, error) {
	if err := e.sendCommandLocked(command); err != nil {
		return "", err
	}
	return e.waitForLineLocked(ctx, matcher, timeout)
}

func (e *fairyStockfishEngine) waitForLineLocked(ctx context.Context, matcher func(string) bool, timeout time.Duration) (string, error) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-timer.C:
			return "", errors.New("Timed out waiting for engine output")
		case err := <-e.doneCh:
			e.cmd = nil
			e.stdin = nil
			e.initialized = false
			if err == nil {
				err = errors.New("Fairy-Stockfish exited")
			}
			return "", err
		case line := <-e.lineCh:
			if matcher(line) {
				return line, nil
			}
		}
	}
}

func clampSkillLevel(value any, fallback int) int {
	parsed, ok := toInt(value)
	if !ok {
		parsed = fallback
	}
	if parsed < -20 {
		return -20
	}
	if parsed > 20 {
		return 20
	}
	return parsed
}

func clampUCIElo(value any, fallback int) int {
	parsed, ok := toInt(value)
	if !ok {
		parsed = fallback
	}
	if parsed < 1000 {
		return 1000
	}
	if parsed > 3200 {
		return 3200
	}
	return parsed
}

func clampMoveTime(value any, fallback int) int {
	parsed, ok := toInt(value)
	if !ok {
		parsed = fallback
	}
	if parsed < 100 {
		return 100
	}
	if parsed > 5000 {
		return 5000
	}
	return parsed
}

func toInt(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int64:
		return int(typed), true
	case float64:
		return int(typed), true
	case string:
		trimmed := strings.TrimSpace(typed)
		if trimmed == "" {
			return 0, false
		}
		parsed, err := strconv.Atoi(trimmed)
		if err != nil {
			return 0, false
		}
		return parsed, true
	default:
		return 0, false
	}
}

func itoa(value int) string {
	return strconv.Itoa(value)
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}

func getenvDefault(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}
