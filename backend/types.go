package main

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	socketio "github.com/zishang520/socket.io/servers/socket/v3"
)

const (
	teamCho = "cho"
	teamHan = "han"

	userSelfFields = "id, username, nickname, rank, wins, losses, coins, rank_wins, rank_losses, rating, ai_unlocked_tier"

	eloKFactor       = 32
	eloDefaultRating = 1000
	eloMinRating     = 100

	mainThinkingTimeMS      = 5 * 60 * 1000
	byoyomiTimeMS           = 30 * 1000
	byoyomiPeriods          = 3
	setupSelectionTimeoutMS = 20 * 1000
)

type config struct {
	Port          string
	DBUser        string
	DBHost        string
	DBName        string
	DBPassword    string
	DBPort        string
	JWTSecret     string
	AIServiceURL  string
	AIMoveTimeMS  int
	AISearchDepth int
}

type database interface {
	dbQuerier
	Begin(context.Context) (pgx.Tx, error)
}

type httpDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type authClaims struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	SID      string `json:"sid"`
	jwt.RegisteredClaims
}

type sessionRecord struct {
	SessionID string
	Sockets   map[string]*socketio.Socket
}

type socketAuth struct {
	UserID    int
	SessionID string
}

type teamPlayer struct {
	ID       int
	SocketID string
	Socket   *socketio.Socket
	UserInfo map[string]any
}

type position struct {
	R int `json:"r"`
	C int `json:"c"`
}

type movePayload struct {
	From position `json:"from"`
	To   position `json:"to"`
}

type moveLogEvent struct {
	Type string    `json:"type"`
	Turn string    `json:"turn"`
	From *position `json:"from,omitempty"`
	To   *position `json:"to,omitempty"`
	At   string    `json:"at"`
}

type teamClock struct {
	MainMS         int `json:"mainMs"`
	ByoyomiPeriods int `json:"byoyomiPeriods"`
}

type gameState struct {
	Cho                    *teamPlayer
	Han                    *teamPlayer
	Mode                   string
	ChoSetup               string
	HanSetup               string
	MoveLog                []moveLogEvent
	NextTurn               string
	Clocks                 map[string]teamClock
	TurnStartedAt          int64
	TurnByoyomiRemainingMS *int
	TurnTimeout            *time.Timer
	SetupPhaseTeam         string
	SetupPhaseStartedAt    int64
	SetupPhaseDeadlineAt   int64
	SetupTimeout           *time.Timer
	StartTime              *time.Time
	Finished               bool
}

type queueEntry struct {
	Socket   *socketio.Socket
	UserInfo map[string]any
}

type pendingFriendlyInvite struct {
	InviteID    string
	FromUserID  int
	ToUserID    int
	FromInfo    map[string]any
	ToInfo      map[string]any
	CreatedAtMS int64
	Status      string
}

type pendingFriendlyMatch struct {
	MatchID     string
	RoomID      string
	ChoUserID   int
	HanUserID   int
	ChoInfo     map[string]any
	HanInfo     map[string]any
	CreatedAtMS int64
}

type app struct {
	cfg *config
	db  database
	api *gin.Engine
	io  *socketio.Server

	state      *serverState
	now        func() time.Time
	newID      func() string
	httpClient httpDoer
	distDir    string
}

type serverState struct {
	mu sync.RWMutex

	matchMu                sync.Mutex
	activeSessions         map[string]*sessionRecord
	activeGames            map[string]*gameState
	pendingFriendlyInvites map[string]*pendingFriendlyInvite
	pendingFriendlyMatches map[string]*pendingFriendlyMatch
	matchQueue             []*queueEntry
}

type dbQuerier interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

type registerRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type socialTargetRequest struct {
	TargetUserID int `json:"targetUserId"`
}

type aiMoveRequest struct {
	Board  any    `json:"board"`
	Turn   string `json:"turn"`
	AITier any    `json:"aiTier"`
}

type aiMoveResponse struct {
	Pass     bool         `json:"pass"`
	BestMove string       `json:"bestmove"`
	Move     *movePayload `json:"move,omitempty"`
}

type aiGameSaveRequest struct {
	MyTeam     string         `json:"myTeam"`
	WinnerTeam string         `json:"winnerTeam"`
	ChoSetup   string         `json:"choSetup"`
	HanSetup   string         `json:"hanSetup"`
	MoveLog    []moveLogEvent `json:"moveLog"`
	ResultType string         `json:"resultType"`
	StartedAt  string         `json:"startedAt"`
	EndedAt    string         `json:"endedAt"`
	AITier     any            `json:"aiTier"`
}
