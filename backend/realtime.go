package main

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	socketio "github.com/zishang520/socket.io/servers/socket/v3"
)

func (app *app) getSessionKey(userID int) string {
	return itoa(userID)
}

func (app *app) isSessionActive(userID int, sessionID string) bool {
	if userID <= 0 || stringsTrimSpace(sessionID) == "" {
		return false
	}

	key := app.getSessionKey(userID)
	app.stateMu.Lock()
	defer app.stateMu.Unlock()

	record := app.activeSessions[key]
	if record == nil {
		app.activeSessions[key] = &sessionRecord{
			SessionID: sessionID,
			Sockets:   make(map[string]*socketio.Socket),
		}
		return true
	}
	return record.SessionID == sessionID
}

func (app *app) registerSessionSocket(userID int, sessionID string, socket *socketio.Socket) bool {
	if socket == nil {
		return false
	}

	key := app.getSessionKey(userID)
	app.stateMu.Lock()
	defer app.stateMu.Unlock()

	record := app.activeSessions[key]
	if record == nil || record.SessionID != sessionID {
		return false
	}
	record.Sockets[string(socket.Id())] = socket
	return true
}

func (app *app) unregisterSessionSocket(userID int, sessionID, socketID string) {
	key := app.getSessionKey(userID)
	app.stateMu.Lock()
	defer app.stateMu.Unlock()

	record := app.activeSessions[key]
	if record == nil || record.SessionID != sessionID {
		return
	}
	delete(record.Sockets, socketID)
}

func (app *app) getSessionSockets(userID int) []*socketio.Socket {
	app.stateMu.RLock()
	defer app.stateMu.RUnlock()

	record := app.activeSessions[app.getSessionKey(userID)]
	if record == nil {
		return nil
	}

	sockets := make([]*socketio.Socket, 0, len(record.Sockets))
	for _, socket := range record.Sockets {
		sockets = append(sockets, socket)
	}
	return sockets
}

func (app *app) emitToUserSockets(userID int, event string, payload any) int {
	sockets := app.getSessionSockets(userID)
	emitted := 0
	for _, socket := range sockets {
		if socket == nil || !socket.Connected() {
			continue
		}
		_ = socket.Emit(event, payload)
		emitted++
	}
	return emitted
}

func (app *app) terminateSessionSockets(userID int, record *sessionRecord, reason string) {
	if record == nil {
		return
	}

	sockets := make([]*socketio.Socket, 0, len(record.Sockets))
	app.stateMu.RLock()
	for _, socket := range record.Sockets {
		sockets = append(sockets, socket)
	}
	app.stateMu.RUnlock()

	for _, socket := range sockets {
		if socket == nil {
			continue
		}
		app.forceResignForSocket(string(socket.Id()))
		_ = socket.Emit("session_terminated", map[string]any{"reason": reason})
		socket.Disconnect(true)
	}

	app.stateMu.Lock()
	record.Sockets = make(map[string]*socketio.Socket)
	app.stateMu.Unlock()
}

func (app *app) setupSocketServer() {
	opts := socketio.DefaultServerOptions()
	opts.SetServeClient(false)
	app.io = socketio.NewServer(nil, opts)
	app.registerSocketHandlers()
}

func (app *app) registerSocketHandlers() {
	_ = app.io.On("connection", func(args ...any) {
		socket := args[0].(*socketio.Socket)
		app.handleSocketConnection(socket)
	})
}

func (app *app) handleSocketConnection(socket *socketio.Socket) {
	tokenString := app.extractSocketToken(socket)
	if tokenString == "" {
		socket.Disconnect(true)
		return
	}

	claims := &authClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
		return []byte(app.cfg.JWTSecret), nil
	})
	if err != nil || !token.Valid {
		socket.Disconnect(true)
		return
	}
	if claims.ID == 0 || claims.SID == "" || !app.isSessionActive(claims.ID, claims.SID) {
		_ = socket.Emit("session_terminated", map[string]any{"reason": "duplicate_login"})
		socket.Disconnect(true)
		return
	}

	socket.SetData(socketAuth{UserID: claims.ID, SessionID: claims.SID})
	if !app.registerSessionSocket(claims.ID, claims.SID, socket) {
		_ = socket.Emit("session_terminated", map[string]any{"reason": "duplicate_login"})
		socket.Disconnect(true)
		return
	}

	_ = socket.On("find_match", func(args ...any) { app.onFindMatch(socket, args...) })
	_ = socket.On("friendly_invite_send", func(args ...any) { app.onFriendlyInviteSend(socket, args...) })
	_ = socket.On("friendly_invite_decline", func(args ...any) { app.onFriendlyInviteDecline(socket, args...) })
	_ = socket.On("friendly_invite_accept", func(args ...any) { app.onFriendlyInviteAccept(socket, args...) })
	_ = socket.On("join_friendly_match", func(args ...any) { app.onJoinFriendlyMatch(socket, args...) })
	_ = socket.On("setup_phase_started", func(args ...any) { app.onSetupPhaseStarted(socket, args...) })
	_ = socket.On("submit_setup", func(args ...any) { app.onSubmitSetup(socket, args...) })
	_ = socket.On("cancel_match", func(args ...any) { app.onCancelMatch(socket, args...) })
	_ = socket.On("move", func(args ...any) { app.onMove(socket, args...) })
	_ = socket.On("pass", func(args ...any) { app.onPass(socket, args...) })
	_ = socket.On("resign", func(args ...any) { app.onResign(socket, args...) })
	_ = socket.On("checkmate", func(args ...any) { app.onCheckmate(socket, args...) })
	_ = socket.On("finish_by_rule", func(args ...any) { app.onFinishByRule(socket, args...) })
	_ = socket.On("disconnect", func(args ...any) { app.onDisconnect(socket, args...) })
}

func (app *app) extractSocketToken(socket *socketio.Socket) string {
	if socket == nil || socket.Handshake() == nil {
		return ""
	}
	if token, ok := socket.Handshake().Auth["token"].(string); ok && stringsTrimSpace(token) != "" {
		return stringsTrimSpace(token)
	}
	if authHeader, ok := socket.Handshake().Headers["authorization"]; ok {
		switch value := authHeader.(type) {
		case string:
			if stringsHasPrefix(value, "Bearer ") {
				return stringsTrimSpace(value[7:])
			}
		case []string:
			if len(value) > 0 && stringsHasPrefix(value[0], "Bearer ") {
				return stringsTrimSpace(value[0][7:])
			}
		case []any:
			if len(value) > 0 {
				header := toString(value[0])
				if stringsHasPrefix(header, "Bearer ") {
					return stringsTrimSpace(header[7:])
				}
			}
		}
	}
	if values, ok := socket.Handshake().Query["token"]; ok {
		switch value := values.(type) {
		case string:
			return stringsTrimSpace(value)
		case []string:
			if len(value) > 0 {
				return stringsTrimSpace(value[0])
			}
		case []any:
			if len(value) > 0 {
				return stringsTrimSpace(toString(value[0]))
			}
		}
	}
	return ""
}

func socketAck(args []any) socketio.Ack {
	if len(args) == 0 {
		return nil
	}
	ack, _ := args[len(args)-1].(socketio.Ack)
	return ack
}

func payloadMap(args []any) map[string]any {
	if len(args) == 0 {
		return nil
	}
	payload, _ := args[0].(map[string]any)
	return payload
}

func (app *app) socketAuth(socket *socketio.Socket) (socketAuth, bool) {
	value := socket.Data()
	auth, ok := value.(socketAuth)
	return auth, ok
}

func (app *app) forceResignForSocket(socketID string) bool {
	app.stateMu.RLock()
	roomID, game := app.findGameBySocketIDLocked(socketID)
	app.stateMu.RUnlock()
	if roomID == "" || game == nil || game.Finished {
		return false
	}

	resignTeam := app.getTeamBySocketID(game, socketID)
	if resignTeam == "" {
		return false
	}
	if !app.hasGameStarted(game) {
		app.cancelPreGameMatch(roomID, "duplicate_login_before_start", socketID)
		return true
	}

	winnerTeam := getOpponentTeam(resignTeam)
	app.emitToRoom(roomID, "game_over", map[string]any{
		"winner":       winnerTeam,
		"type":         "resign",
		"resignedTeam": resignTeam,
	})
	app.processGameEnd(context.Background(), roomID, winnerTeam, "resign")
	return true
}

func (app *app) onFindMatch(socket *socketio.Socket, args ...any) {
	auth, ok := app.socketAuth(socket)
	if !ok {
		return
	}
	if !app.isSessionActive(auth.UserID, auth.SessionID) {
		_ = socket.Emit("session_terminated", map[string]any{"reason": "duplicate_login"})
		socket.Disconnect(true)
		return
	}

	userInfo := payloadMap(args)
	if userInfo == nil {
		return
	}
	if userID, ok := toInt(userInfo["id"]); !ok || userID != auth.UserID {
		return
	}

	userInfo = cloneUserInfo(userInfo)
	userInfo["id"] = auth.UserID

	app.stateMu.Lock()
	for _, queued := range app.matchQueue {
		if queued.Socket != nil && string(queued.Socket.Id()) == string(socket.Id()) {
			app.stateMu.Unlock()
			return
		}
	}
	app.matchQueue = append(app.matchQueue, &queueEntry{Socket: socket, UserInfo: userInfo})
	app.stateMu.Unlock()

	app.tryMatchQueue(context.Background())
}

func (app *app) onFriendlyInviteSend(socket *socketio.Socket, args ...any) {
	ack := socketAck(args)
	payload := payloadMap(args)
	auth, ok := app.socketAuth(socket)
	if !ok || ack == nil {
		if ack != nil {
			ack([]any{map[string]any{"ok": false, "error": "NOT_AUTHORIZED"}}, nil)
		}
		return
	}
	if !app.isSessionActive(auth.UserID, auth.SessionID) {
		_ = socket.Emit("session_terminated", map[string]any{"reason": "duplicate_login"})
		socket.Disconnect(true)
		ack([]any{map[string]any{"ok": false, "error": "SESSION_EXPIRED"}}, nil)
		return
	}

	targetUserID, ok := toInt(payload["targetUserId"])
	if !ok || targetUserID <= 0 || targetUserID == auth.UserID {
		ack([]any{map[string]any{"ok": false, "error": "INVALID_TARGET"}}, nil)
		return
	}

	app.cleanupExpiredFriendlyInvites(time.Now().UnixMilli())

	ctx := context.Background()
	isFriend, err := app.areUsersFriends(ctx, auth.UserID, targetUserID)
	if err != nil {
		ack([]any{map[string]any{"ok": false, "error": "SERVER_ERROR"}}, nil)
		return
	}
	if !isFriend {
		ack([]any{map[string]any{"ok": false, "error": "NOT_FRIEND"}}, nil)
		return
	}

	blocked, err := app.areUsersBlocked(ctx, auth.UserID, targetUserID)
	if err != nil {
		ack([]any{map[string]any{"ok": false, "error": "SERVER_ERROR"}}, nil)
		return
	}
	if blocked {
		ack([]any{map[string]any{"ok": false, "error": "BLOCKED_USER"}}, nil)
		return
	}

	senderInfo, err := app.fetchUserPublicInfo(ctx, auth.UserID)
	if err != nil || senderInfo == nil {
		ack([]any{map[string]any{"ok": false, "error": "USER_NOT_FOUND"}}, nil)
		return
	}
	targetInfo, err := app.fetchUserPublicInfo(ctx, targetUserID)
	if err != nil || targetInfo == nil {
		ack([]any{map[string]any{"ok": false, "error": "USER_NOT_FOUND"}}, nil)
		return
	}

	targetSockets := app.getSessionSockets(targetUserID)
	onlineSockets := 0
	for _, targetSocket := range targetSockets {
		if targetSocket != nil && targetSocket.Connected() {
			onlineSockets++
		}
	}
	if onlineSockets == 0 {
		ack([]any{map[string]any{"ok": false, "error": "TARGET_OFFLINE"}}, nil)
		return
	}

	inviteID := uuid.NewString()
	app.stateMu.Lock()
	app.pendingFriendlyInvites[inviteID] = &pendingFriendlyInvite{
		InviteID:    inviteID,
		FromUserID:  auth.UserID,
		ToUserID:    targetUserID,
		FromInfo:    senderInfo,
		ToInfo:      targetInfo,
		CreatedAtMS: time.Now().UnixMilli(),
		Status:      "pending",
	}
	app.stateMu.Unlock()

	app.emitToUserSockets(targetUserID, "friendly_invite_received", map[string]any{
		"inviteId": inviteID,
		"from":     senderInfo,
	})
	ack([]any{map[string]any{"ok": true, "inviteId": inviteID}}, nil)
}

func (app *app) onFriendlyInviteDecline(socket *socketio.Socket, args ...any) {
	ack := socketAck(args)
	payload := payloadMap(args)
	if ack == nil {
		return
	}
	auth, ok := app.socketAuth(socket)
	if !ok {
		ack([]any{map[string]any{"ok": false, "error": "NOT_ALLOWED"}}, nil)
		return
	}

	inviteID := toString(payload["inviteId"])
	app.stateMu.Lock()
	invite := app.pendingFriendlyInvites[inviteID]
	if invite == nil {
		app.stateMu.Unlock()
		ack([]any{map[string]any{"ok": true}}, nil)
		return
	}
	if invite.ToUserID != auth.UserID {
		app.stateMu.Unlock()
		ack([]any{map[string]any{"ok": false, "error": "NOT_ALLOWED"}}, nil)
		return
	}
	delete(app.pendingFriendlyInvites, inviteID)
	app.stateMu.Unlock()

	app.emitToUserSockets(invite.FromUserID, "friendly_invite_declined", map[string]any{
		"inviteId": inviteID,
		"toUserId": invite.ToUserID,
	})
	ack([]any{map[string]any{"ok": true}}, nil)
}

func (app *app) onFriendlyInviteAccept(socket *socketio.Socket, args ...any) {
	ack := socketAck(args)
	payload := payloadMap(args)
	if ack == nil {
		return
	}
	auth, ok := app.socketAuth(socket)
	if !ok {
		ack([]any{map[string]any{"ok": false, "error": "NOT_AUTHORIZED"}}, nil)
		return
	}

	inviteID := toString(payload["inviteId"])
	app.cleanupExpiredFriendlyInvites(time.Now().UnixMilli())
	app.cleanupExpiredFriendlyMatches(time.Now().UnixMilli())

	app.stateMu.RLock()
	invite := app.pendingFriendlyInvites[inviteID]
	app.stateMu.RUnlock()
	if invite == nil {
		ack([]any{map[string]any{"ok": false, "error": "INVITE_NOT_FOUND"}}, nil)
		return
	}
	if invite.ToUserID != auth.UserID {
		ack([]any{map[string]any{"ok": false, "error": "NOT_ALLOWED"}}, nil)
		return
	}

	ctx := context.Background()
	blocked, err := app.areUsersBlocked(ctx, invite.FromUserID, invite.ToUserID)
	if err != nil {
		ack([]any{map[string]any{"ok": false, "error": "SERVER_ERROR"}}, nil)
		return
	}
	if blocked {
		app.stateMu.Lock()
		delete(app.pendingFriendlyInvites, inviteID)
		app.stateMu.Unlock()
		ack([]any{map[string]any{"ok": false, "error": "BLOCKED_USER"}}, nil)
		return
	}

	stillFriends, err := app.areUsersFriends(ctx, invite.FromUserID, invite.ToUserID)
	if err != nil {
		ack([]any{map[string]any{"ok": false, "error": "SERVER_ERROR"}}, nil)
		return
	}
	if !stillFriends {
		app.stateMu.Lock()
		delete(app.pendingFriendlyInvites, inviteID)
		app.stateMu.Unlock()
		ack([]any{map[string]any{"ok": false, "error": "NOT_FRIEND"}}, nil)
		return
	}

	fromInfo, err := app.fetchUserPublicInfo(ctx, invite.FromUserID)
	if err != nil || fromInfo == nil {
		ack([]any{map[string]any{"ok": false, "error": "USER_NOT_FOUND"}}, nil)
		return
	}
	toInfo, err := app.fetchUserPublicInfo(ctx, invite.ToUserID)
	if err != nil || toInfo == nil {
		ack([]any{map[string]any{"ok": false, "error": "USER_NOT_FOUND"}}, nil)
		return
	}

	choPlayer, hanPlayer := app.pickChoHanPlayers(&queueEntry{UserInfo: fromInfo}, &queueEntry{UserInfo: toInfo})
	choInfo := cloneUserInfo(choPlayer.UserInfo)
	hanInfo := cloneUserInfo(hanPlayer.UserInfo)
	matchID := uuid.NewString()

	app.stateMu.Lock()
	app.pendingFriendlyMatches[matchID] = &pendingFriendlyMatch{
		MatchID:     matchID,
		RoomID:      "friendly_" + matchID,
		ChoUserID:   mustInt(choInfo["id"]),
		HanUserID:   mustInt(hanInfo["id"]),
		ChoInfo:     choInfo,
		HanInfo:     hanInfo,
		CreatedAtMS: time.Now().UnixMilli(),
	}
	delete(app.pendingFriendlyInvites, inviteID)
	app.stateMu.Unlock()

	app.emitToUserSockets(invite.FromUserID, "friendly_match_ready", map[string]any{
		"matchId":  matchID,
		"opponent": toInfo,
	})
	app.emitToUserSockets(invite.ToUserID, "friendly_match_ready", map[string]any{
		"matchId":  matchID,
		"opponent": fromInfo,
	})
	ack([]any{map[string]any{"ok": true, "matchId": matchID}}, nil)
}

func (app *app) onJoinFriendlyMatch(socket *socketio.Socket, args ...any) {
	ack := socketAck(args)
	payload := payloadMap(args)
	if ack == nil {
		return
	}
	auth, ok := app.socketAuth(socket)
	if !ok {
		ack([]any{map[string]any{"ok": false, "error": "NOT_AUTHORIZED"}}, nil)
		return
	}
	if !app.isSessionActive(auth.UserID, auth.SessionID) {
		_ = socket.Emit("session_terminated", map[string]any{"reason": "duplicate_login"})
		socket.Disconnect(true)
		ack([]any{map[string]any{"ok": false, "error": "SESSION_EXPIRED"}}, nil)
		return
	}

	matchID := toString(payload["matchId"])
	app.cleanupExpiredFriendlyMatches(time.Now().UnixMilli())

	app.stateMu.Lock()
	match := app.pendingFriendlyMatches[matchID]
	app.stateMu.Unlock()
	if match == nil {
		ack([]any{map[string]any{"ok": false, "error": "MATCH_NOT_FOUND"}}, nil)
		return
	}

	myTeam := ""
	switch auth.UserID {
	case match.ChoUserID:
		myTeam = teamCho
	case match.HanUserID:
		myTeam = teamHan
	default:
		ack([]any{map[string]any{"ok": false, "error": "NOT_ALLOWED"}}, nil)
		return
	}

	roomID := match.RoomID
	app.stateMu.Lock()
	game := app.activeGames[roomID]
	if game == nil {
		game = app.buildRealtimeGameState(roomID, &teamPlayer{ID: match.ChoUserID, UserInfo: cloneUserInfo(match.ChoInfo)}, &teamPlayer{ID: match.HanUserID, UserInfo: cloneUserInfo(match.HanInfo)}, "friendly")
	}
	if myTeam == teamCho {
		game.Cho.Socket = socket
		game.Cho.SocketID = string(socket.Id())
		game.Cho.UserInfo = cloneUserInfo(match.ChoInfo)
	} else {
		game.Han.Socket = socket
		game.Han.SocketID = string(socket.Id())
		game.Han.UserInfo = cloneUserInfo(match.HanInfo)
	}
	if game.Cho.Socket != nil && game.Han.Socket != nil {
		delete(app.pendingFriendlyMatches, matchID)
	}
	app.stateMu.Unlock()

	socket.Join(socketio.Room(roomID))

	opponentInfo := match.ChoInfo
	if myTeam == teamCho {
		opponentInfo = match.HanInfo
	}
	_ = socket.Emit("match_found", map[string]any{
		"room":       roomID,
		"team":       myTeam,
		"opponent":   opponentInfo,
		"mode":       "friendly",
		"setupTimer": nil,
	})
	ack([]any{map[string]any{"ok": true, "roomId": roomID, "team": myTeam}}, nil)
}

func (app *app) onSetupPhaseStarted(socket *socketio.Socket, args ...any) {
	payload := payloadMap(args)
	roomID := toString(payload["room"])
	team := toString(payload["team"])
	if roomID == "" || !isValidTeam(team) {
		return
	}

	app.stateMu.RLock()
	game := app.activeGames[roomID]
	app.stateMu.RUnlock()
	if game == nil || game.Finished || app.hasGameStarted(game) {
		return
	}

	actorTeam := app.getTeamBySocketID(game, string(socket.Id()))
	if actorTeam == "" || actorTeam != team {
		return
	}

	expectedTeam := app.getExpectedSetupTeam(game)
	if expectedTeam == "" || expectedTeam != team {
		return
	}

	if game.SetupPhaseTeam == team && game.SetupPhaseDeadlineAt > time.Now().UnixMilli() {
		_ = socket.Emit("setup_timer_sync", app.buildSetupTimerSyncPayload(game, setupSelectionTimeoutMS))
		return
	}
	app.startSetupPhase(roomID, team, setupSelectionTimeoutMS)
}

func (app *app) onSubmitSetup(socket *socketio.Socket, args ...any) {
	payload := payloadMap(args)
	roomID := toString(payload["room"])
	team := toString(payload["team"])
	setupType := toString(payload["setupType"])

	app.stateMu.Lock()
	game := app.activeGames[roomID]
	if game == nil || !isValidTeam(team) {
		app.stateMu.Unlock()
		return
	}
	actorTeam := app.getTeamBySocketID(game, string(socket.Id()))
	expectedTeam := app.getExpectedSetupTeam(game)
	if actorTeam == "" || actorTeam != team || expectedTeam == "" || expectedTeam != team {
		app.stateMu.Unlock()
		return
	}

	if team == teamCho {
		game.ChoSetup = setupType
	} else {
		game.HanSetup = setupType
	}
	startGameNow := app.hasGameStarted(game) && game.TurnStartedAt == 0
	nextTeam := app.getExpectedSetupTeam(game)
	app.stateMu.Unlock()

	app.emitToRoom(roomID, "opponent_setup", map[string]any{
		"team":      team,
		"setupType": setupType,
	})

	if startGameNow {
		app.stateMu.Lock()
		game = app.activeGames[roomID]
		if game != nil {
			app.clearSetupTimeout(game)
			game.SetupPhaseTeam = ""
			game.SetupPhaseStartedAt = 0
			game.SetupPhaseDeadlineAt = 0
			now := time.Now()
			game.StartTime = &now
			app.beginNextTurn(game, teamCho, time.Now().UnixMilli())
		}
		app.stateMu.Unlock()

		app.emitClockSync(roomID, time.Now().UnixMilli())
		app.scheduleTurnTimeout(roomID)
		return
	}

	if nextTeam != "" {
		app.startSetupPhase(roomID, nextTeam, setupSelectionTimeoutMS)
	}
}

func (app *app) onCancelMatch(socket *socketio.Socket, args ...any) {
	payload := payloadMap(args)
	roomID := toString(payload["room"])
	reason := toString(payload["reason"])

	app.stateMu.Lock()
	filtered := make([]*queueEntry, 0, len(app.matchQueue))
	for _, queued := range app.matchQueue {
		if queued.Socket == nil || string(queued.Socket.Id()) == string(socket.Id()) {
			continue
		}
		filtered = append(filtered, queued)
	}
	app.matchQueue = filtered
	if roomID == "" {
		roomID, _ = app.findGameBySocketIDLocked(string(socket.Id()))
	}
	app.stateMu.Unlock()

	if roomID != "" {
		app.cancelPreGameMatch(roomID, defaultString(reason, "cancelled"), string(socket.Id()))
	}
}

func (app *app) onMove(socket *socketio.Socket, args ...any) {
	payload := payloadMap(args)
	roomID := toString(payload["room"])
	moveMap, _ := payload["move"].(map[string]any)
	move, ok := parseMovePayload(moveMap)
	if !ok {
		return
	}

	app.stateMu.Lock()
	game := app.activeGames[roomID]
	if game == nil || game.Finished || !app.hasGameStarted(game) {
		app.stateMu.Unlock()
		return
	}
	actorTeam := app.getTeamBySocketID(game, string(socket.Id()))
	if actorTeam == "" || game.NextTurn != actorTeam {
		app.stateMu.Unlock()
		return
	}

	nowMS := time.Now().UnixMilli()
	timeoutTeam := app.applyElapsedToActiveTurn(game, nowMS)
	if timeoutTeam != "" {
		app.stateMu.Unlock()
		winnerTeam := getOpponentTeam(timeoutTeam)
		app.emitClockSync(roomID, nowMS)
		app.emitToRoom(roomID, "game_over", map[string]any{"winner": winnerTeam, "type": "time", "timeoutTeam": timeoutTeam})
		app.processGameEnd(context.Background(), roomID, winnerTeam, "time")
		return
	}

	nowISO := time.UnixMilli(nowMS).UTC().Format(time.RFC3339Nano)
	from := move.From
	to := move.To
	game.MoveLog = append(game.MoveLog, moveLogEvent{
		Type: "move",
		Turn: actorTeam,
		From: &from,
		To:   &to,
		At:   nowISO,
	})
	app.beginNextTurn(game, getOpponentTeam(actorTeam), nowMS)
	app.stateMu.Unlock()

	_ = socket.Broadcast().To(socketio.Room(roomID)).Emit("move", map[string]any{
		"from": move.From,
		"to":   move.To,
	})
	app.emitClockSync(roomID, nowMS)
	app.scheduleTurnTimeout(roomID)
}

func (app *app) onPass(socket *socketio.Socket, args ...any) {
	payload := payloadMap(args)
	roomID := toString(payload["room"])

	app.stateMu.Lock()
	game := app.activeGames[roomID]
	if game == nil || game.Finished || !app.hasGameStarted(game) {
		app.stateMu.Unlock()
		return
	}
	actorTeam := app.getTeamBySocketID(game, string(socket.Id()))
	if actorTeam == "" || game.NextTurn != actorTeam {
		app.stateMu.Unlock()
		return
	}

	nowMS := time.Now().UnixMilli()
	timeoutTeam := app.applyElapsedToActiveTurn(game, nowMS)
	if timeoutTeam != "" {
		app.stateMu.Unlock()
		winnerTeam := getOpponentTeam(timeoutTeam)
		app.emitClockSync(roomID, nowMS)
		app.emitToRoom(roomID, "game_over", map[string]any{"winner": winnerTeam, "type": "time", "timeoutTeam": timeoutTeam})
		app.processGameEnd(context.Background(), roomID, winnerTeam, "time")
		return
	}

	passTimestamp := time.UnixMilli(nowMS).UTC().Format(time.RFC3339Nano)
	game.MoveLog = append(game.MoveLog, moveLogEvent{
		Type: "pass",
		Turn: actorTeam,
		At:   passTimestamp,
	})
	app.beginNextTurn(game, getOpponentTeam(actorTeam), nowMS)
	app.stateMu.Unlock()

	_ = socket.Broadcast().To(socketio.Room(roomID)).Emit("pass_turn", map[string]any{
		"team": actorTeam,
		"at":   passTimestamp,
	})
	app.emitClockSync(roomID, nowMS)
	app.scheduleTurnTimeout(roomID)
}

func (app *app) onResign(socket *socketio.Socket, args ...any) {
	payload := payloadMap(args)
	roomID := toString(payload["room"])

	app.stateMu.RLock()
	game := app.activeGames[roomID]
	app.stateMu.RUnlock()
	if game == nil || game.Finished {
		return
	}
	if !app.hasGameStarted(game) {
		app.cancelPreGameMatch(roomID, "cancelled", string(socket.Id()))
		return
	}

	resignTeam := app.getTeamBySocketID(game, string(socket.Id()))
	if resignTeam == "" {
		return
	}
	winnerTeam := getOpponentTeam(resignTeam)
	app.emitToRoom(roomID, "game_over", map[string]any{
		"winner":       winnerTeam,
		"type":         "resign",
		"resignedTeam": resignTeam,
	})
	app.processGameEnd(context.Background(), roomID, winnerTeam, "resign")
}

func (app *app) onCheckmate(socket *socketio.Socket, args ...any) {
	payload := payloadMap(args)
	roomID := toString(payload["room"])
	winner := toString(payload["winner"])

	app.stateMu.RLock()
	game := app.activeGames[roomID]
	app.stateMu.RUnlock()
	if game == nil || game.Finished || !isValidTeam(winner) || !app.hasGameStarted(game) {
		return
	}
	senderTeam := app.getTeamBySocketID(game, string(socket.Id()))
	expectedWinner := getOpponentTeam(game.NextTurn)
	if senderTeam == "" || winner != expectedWinner {
		return
	}
	if senderTeam != game.NextTurn && senderTeam != expectedWinner {
		return
	}

	app.emitToRoom(roomID, "game_over", map[string]any{"winner": winner, "type": "checkmate"})
	app.processGameEnd(context.Background(), roomID, winner, "checkmate")
}

func (app *app) onFinishByRule(socket *socketio.Socket, args ...any) {
	payload := payloadMap(args)
	roomID := toString(payload["room"])
	winner := toString(payload["winner"])
	resultType := stringsToLower(stringsTrimSpace(toString(payload["type"])))

	app.stateMu.RLock()
	game := app.activeGames[roomID]
	app.stateMu.RUnlock()
	if game == nil || game.Finished || !app.hasGameStarted(game) || !isValidTeam(winner) {
		return
	}
	if app.getTeamBySocketID(game, string(socket.Id())) == "" || resultType != "score" {
		return
	}

	app.emitToRoom(roomID, "game_over", map[string]any{"winner": winner, "type": resultType})
	app.processGameEnd(context.Background(), roomID, winner, resultType)
}

func (app *app) onDisconnect(socket *socketio.Socket, args ...any) {
	auth, ok := app.socketAuth(socket)
	if ok {
		app.unregisterSessionSocket(auth.UserID, auth.SessionID, string(socket.Id()))
	}

	app.stateMu.Lock()
	filtered := make([]*queueEntry, 0, len(app.matchQueue))
	for _, queued := range app.matchQueue {
		if queued.Socket == nil || string(queued.Socket.Id()) == string(socket.Id()) {
			continue
		}
		filtered = append(filtered, queued)
	}
	app.matchQueue = filtered
	roomID, game := app.findGameBySocketIDLocked(string(socket.Id()))
	app.stateMu.Unlock()
	if roomID == "" || game == nil || game.Finished {
		return
	}

	disconnectedTeam := app.getTeamBySocketID(game, string(socket.Id()))
	if disconnectedTeam == "" {
		return
	}
	if !app.hasGameStarted(game) {
		app.cancelPreGameMatch(roomID, "disconnect_before_start", string(socket.Id()))
		return
	}

	winnerTeam := getOpponentTeam(disconnectedTeam)
	app.emitToRoom(roomID, "game_over", map[string]any{"winner": winnerTeam, "type": "time"})
	app.processGameEnd(context.Background(), roomID, winnerTeam, "time")
}

func (app *app) emitToRoom(roomID, event string, payload any) {
	_ = app.io.To(socketio.Room(roomID)).Emit(event, payload)
}

func (app *app) findGameBySocketIDLocked(socketID string) (string, *gameState) {
	for roomID, game := range app.activeGames {
		if app.getTeamBySocketID(game, socketID) != "" {
			return roomID, game
		}
	}
	return "", nil
}

func (app *app) getTeamBySocketID(game *gameState, socketID string) string {
	if game == nil {
		return ""
	}
	if game.Cho != nil && game.Cho.SocketID == socketID {
		return teamCho
	}
	if game.Han != nil && game.Han.SocketID == socketID {
		return teamHan
	}
	return ""
}

func (app *app) hasGameStarted(game *gameState) bool {
	return game != nil && game.ChoSetup != "" && game.HanSetup != ""
}

func createInitialTeamClock() teamClock {
	return teamClock{
		MainMS:         mainThinkingTimeMS,
		ByoyomiPeriods: byoyomiPeriods,
	}
}

func getNormalizedClock(clock teamClock) teamClock {
	clock.MainMS = maxInt(clock.MainMS, 0)
	clock.ByoyomiPeriods = maxInt(clock.ByoyomiPeriods, 0)
	return clock
}

func getInitialByoyomiForTurn(game *gameState) *int {
	if game == nil || !isValidTeam(game.NextTurn) {
		return nil
	}
	clock := getNormalizedClock(game.Clocks[game.NextTurn])
	if clock.MainMS > 0 {
		return nil
	}
	value := 0
	if clock.ByoyomiPeriods > 0 {
		value = byoyomiTimeMS
	}
	return &value
}

func getTurnLossBudgetMS(clock teamClock, turnByoyomiRemainingMS *int) int {
	clock = getNormalizedClock(clock)
	if clock.MainMS > 0 {
		return clock.MainMS + (clock.ByoyomiPeriods * byoyomiTimeMS)
	}
	if clock.ByoyomiPeriods <= 0 {
		return 0
	}

	firstByoyomiMS := byoyomiTimeMS
	if turnByoyomiRemainingMS != nil {
		firstByoyomiMS = *turnByoyomiRemainingMS
		if firstByoyomiMS < 0 {
			firstByoyomiMS = 0
		}
		if firstByoyomiMS > byoyomiTimeMS {
			firstByoyomiMS = byoyomiTimeMS
		}
	}
	return firstByoyomiMS + ((clock.ByoyomiPeriods - 1) * byoyomiTimeMS)
}

type projectedClock struct {
	MainMS             int
	ByoyomiPeriods     int
	ByoyomiRemainingMS *int
	TimedOut           bool
}

func projectClockAfterElapsed(clock teamClock, turnByoyomiRemainingMS *int, elapsedMS int) projectedClock {
	clock = getNormalizedClock(clock)
	safeElapsed := maxInt(elapsedMS, 0)
	turnBudgetMS := getTurnLossBudgetMS(clock, turnByoyomiRemainingMS)
	if turnBudgetMS <= 0 || safeElapsed >= turnBudgetMS {
		zero := 0
		return projectedClock{TimedOut: true, MainMS: 0, ByoyomiPeriods: 0, ByoyomiRemainingMS: &zero}
	}

	remainingElapsed := safeElapsed
	mainMS := clock.MainMS
	periods := clock.ByoyomiPeriods
	var byoyomiRemaining *int

	if mainMS > 0 {
		if remainingElapsed < mainMS {
			mainMS -= remainingElapsed
			remainingElapsed = 0
		} else {
			remainingElapsed -= mainMS
			mainMS = 0
		}
	}

	if mainMS <= 0 && periods > 0 {
		initial := byoyomiTimeMS
		if turnByoyomiRemainingMS != nil {
			initial = *turnByoyomiRemainingMS
		}
		if initial < 0 {
			initial = 0
		}
		if initial > byoyomiTimeMS {
			initial = byoyomiTimeMS
		}
		value := initial
		byoyomiRemaining = &value

		for remainingElapsed > 0 && periods > 0 {
			if remainingElapsed < *byoyomiRemaining {
				updated := *byoyomiRemaining - remainingElapsed
				byoyomiRemaining = &updated
				remainingElapsed = 0
				break
			}
			remainingElapsed -= *byoyomiRemaining
			periods--
			next := 0
			if periods > 0 {
				next = byoyomiTimeMS
			}
			byoyomiRemaining = &next
		}
	} else if mainMS <= 0 && periods <= 0 {
		zero := 0
		byoyomiRemaining = &zero
	}

	return projectedClock{
		MainMS:             mainMS,
		ByoyomiPeriods:     periods,
		ByoyomiRemainingMS: byoyomiRemaining,
		TimedOut:           false,
	}
}

func (app *app) applyElapsedToActiveTurn(game *gameState, nowMS int64) string {
	if game == nil || game.TurnStartedAt == 0 || !isValidTeam(game.NextTurn) {
		return ""
	}
	activeTeam := game.NextTurn
	projected := projectClockAfterElapsed(game.Clocks[activeTeam], game.TurnByoyomiRemainingMS, int(nowMS-game.TurnStartedAt))
	game.Clocks[activeTeam] = teamClock{
		MainMS:         projected.MainMS,
		ByoyomiPeriods: projected.ByoyomiPeriods,
	}
	game.TurnByoyomiRemainingMS = projected.ByoyomiRemainingMS
	game.TurnStartedAt = nowMS
	if projected.TimedOut {
		return activeTeam
	}
	return ""
}

func (app *app) buildClockSyncPayload(game *gameState, nowMS int64) map[string]any {
	fallback := createInitialTeamClock()
	projected := map[string]map[string]any{
		teamCho: {
			"mainMs":             getNormalizedClock(clockOrFallback(game, teamCho, fallback)).MainMS,
			"byoyomiPeriods":     getNormalizedClock(clockOrFallback(game, teamCho, fallback)).ByoyomiPeriods,
			"byoyomiRemainingMs": nil,
			"isByoyomi":          false,
		},
		teamHan: {
			"mainMs":             getNormalizedClock(clockOrFallback(game, teamHan, fallback)).MainMS,
			"byoyomiPeriods":     getNormalizedClock(clockOrFallback(game, teamHan, fallback)).ByoyomiPeriods,
			"byoyomiRemainingMs": nil,
			"isByoyomi":          false,
		},
	}

	for _, team := range []string{teamCho, teamHan} {
		if mustInt(projected[team]["mainMs"]) <= 0 {
			projected[team]["isByoyomi"] = true
			if mustInt(projected[team]["byoyomiPeriods"]) > 0 {
				projected[team]["byoyomiRemainingMs"] = byoyomiTimeMS
			} else {
				projected[team]["byoyomiRemainingMs"] = 0
			}
		}
	}

	if game != nil && game.TurnStartedAt > 0 && isValidTeam(game.NextTurn) {
		activeProjection := projectClockAfterElapsed(
			game.Clocks[game.NextTurn],
			game.TurnByoyomiRemainingMS,
			int(nowMS-game.TurnStartedAt),
		)
		projected[game.NextTurn] = map[string]any{
			"mainMs":             activeProjection.MainMS,
			"byoyomiPeriods":     activeProjection.ByoyomiPeriods,
			"byoyomiRemainingMs": nil,
			"isByoyomi":          activeProjection.MainMS <= 0,
		}
		if activeProjection.MainMS <= 0 {
			if activeProjection.ByoyomiRemainingMS != nil {
				projected[game.NextTurn]["byoyomiRemainingMs"] = *activeProjection.ByoyomiRemainingMS
			} else {
				projected[game.NextTurn]["byoyomiRemainingMs"] = 0
			}
		}
	}

	nextTurn := teamCho
	if game != nil && isValidTeam(game.NextTurn) {
		nextTurn = game.NextTurn
	}

	return map[string]any{
		"nextTurn":  nextTurn,
		"updatedAt": nowMS,
		"timeControl": map[string]any{
			"mainMs":         mainThinkingTimeMS,
			"byoyomiMs":      byoyomiTimeMS,
			"byoyomiPeriods": byoyomiPeriods,
		},
		"clocks": projected,
	}
}

func clockOrFallback(game *gameState, team string, fallback teamClock) teamClock {
	if game == nil || game.Clocks == nil {
		return fallback
	}
	clock, ok := game.Clocks[team]
	if !ok {
		return fallback
	}
	return clock
}

func (app *app) emitClockSync(roomID string, nowMS int64) {
	app.stateMu.RLock()
	game := app.activeGames[roomID]
	app.stateMu.RUnlock()
	if game == nil || game.Finished || !app.hasGameStarted(game) {
		return
	}
	app.emitToRoom(roomID, "clock_sync", app.buildClockSyncPayload(game, nowMS))
}

func (app *app) clearTurnTimeout(game *gameState) {
	if game != nil && game.TurnTimeout != nil {
		game.TurnTimeout.Stop()
		game.TurnTimeout = nil
	}
}

func (app *app) clearSetupTimeout(game *gameState) {
	if game != nil && game.SetupTimeout != nil {
		game.SetupTimeout.Stop()
		game.SetupTimeout = nil
	}
}

func (app *app) getExpectedSetupTeam(game *gameState) string {
	if game == nil {
		return ""
	}
	if game.HanSetup == "" {
		return teamHan
	}
	if game.ChoSetup == "" {
		return teamCho
	}
	return ""
}

func (app *app) buildSetupTimerSyncPayload(game *gameState, durationMS int) map[string]any {
	if game == nil || game.SetupPhaseTeam == "" || game.SetupPhaseStartedAt == 0 || game.SetupPhaseDeadlineAt == 0 {
		return nil
	}
	return map[string]any{
		"team":       game.SetupPhaseTeam,
		"startedAt":  game.SetupPhaseStartedAt,
		"deadlineAt": game.SetupPhaseDeadlineAt,
		"durationMs": durationMS,
	}
}

func (app *app) startSetupPhase(roomID, team string, durationMS int) bool {
	app.stateMu.Lock()
	game := app.activeGames[roomID]
	if game == nil || game.Finished || app.hasGameStarted(game) || !isValidTeam(team) {
		app.stateMu.Unlock()
		return false
	}

	app.clearSetupTimeout(game)
	nowMS := time.Now().UnixMilli()
	game.SetupPhaseTeam = team
	game.SetupPhaseStartedAt = nowMS
	game.SetupPhaseDeadlineAt = nowMS + int64(durationMS)
	game.SetupTimeout = time.AfterFunc(time.Duration(durationMS)*time.Millisecond, func() {
		app.stateMu.RLock()
		currentGame := app.activeGames[roomID]
		app.stateMu.RUnlock()
		if currentGame == nil || currentGame.Finished || app.hasGameStarted(currentGame) {
			return
		}
		expectedTeam := app.getExpectedSetupTeam(currentGame)
		if expectedTeam == "" || expectedTeam != team {
			return
		}
		app.cancelPreGameMatch(roomID, "setup_timeout", "")
	})
	payload := app.buildSetupTimerSyncPayload(game, durationMS)
	app.stateMu.Unlock()

	app.emitToRoom(roomID, "setup_timer_sync", payload)
	return true
}

func (app *app) scheduleTurnTimeout(roomID string) {
	app.stateMu.Lock()
	game := app.activeGames[roomID]
	if game == nil || game.Finished || !app.hasGameStarted(game) || !isValidTeam(game.NextTurn) || game.TurnStartedAt == 0 {
		app.stateMu.Unlock()
		return
	}
	app.clearTurnTimeout(game)
	timeoutMS := getTurnLossBudgetMS(game.Clocks[game.NextTurn], game.TurnByoyomiRemainingMS)
	if timeoutMS < 0 {
		timeoutMS = 0
	}
	game.TurnTimeout = time.AfterFunc(time.Duration(timeoutMS)*time.Millisecond, func() {
		app.stateMu.Lock()
		currentGame := app.activeGames[roomID]
		if currentGame == nil || currentGame.Finished || !app.hasGameStarted(currentGame) {
			app.stateMu.Unlock()
			return
		}
		nowMS := time.Now().UnixMilli()
		timeoutTeam := app.applyElapsedToActiveTurn(currentGame, nowMS)
		app.stateMu.Unlock()

		if timeoutTeam == "" {
			app.emitClockSync(roomID, nowMS)
			app.scheduleTurnTimeout(roomID)
			return
		}
		app.emitClockSync(roomID, nowMS)
		winnerTeam := getOpponentTeam(timeoutTeam)
		app.emitToRoom(roomID, "game_over", map[string]any{
			"winner":      winnerTeam,
			"type":        "time",
			"timeoutTeam": timeoutTeam,
		})
		app.processGameEnd(context.Background(), roomID, winnerTeam, "time")
	})
	app.stateMu.Unlock()
}

func (app *app) beginNextTurn(game *gameState, nextTurn string, nowMS int64) {
	if game == nil || !isValidTeam(nextTurn) {
		return
	}
	game.NextTurn = nextTurn
	game.TurnStartedAt = nowMS
	game.TurnByoyomiRemainingMS = getInitialByoyomiForTurn(game)
}

func (app *app) cancelPreGameMatch(roomID, reason, cancelledBy string) bool {
	app.stateMu.Lock()
	game := app.activeGames[roomID]
	if game == nil || game.Finished || app.hasGameStarted(game) {
		app.stateMu.Unlock()
		return false
	}
	app.clearTurnTimeout(game)
	app.clearSetupTimeout(game)
	delete(app.activeGames, roomID)
	for matchID, pendingMatch := range app.pendingFriendlyMatches {
		if pendingMatch != nil && pendingMatch.RoomID == roomID {
			delete(app.pendingFriendlyMatches, matchID)
			break
		}
	}
	choSocket := game.Cho.Socket
	hanSocket := game.Han.Socket
	app.stateMu.Unlock()

	app.emitToRoom(roomID, "match_cancelled", map[string]any{"reason": reason, "cancelledBy": emptyToNil(cancelledBy)})
	if choSocket != nil {
		choSocket.Leave(socketio.Room(roomID))
	}
	if hanSocket != nil {
		hanSocket.Leave(socketio.Room(roomID))
	}
	return true
}

func (app *app) buildRealtimeGameState(roomID string, choUser, hanUser *teamPlayer, mode string) *gameState {
	game := &gameState{
		Cho:      choUser,
		Han:      hanUser,
		Mode:     mode,
		MoveLog:  []moveLogEvent{},
		NextTurn: teamCho,
		Clocks: map[string]teamClock{
			teamCho: createInitialTeamClock(),
			teamHan: createInitialTeamClock(),
		},
	}
	app.activeGames[roomID] = game
	return game
}

func (app *app) pickChoHanPlayers(left, right *queueEntry) (*queueEntry, *queueEntry) {
	scoreLeft := getRankScore(toString(left.UserInfo["rank"]))
	scoreRight := getRankScore(toString(right.UserInfo["rank"]))
	if scoreLeft < scoreRight {
		return left, right
	}
	if scoreRight < scoreLeft {
		return right, left
	}

	rateLeft := getWinRate(left.UserInfo)
	rateRight := getWinRate(right.UserInfo)
	if rateLeft < rateRight {
		return left, right
	}
	if rateRight < rateLeft {
		return right, left
	}

	if time.Now().UnixNano()%2 == 0 {
		return left, right
	}
	return right, left
}

func (app *app) cleanupQueueDisconnectedSockets() {
	app.stateMu.Lock()
	defer app.stateMu.Unlock()

	filtered := make([]*queueEntry, 0, len(app.matchQueue))
	for _, queued := range app.matchQueue {
		if queued != nil && queued.Socket != nil && queued.Socket.Connected() {
			filtered = append(filtered, queued)
		}
	}
	app.matchQueue = filtered
}

func (app *app) tryMatchQueue(ctx context.Context) {
	app.matchMu.Lock()
	defer app.matchMu.Unlock()

	app.cleanupQueueDisconnectedSockets()
	for {
		left, right := app.pickOnlineMatchPairFromQueue(ctx)
		if left == nil || right == nil {
			return
		}
		choPlayer, hanPlayer := app.pickChoHanPlayers(left, right)
		app.createOnlineMatch(choPlayer, hanPlayer)
		app.cleanupQueueDisconnectedSockets()
	}
}

func (app *app) pickOnlineMatchPairFromQueue(ctx context.Context) (*queueEntry, *queueEntry) {
	app.stateMu.RLock()
	snapshot := append([]*queueEntry(nil), app.matchQueue...)
	app.stateMu.RUnlock()
	if len(snapshot) < 2 {
		return nil, nil
	}

	for i := 0; i < len(snapshot); i++ {
		left := snapshot[i]
		if left == nil || left.Socket == nil || !left.Socket.Connected() {
			continue
		}
		for j := i + 1; j < len(snapshot); j++ {
			right := snapshot[j]
			if right == nil || right.Socket == nil || !right.Socket.Connected() {
				continue
			}

			blocked, err := app.areUsersBlocked(ctx, mustInt(left.UserInfo["id"]), mustInt(right.UserInfo["id"]))
			if err != nil || blocked {
				continue
			}

			leftID := string(left.Socket.Id())
			rightID := string(right.Socket.Id())

			app.stateMu.Lock()
			var actualLeft, actualRight *queueEntry
			filtered := make([]*queueEntry, 0, len(app.matchQueue))
			for _, queued := range app.matchQueue {
				if queued == nil || queued.Socket == nil {
					continue
				}
				socketID := string(queued.Socket.Id())
				switch socketID {
				case leftID:
					if actualLeft == nil {
						actualLeft = queued
						continue
					}
				case rightID:
					if actualRight == nil {
						actualRight = queued
						continue
					}
				}
				filtered = append(filtered, queued)
			}
			if actualLeft != nil && actualRight != nil {
				app.matchQueue = filtered
				app.stateMu.Unlock()
				return actualLeft, actualRight
			}
			app.stateMu.Unlock()
		}
	}
	return nil, nil
}

func (app *app) createOnlineMatch(choPlayer, hanPlayer *queueEntry) {
	roomID := fmt.Sprintf("game_%s_%s", choPlayer.Socket.Id(), hanPlayer.Socket.Id())
	choPlayer.Socket.Join(socketio.Room(roomID))
	hanPlayer.Socket.Join(socketio.Room(roomID))

	app.stateMu.Lock()
	game := app.buildRealtimeGameState(roomID, &teamPlayer{
		ID:       mustInt(choPlayer.UserInfo["id"]),
		SocketID: string(choPlayer.Socket.Id()),
		Socket:   choPlayer.Socket,
		UserInfo: cloneUserInfo(choPlayer.UserInfo),
	}, &teamPlayer{
		ID:       mustInt(hanPlayer.UserInfo["id"]),
		SocketID: string(hanPlayer.Socket.Id()),
		Socket:   hanPlayer.Socket,
		UserInfo: cloneUserInfo(hanPlayer.UserInfo),
	}, "online")
	setupTimer := app.buildSetupTimerSyncPayload(game, setupSelectionTimeoutMS)
	app.stateMu.Unlock()

	_ = choPlayer.Socket.Emit("match_found", map[string]any{
		"room":       roomID,
		"team":       teamCho,
		"opponent":   cloneUserInfo(hanPlayer.UserInfo),
		"mode":       "online",
		"setupTimer": setupTimer,
	})
	_ = hanPlayer.Socket.Emit("match_found", map[string]any{
		"room":       roomID,
		"team":       teamHan,
		"opponent":   cloneUserInfo(choPlayer.UserInfo),
		"mode":       "online",
		"setupTimer": setupTimer,
	})
}

func (app *app) cleanupExpiredFriendlyInvites(nowMS int64) {
	app.stateMu.Lock()
	defer app.stateMu.Unlock()
	for inviteID, invite := range app.pendingFriendlyInvites {
		if invite != nil && nowMS-invite.CreatedAtMS > 60*1000 {
			delete(app.pendingFriendlyInvites, inviteID)
		}
	}
}

func (app *app) cleanupExpiredFriendlyMatches(nowMS int64) {
	app.stateMu.Lock()
	defer app.stateMu.Unlock()
	for matchID, match := range app.pendingFriendlyMatches {
		if match != nil && nowMS-match.CreatedAtMS > 5*60*1000 {
			delete(app.pendingFriendlyMatches, matchID)
		}
	}
}

func (app *app) processGameEnd(ctx context.Context, roomID, winnerTeam, resultType string) {
	app.stateMu.Lock()
	game := app.activeGames[roomID]
	if game == nil || game.Finished || !isValidTeam(winnerTeam) {
		app.stateMu.Unlock()
		return
	}
	game.Finished = true
	app.clearTurnTimeout(game)
	app.clearSetupTimeout(game)
	winnerID := game.Cho.ID
	loserID := game.Han.ID
	if winnerTeam == teamHan {
		winnerID = game.Han.ID
		loserID = game.Cho.ID
	}
	loserTeam := getOpponentTeam(winnerTeam)
	gameMode := defaultString(game.Mode, "online")
	moveLog := append([]moveLogEvent(nil), game.MoveLog...)
	choSetup := game.ChoSetup
	hanSetup := game.HanSetup
	startedAt := time.Now()
	if game.StartTime != nil {
		startedAt = *game.StartTime
	}
	app.stateMu.Unlock()

	replayPayload := map[string]any{
		"version":  2,
		"choSetup": nilIfEmpty(choSetup),
		"hanSetup": nilIfEmpty(hanSetup),
		"moveLog":  moveLog,
	}
	replayJSON, _ := json.Marshal(replayPayload)
	moveLogJSON, _ := json.Marshal(moveLog)
	endedAt := time.Now()

	tx, err := app.db.Begin(ctx)
	if err != nil {
		app.resetGameFinished(roomID)
		return
	}
	defer tx.Rollback(ctx)

	winnerUser, err := queryOneMap(ctx, tx, `SELECT id, rank, wins, losses, rank_wins, rank_losses, rating
             FROM users
             WHERE id = $1
             FOR UPDATE`, winnerID)
	if err != nil {
		app.resetGameFinished(roomID)
		return
	}
	loserUser, err := queryOneMap(ctx, tx, `SELECT id, rank, wins, losses, rank_wins, rank_losses, rating
             FROM users
             WHERE id = $1
             FOR UPDATE`, loserID)
	if err != nil {
		app.resetGameFinished(roomID)
		return
	}

	winnerRankState := resolveRankAfterResult(toString(winnerUser["rank"]), winnerUser["rank_wins"], winnerUser["rank_losses"], "win")
	loserRankState := resolveRankAfterResult(toString(loserUser["rank"]), loserUser["rank_wins"], loserUser["rank_losses"], "loss")
	newWinnerRating, newLoserRating, _ := calculateElo(mustInt(winnerUser["rating"]), mustInt(loserUser["rating"]))

	if _, err := tx.Exec(ctx, `UPDATE users
             SET wins = $2,
                 losses = $3,
                 rank = $4,
                 rank_wins = $5,
                 rank_losses = $6,
                 rating = $7
             WHERE id = $1`,
		winnerID,
		normalizeCounter(winnerUser["wins"])+1,
		normalizeCounter(winnerUser["losses"]),
		winnerRankState.Rank,
		winnerRankState.RankWins,
		winnerRankState.RankLosses,
		newWinnerRating,
	); err != nil {
		app.resetGameFinished(roomID)
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE users
             SET wins = $2,
                 losses = $3,
                 rank = $4,
                 rank_wins = $5,
                 rank_losses = $6,
                 rating = $7
             WHERE id = $1`,
		loserID,
		normalizeCounter(loserUser["wins"]),
		normalizeCounter(loserUser["losses"])+1,
		loserRankState.Rank,
		loserRankState.RankWins,
		loserRankState.RankLosses,
		newLoserRating,
	); err != nil {
		app.resetGameFinished(roomID)
		return
	}

	if _, err := tx.Exec(ctx, `INSERT INTO games (
                winner_id, loser_id, game_mode, winner_team, loser_team,
                moves, cho_setup, han_setup, move_log, result_type, move_count, started_at, ended_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)`,
		winnerID,
		loserID,
		gameMode,
		winnerTeam,
		loserTeam,
		string(replayJSON),
		nilIfEmpty(choSetup),
		nilIfEmpty(hanSetup),
		string(moveLogJSON),
		resultType,
		len(moveLog),
		startedAt,
		endedAt,
	); err != nil {
		app.resetGameFinished(roomID)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		app.resetGameFinished(roomID)
		return
	}

	app.stateMu.Lock()
	delete(app.activeGames, roomID)
	for matchID, pendingMatch := range app.pendingFriendlyMatches {
		if pendingMatch != nil && pendingMatch.RoomID == roomID {
			delete(app.pendingFriendlyMatches, matchID)
			break
		}
	}
	app.stateMu.Unlock()
}

func (app *app) resetGameFinished(roomID string) {
	app.stateMu.Lock()
	if game := app.activeGames[roomID]; game != nil {
		game.Finished = false
	}
	app.stateMu.Unlock()
}

func parseMovePayload(payload map[string]any) (movePayload, bool) {
	fromMap, fromOK := payload["from"].(map[string]any)
	toMap, toOK := payload["to"].(map[string]any)
	if !fromOK || !toOK {
		return movePayload{}, false
	}
	from := position{R: mustInt(fromMap["r"]), C: mustInt(fromMap["c"])}
	to := position{R: mustInt(toMap["r"]), C: mustInt(toMap["c"])}
	if !isValidPosition(from) || !isValidPosition(to) {
		return movePayload{}, false
	}
	return movePayload{From: from, To: to}, true
}

func mustInt(value any) int {
	parsed, _ := toInt(value)
	return parsed
}

func emptyToNil(value string) any {
	if value == "" {
		return nil
	}
	return value
}
