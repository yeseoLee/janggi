package application

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/yeseolee/janggi/api-server/internal/domain"
	socketio "github.com/zishang520/socket.io/servers/socket/v3"
)

const (
	teamCho = domain.TeamCho
	teamHan = domain.TeamHan

	userSelfFields          = "id, username, nickname, rank, wins, losses, coins, rank_wins, rank_losses, rating, ai_unlocked_tier"
	mainThinkingTimeMS      = domain.MainThinkingTimeMS
	byoyomiTimeMS           = domain.ByoyomiTimeMS
	byoyomiPeriods          = domain.ByoyomiPeriods
	setupSelectionTimeoutMS = domain.SetupSelectionTimeoutMS
	defaultAITier           = domain.DefaultAITier
)

type Config struct {
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

type config = Config

type Database interface {
	dbQuerier
	Begin(context.Context) (pgx.Tx, error)
}

type database = Database

type HTTPDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type httpDoer = HTTPDoer

type AuthClaims struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	SID      string `json:"sid"`
	jwt.RegisteredClaims
}

type authClaims = AuthClaims

type SessionRecord struct {
	SessionID string
	Sockets   map[string]*socketio.Socket
}

type sessionRecord = SessionRecord

type SocketAuth struct {
	UserID    int
	SessionID string
}

type socketAuth = SocketAuth

type TeamPlayer struct {
	ID       int
	SocketID string
	Socket   *socketio.Socket
	UserInfo map[string]any
}

type teamPlayer = TeamPlayer

type position = domain.Position
type movePayload = domain.MovePayload
type moveLogEvent = domain.MoveLogEvent
type teamClock = domain.TeamClock
type aiUnlockState = domain.AIUnlockState

type GameState struct {
	Cho                    *TeamPlayer
	Han                    *TeamPlayer
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

type gameState = GameState

type QueueEntry struct {
	Socket   *socketio.Socket
	UserInfo map[string]any
}

type queueEntry = QueueEntry

type PendingFriendlyInvite struct {
	InviteID    string
	FromUserID  int
	ToUserID    int
	FromInfo    map[string]any
	ToInfo      map[string]any
	CreatedAtMS int64
	Status      string
}

type pendingFriendlyInvite = PendingFriendlyInvite

type PendingFriendlyMatch struct {
	MatchID     string
	RoomID      string
	ChoUserID   int
	HanUserID   int
	ChoInfo     map[string]any
	HanInfo     map[string]any
	CreatedAtMS int64
}

type pendingFriendlyMatch = PendingFriendlyMatch

type Service struct {
	cfg *config
	db  database
	io  *socketio.Server

	state      *serverState
	now        func() time.Time
	newID      func() string
	httpClient httpDoer
	distDir    string
}

type app = Service

type ServerState struct {
	mu sync.RWMutex

	matchMu                sync.Mutex
	activeSessions         map[string]*sessionRecord
	activeGames            map[string]*gameState
	pendingFriendlyInvites map[string]*pendingFriendlyInvite
	pendingFriendlyMatches map[string]*pendingFriendlyMatch
	matchQueue             []*queueEntry
}

type serverState = ServerState

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
	Pass     bool                `json:"pass"`
	BestMove string              `json:"bestmove"`
	Move     *domain.MovePayload `json:"move,omitempty"`
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
