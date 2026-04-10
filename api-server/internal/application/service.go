package application

import (
	"net/http"
	"time"
)

func NewService(cfg Config, db Database, now func() time.Time, newID func() string, httpClient HTTPDoer) *Service {
	return &Service{
		cfg:        &cfg,
		db:         db,
		state:      newServerState(),
		now:        now,
		newID:      newID,
		httpClient: httpClient,
	}
}

func newServerState() *serverState {
	return &serverState{
		activeSessions:         make(map[string]*sessionRecord),
		activeGames:            make(map[string]*gameState),
		pendingFriendlyInvites: make(map[string]*pendingFriendlyInvite),
		pendingFriendlyMatches: make(map[string]*pendingFriendlyMatch),
		matchQueue:             []*queueEntry{},
	}
}

func (app *app) nowTime() time.Time {
	if app.now == nil {
		return time.Now()
	}
	return app.now()
}

func (app *app) nowUnixMilli() int64 {
	return app.nowTime().UnixMilli()
}

func (app *app) nextID() string {
	if app.newID == nil {
		return ""
	}
	return app.newID()
}

func (app *app) client() httpDoer {
	if app.httpClient == nil {
		return http.DefaultClient
	}
	return app.httpClient
}
