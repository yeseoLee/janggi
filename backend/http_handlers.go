package main

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

func (app *app) handleRegister(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "All fields are required"})
		return
	}
	if stringsTrimSpace(req.Username) == "" || stringsTrimSpace(req.Password) == "" || stringsTrimSpace(req.Nickname) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "All fields are required"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), 10)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}

	row, err := queryOneMap(c.Request.Context(), app.db, `INSERT INTO users (username, password, nickname, coins) VALUES ($1, $2, $3, $4) RETURNING `+userSelfFields,
		req.Username, string(hashedPassword), req.Nickname, 10)
	if err != nil {
		if isUniqueViolation(err) {
			c.JSON(http.StatusConflict, gin.H{"error": "Username already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	row["max_win_streak"] = 0
	c.JSON(http.StatusCreated, gin.H{
		"message": "User registered",
		"user":    row,
	})
}

func (app *app) handleLogin(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Fields required"})
		return
	}
	if stringsTrimSpace(req.Username) == "" || stringsTrimSpace(req.Password) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Fields required"})
		return
	}

	userRow, err := queryOneMap(c.Request.Context(), app.db, `SELECT * FROM users WHERE username = $1`, req.Username)
	if err != nil {
		if errorsIs(err, pgx.ErrNoRows) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(toString(userRow["password"])), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid credentials"})
		return
	}

	userID, _ := toInt(userRow["id"])
	userKey := app.getSessionKey(userID)
	app.state.mu.RLock()
	previousSession := app.state.activeSessions[userKey]
	app.state.mu.RUnlock()
	if previousSession != nil {
		app.terminateSessionSockets(userID, previousSession, "duplicate_login")
	}

	sessionID := app.nextID()
	app.state.mu.Lock()
	app.state.activeSessions[userKey] = buildSessionRecord(sessionID)
	app.state.mu.Unlock()

	tokenString, err := signAuthToken(app.cfg.JWTSecret, app.nowTime(), userID, toString(userRow["username"]), sessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}

	userInfo := cloneUserInfo(userRow)
	delete(userInfo, "password")
	maxWinStreak, err := app.fetchMaxWinStreak(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	userInfo["max_win_streak"] = maxWinStreak

	c.JSON(http.StatusOK, gin.H{
		"token": tokenString,
		"user":  userInfo,
	})
}

func (app *app) handleUserMe(c *gin.Context) {
	claims := currentClaims(c)
	row, err := queryOneMap(c.Request.Context(), app.db, `SELECT `+userSelfFields+` FROM users WHERE id = $1`, claims.ID)
	if err != nil {
		if errorsIs(err, pgx.ErrNoRows) {
			c.Status(http.StatusNotFound)
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	maxWinStreak, err := app.fetchMaxWinStreak(c.Request.Context(), claims.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	row["max_win_streak"] = maxWinStreak
	c.JSON(http.StatusOK, row)
}

func (app *app) handleSocialUserSearch(c *gin.Context) {
	q := stringsTrimSpace(c.Query("q"))
	if q == "" {
		c.JSON(http.StatusOK, []any{})
		return
	}
	claims := currentClaims(c)
	like := "%" + q + "%"
	items, err := queryMaps(c.Request.Context(), app.db, `SELECT
         u.id,
         u.username,
         u.nickname,
         u.rank,
         u.wins,
         u.losses,
         u.rating,
         EXISTS (
           SELECT 1 FROM friendships f
           WHERE f.user_id = $1
             AND f.friend_id = u.id
         ) AS is_friend,
         EXISTS (
           SELECT 1 FROM friend_requests fr
           WHERE fr.requester_id = $1
             AND fr.addressee_id = u.id
             AND fr.status = 'pending'
         ) AS has_outgoing_request,
         EXISTS (
           SELECT 1 FROM friend_requests fr
           WHERE fr.requester_id = u.id
             AND fr.addressee_id = $1
             AND fr.status = 'pending'
         ) AS has_incoming_request,
         EXISTS (
           SELECT 1 FROM villains v
           WHERE v.user_id = $1
             AND v.target_user_id = u.id
         ) AS is_villain
       FROM users u
       WHERE u.id <> $1
         AND (u.nickname ILIKE $2 OR u.username ILIKE $2)
       ORDER BY u.nickname ASC, u.username ASC
       LIMIT 20`, claims.ID, like)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (app *app) handleFriendRequests(c *gin.Context) {
	claims := currentClaims(c)
	incoming, err := queryMaps(c.Request.Context(), app.db, `SELECT
         fr.id,
         fr.requester_id AS user_id,
         fr.created_at,
         u.username,
         u.nickname,
         u.rank,
         u.wins,
         u.losses,
         u.rating
       FROM friend_requests fr
       JOIN users u ON u.id = fr.requester_id
       WHERE fr.addressee_id = $1
         AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`, claims.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	outgoing, err := queryMaps(c.Request.Context(), app.db, `SELECT
         fr.id,
         fr.addressee_id AS user_id,
         fr.created_at,
         u.username,
         u.nickname,
         u.rank,
         u.wins,
         u.losses,
         u.rating
       FROM friend_requests fr
       JOIN users u ON u.id = fr.addressee_id
       WHERE fr.requester_id = $1
         AND fr.status = 'pending'
       ORDER BY fr.created_at DESC`, claims.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"incoming": incoming,
		"outgoing": outgoing,
	})
}

func (app *app) handleFriends(c *gin.Context) {
	claims := currentClaims(c)
	items, err := queryMaps(c.Request.Context(), app.db, `SELECT u.id, u.username, u.nickname, u.rank, u.wins, u.losses, u.rating, f.created_at
       FROM friendships f
       JOIN users u ON u.id = f.friend_id
       WHERE f.user_id = $1
       ORDER BY u.nickname ASC, u.username ASC`, claims.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (app *app) handleAddFriend(c *gin.Context) {
	claims := currentClaims(c)
	var req socialTargetRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.TargetUserID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid target user"})
		return
	}
	if req.TargetUserID == claims.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot add yourself"})
		return
	}

	targetInfo, err := app.fetchUserPublicInfo(c.Request.Context(), req.TargetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if targetInfo == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	blocked, err := app.areUsersBlocked(c.Request.Context(), claims.ID, req.TargetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if blocked {
		c.JSON(http.StatusConflict, gin.H{"error": "Cannot add this user due to villain relation"})
		return
	}

	var exists int
	err = app.db.QueryRow(c.Request.Context(), `SELECT 1
       FROM friendships
       WHERE user_id = $1
         AND friend_id = $2
       LIMIT 1`, claims.ID, req.TargetUserID).Scan(&exists)
	if err == nil {
		c.JSON(http.StatusOK, gin.H{"ok": true, "status": "already_friend"})
		return
	}
	if err != nil && !errorsIs(err, pgx.ErrNoRows) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}

	incomingRequest, err := queryMaps(c.Request.Context(), app.db, `SELECT id
       FROM friend_requests
       WHERE requester_id = $1
         AND addressee_id = $2
         AND status = 'pending'
       LIMIT 1`, req.TargetUserID, claims.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if len(incomingRequest) > 0 {
		c.JSON(http.StatusConflict, gin.H{
			"error":     "Incoming friend request already exists",
			"code":      "INCOMING_REQUEST_EXISTS",
			"requestId": incomingRequest[0]["id"],
		})
		return
	}

	outgoingRequest, err := queryMaps(c.Request.Context(), app.db, `SELECT id
       FROM friend_requests
       WHERE requester_id = $1
         AND addressee_id = $2
         AND status = 'pending'
       LIMIT 1`, claims.ID, req.TargetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if len(outgoingRequest) > 0 {
		c.JSON(http.StatusOK, gin.H{
			"ok":        true,
			"status":    "pending",
			"requestId": outgoingRequest[0]["id"],
		})
		return
	}

	createResult, err := queryOneMap(c.Request.Context(), app.db, `INSERT INTO friend_requests (requester_id, addressee_id, status, created_at, updated_at)
       VALUES ($1, $2, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (requester_id, addressee_id)
       DO UPDATE SET
           status = 'pending',
           updated_at = CURRENT_TIMESTAMP
       RETURNING id`, claims.ID, req.TargetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"ok":        true,
		"status":    "pending",
		"requestId": createResult["id"],
	})
}

func (app *app) handleAcceptFriendRequest(c *gin.Context) {
	claims := currentClaims(c)
	requestID, ok := toInt(c.Param("requestId"))
	if !ok || requestID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request id"})
		return
	}

	ctx := c.Request.Context()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	defer tx.Rollback(ctx)

	requestRow, err := queryOneMap(ctx, tx, `SELECT id, requester_id, addressee_id, status
       FROM friend_requests
       WHERE id = $1
       FOR UPDATE`, requestID)
	if err != nil {
		if errorsIs(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Friend request not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}

	addresseeID, _ := toInt(requestRow["addressee_id"])
	requesterID, _ := toInt(requestRow["requester_id"])
	if addresseeID != claims.ID {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not allowed"})
		return
	}
	if toString(requestRow["status"]) != "pending" {
		c.JSON(http.StatusConflict, gin.H{"error": "Friend request already handled"})
		return
	}

	blocked, err := app.areUsersBlocked(ctx, requesterID, addresseeID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if blocked {
		if _, err := tx.Exec(ctx, `UPDATE friend_requests
         SET status = 'rejected',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`, requestID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
			return
		}
		if err := tx.Commit(ctx); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
			return
		}
		c.JSON(http.StatusConflict, gin.H{"error": "Cannot accept due to villain relation", "code": "BLOCKED_USER"})
		return
	}

	if _, err := tx.Exec(ctx, `INSERT INTO friendships (user_id, friend_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, friend_id) DO NOTHING`, requesterID, addresseeID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if _, err := tx.Exec(ctx, `INSERT INTO friendships (user_id, friend_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, friend_id) DO NOTHING`, addresseeID, requesterID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE friend_requests
       SET status = 'accepted',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`, requestID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE friend_requests
       SET status = 'accepted',
           updated_at = CURRENT_TIMESTAMP
       WHERE requester_id = $1
         AND addressee_id = $2
         AND status = 'pending'`, addresseeID, requesterID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}

	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (app *app) handleRejectFriendRequest(c *gin.Context) {
	claims := currentClaims(c)
	requestID, ok := toInt(c.Param("requestId"))
	if !ok || requestID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request id"})
		return
	}

	tag, err := app.db.Exec(c.Request.Context(), `UPDATE friend_requests
       SET status = 'rejected',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND addressee_id = $2
         AND status = 'pending'`, requestID, claims.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if tag.RowsAffected() == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Friend request not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (app *app) handleDeleteFriend(c *gin.Context) {
	claims := currentClaims(c)
	friendID, ok := toInt(c.Param("friendId"))
	if !ok || friendID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid friend id"})
		return
	}

	ctx := c.Request.Context()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM friendships
         WHERE (user_id = $1 AND friend_id = $2)
            OR (user_id = $2 AND friend_id = $1)`, claims.ID, friendID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE friend_requests
         SET status = 'cancelled',
             updated_at = CURRENT_TIMESTAMP
         WHERE ((requester_id = $1 AND addressee_id = $2)
             OR (requester_id = $2 AND addressee_id = $1))
           AND status = 'pending'`, claims.ID, friendID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (app *app) handleVillains(c *gin.Context) {
	claims := currentClaims(c)
	items, err := queryMaps(c.Request.Context(), app.db, `SELECT u.id, u.username, u.nickname, u.rank, u.wins, u.losses, u.rating, v.created_at
       FROM villains v
       JOIN users u ON u.id = v.target_user_id
       WHERE v.user_id = $1
       ORDER BY v.created_at DESC`, claims.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (app *app) handleAddVillain(c *gin.Context) {
	claims := currentClaims(c)
	var req socialTargetRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.TargetUserID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid target user"})
		return
	}
	if req.TargetUserID == claims.ID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot villain yourself"})
		return
	}

	targetInfo, err := app.fetchUserPublicInfo(c.Request.Context(), req.TargetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if targetInfo == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	ctx := c.Request.Context()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `DELETE FROM friendships
         WHERE (user_id = $1 AND friend_id = $2)
            OR (user_id = $2 AND friend_id = $1)`, claims.ID, req.TargetUserID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if _, err := tx.Exec(ctx, `UPDATE friend_requests
         SET status = 'rejected',
             updated_at = CURRENT_TIMESTAMP
         WHERE ((requester_id = $1 AND addressee_id = $2)
             OR (requester_id = $2 AND addressee_id = $1))
           AND status = 'pending'`, claims.ID, req.TargetUserID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if _, err := tx.Exec(ctx, `INSERT INTO villains (user_id, target_user_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, target_user_id) DO NOTHING`, claims.ID, req.TargetUserID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (app *app) handleDeleteVillain(c *gin.Context) {
	claims := currentClaims(c)
	targetUserID, ok := toInt(c.Param("targetUserId"))
	if !ok || targetUserID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid target user id"})
		return
	}
	if _, err := app.db.Exec(c.Request.Context(), `DELETE FROM villains
       WHERE user_id = $1
         AND target_user_id = $2`, claims.ID, targetUserID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (app *app) handleFriendGames(c *gin.Context) {
	claims := currentClaims(c)
	friendID, ok := toInt(c.Param("friendId"))
	if !ok || friendID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid friend id"})
		return
	}

	friend, err := queryOneMap(c.Request.Context(), app.db, `SELECT id, username, nickname, rank, wins, losses, rating
       FROM users
       WHERE id = $1`, friendID)
	if err != nil {
		if errorsIs(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Friend not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}

	areFriends, err := app.areUsersFriends(c.Request.Context(), claims.ID, friendID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	if !areFriends {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a friend"})
		return
	}

	games, err := queryMaps(c.Request.Context(), app.db, `SELECT
          g.id,
          g.played_at,
          g.started_at,
          g.ended_at,
          COALESCE(g.game_mode, 'online') AS game_mode,
          g.winner_team,
          g.loser_team,
          COALESCE(g.result_type, 'unknown') AS result_type,
          COALESCE(
              g.move_count,
              CASE
                  WHEN g.move_log IS NOT NULL AND jsonb_typeof(g.move_log) = 'array'
                      THEN jsonb_array_length(g.move_log)
                  ELSE 0
              END
          ) AS move_count,
          COALESCE(
              u1.nickname,
              CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END
          ) AS winner_name,
          COALESCE(
              u2.nickname,
              CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END
          ) AS loser_name,
          CASE
              WHEN g.winner_team = 'cho'
                  THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
              ELSE COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
          END AS cho_name,
          CASE
              WHEN g.winner_team = 'han'
                  THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
              ELSE COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
          END AS han_name,
          CASE
              WHEN g.winner_id = $1 THEN 'win'
              WHEN g.loser_id = $1 THEN 'loss'
              ELSE 'draw'
          END AS my_result,
          CASE
              WHEN g.winner_id = $1 THEN g.winner_team
              WHEN g.loser_id = $1 THEN g.loser_team
              ELSE NULL
          END AS my_team,
          CASE
              WHEN g.winner_id = $1
                  THEN COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
              WHEN g.loser_id = $1
                  THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
              ELSE NULL
          END AS opponent_name
       FROM games g
       LEFT JOIN users u1 ON g.winner_id = u1.id
       LEFT JOIN users u2 ON g.loser_id = u2.id
       WHERE g.winner_id = $1 OR g.loser_id = $1
       ORDER BY g.played_at DESC
       LIMIT 50`, friendID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"friend": friend, "games": games})
}

func (app *app) handleSpendAIMatch(c *gin.Context) {
	claims := currentClaims(c)
	payload, err := spendCoinsForAIMatch(c.Request.Context(), app.db, claims.ID, aiMatchEntryCost)
	if err != nil {
		if err == errNotEnoughCoins {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	c.JSON(http.StatusOK, payload)
}

func (app *app) handleAIMove(c *gin.Context) {
	var req aiMoveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid board state or turn"})
		return
	}
	if !isValidBoardState(req.Board) || !isValidTeam(req.Turn) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid board state or turn"})
		return
	}

	board, ok := app.buildBoard(req.Board)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid board state"})
		return
	}

	fen, err := boardToJanggiFEN(board, req.Turn)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid board state"})
		return
	}

	selected := getAILevel(req.AITier)
	requestedMoveTime := clampMoveTime(selected.MoveTimeMS, app.cfg.AIMoveTimeMS)
	requestedDepth := clampDepth(selected.Depth, app.cfg.AISearchDepth)
	level := selected
	level.MoveTimeMS = requestedMoveTime
	level.Depth = requestedDepth

	timeout := calculateAIMoveTimeout(requestedMoveTime)
	ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
	defer cancel()

	aiResult, err := requestAIResult(ctx, app.client(), app.cfg.AIServiceURL, fen, level)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "Failed to request AI move"})
		return
	}

	bestMove := toString(aiResult["bestmove"])
	move := parseEngineMove(bestMove)
	if move == nil {
		c.JSON(http.StatusOK, aiMoveResponse{
			Pass:     true,
			BestMove: defaultString(bestMove, "(none)"),
		})
		return
	}
	c.JSON(http.StatusOK, aiMoveResponse{
		Pass:     false,
		BestMove: bestMove,
		Move:     move,
	})
}

func (app *app) handleSaveAIGame(c *gin.Context) {
	claims := currentClaims(c)
	var req aiGameSaveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team payload"})
		return
	}
	if !isValidTeam(req.MyTeam) || !isValidTeam(req.WinnerTeam) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid team payload"})
		return
	}

	normalizedMoveLog := normalizeMoveLog(req.MoveLog)
	normalizedAITier := clampAITier(req.AITier, defaultAITier)
	normalizedResultType := normalizeResultType(req.ResultType)
	safeChoSetup := sanitizeSetup(req.ChoSetup)
	safeHanSetup := sanitizeSetup(req.HanSetup)
	startTime := normalizeTimestamp(req.StartedAt, app.nowTime())
	endTime := normalizeTimestamp(req.EndedAt, app.nowTime())
	if endTime.Before(startTime) {
		endTime = startTime
	}

	didUserWin := req.WinnerTeam == req.MyTeam
	var winnerID any
	var loserID any
	if didUserWin {
		winnerID = claims.ID
	} else {
		loserID = claims.ID
	}

	replayPayload := map[string]any{
		"version":  2,
		"choSetup": nilIfEmpty(safeChoSetup),
		"hanSetup": nilIfEmpty(safeHanSetup),
		"moveLog":  normalizedMoveLog,
	}
	replayJSON, _ := json.Marshal(replayPayload)
	moveLogJSON, _ := json.Marshal(normalizedMoveLog)

	ctx := c.Request.Context()
	tx, err := app.db.Begin(ctx)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save AI replay"})
		return
	}
	defer tx.Rollback(ctx)

	unlockState := aiUnlockState{
		PreviousUnlockedTier: 0,
		UnlockedTier:         0,
		Unlocked:             false,
		JustUnlockedTier:     nil,
	}

	if didUserWin {
		var unlockedTier int
		if err := tx.QueryRow(ctx, `SELECT ai_unlocked_tier FROM users WHERE id = $1 FOR UPDATE`, claims.ID).Scan(&unlockedTier); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save AI replay"})
			return
		}
		unlockState = resolveAIUnlockAfterWin(unlockedTier, normalizedAITier)
		if unlockState.Unlocked {
			if _, err := tx.Exec(ctx, `UPDATE users SET ai_unlocked_tier = $2 WHERE id = $1`, claims.ID, unlockState.UnlockedTier); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save AI replay"})
				return
			}
		}
	}

	if _, err := tx.Exec(ctx, `INSERT INTO games (
          winner_id, loser_id, game_mode, winner_team, loser_team,
          moves, cho_setup, han_setup, move_log, result_type, move_count, started_at, ended_at
      ) VALUES ($1, $2, 'ai', $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)`,
		winnerID,
		loserID,
		req.WinnerTeam,
		getOpponentTeam(req.WinnerTeam),
		string(replayJSON),
		nilIfEmpty(safeChoSetup),
		nilIfEmpty(safeHanSetup),
		string(moveLogJSON),
		normalizedResultType,
		len(normalizedMoveLog),
		startTime,
		endTime,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save AI replay"})
		return
	}

	if err := tx.Commit(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save AI replay"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"ok":     true,
		"aiTier": normalizedAITier,
		"unlock": unlockState,
	})
}

func (app *app) handleRecharge(c *gin.Context) {
	claims := currentClaims(c)
	payload, err := rechargeCoins(c.Request.Context(), app.db, claims.ID, manualRechargeCoin)
	if err != nil {
		if err == errUserNotFound {
			c.Status(http.StatusNotFound)
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	c.JSON(http.StatusOK, payload)
}

func (app *app) handleDeleteMe(c *gin.Context) {
	claims := currentClaims(c)
	sessionKey := app.getSessionKey(claims.ID)
	app.state.mu.Lock()
	session := app.state.activeSessions[sessionKey]
	delete(app.state.activeSessions, sessionKey)
	app.state.mu.Unlock()

	if session != nil {
		app.terminateSessionSockets(claims.ID, session, "account_deleted")
	}
	if _, err := app.db.Exec(c.Request.Context(), `DELETE FROM users WHERE id = $1`, claims.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Server error"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Account deleted"})
}

func (app *app) handleGames(c *gin.Context) {
	claims := currentClaims(c)
	items, err := queryMaps(c.Request.Context(), app.db, `SELECT
                g.id,
                g.played_at,
                g.started_at,
                g.ended_at,
                COALESCE(g.game_mode, 'online') AS game_mode,
                g.winner_team,
                g.loser_team,
                COALESCE(g.result_type, 'unknown') AS result_type,
                COALESCE(
                    g.move_count,
                    CASE
                        WHEN g.move_log IS NOT NULL AND jsonb_typeof(g.move_log) = 'array'
                            THEN jsonb_array_length(g.move_log)
                        ELSE 0
                    END
                ) AS move_count,
                COALESCE(
                    u1.nickname,
                    CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END
                ) AS winner_name,
                COALESCE(
                    u2.nickname,
                    CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END
                ) AS loser_name,
                CASE
                    WHEN g.winner_team = 'cho'
                        THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                    ELSE COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                END AS cho_name,
                CASE
                    WHEN g.winner_team = 'han'
                        THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                    ELSE COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                END AS han_name,
                CASE
                    WHEN g.winner_id = $1 THEN 'win'
                    WHEN g.loser_id = $1 THEN 'loss'
                    ELSE 'draw'
                END AS my_result,
                CASE
                    WHEN g.winner_id = $1 THEN g.winner_team
                    WHEN g.loser_id = $1 THEN g.loser_team
                    ELSE NULL
                END AS my_team,
                CASE
                    WHEN g.winner_id = $1
                        THEN COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                    WHEN g.loser_id = $1
                        THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                    ELSE NULL
                END AS opponent_name
            FROM games g
            LEFT JOIN users u1 ON g.winner_id = u1.id
            LEFT JOIN users u2 ON g.loser_id = u2.id
            WHERE g.winner_id = $1 OR g.loser_id = $1
            ORDER BY g.played_at DESC
            LIMIT 50`, claims.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "DB Error"})
		return
	}
	c.JSON(http.StatusOK, items)
}

func (app *app) handleGameDetail(c *gin.Context) {
	claims := currentClaims(c)
	game, err := queryOneMap(c.Request.Context(), app.db, `SELECT
                g.*,
                COALESCE(
                    u1.nickname,
                    CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END
                ) AS winner_name,
                COALESCE(
                    u2.nickname,
                    CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END
                ) AS loser_name,
                CASE
                    WHEN g.winner_team = 'cho'
                        THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                    ELSE COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                END AS cho_name,
                CASE
                    WHEN g.winner_team = 'han'
                        THEN COALESCE(u1.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                    ELSE COALESCE(u2.nickname, CASE WHEN COALESCE(g.game_mode, 'online') = 'ai' THEN 'AI' END)
                END AS han_name
            FROM games g
            LEFT JOIN users u1 ON g.winner_id = u1.id
            LEFT JOIN users u2 ON g.loser_id = u2.id
            WHERE g.id = $1
              AND (
                  g.winner_id = $2
                  OR g.loser_id = $2
                  OR EXISTS (
                      SELECT 1
                      FROM friendships f
                      WHERE f.user_id = $2
                        AND (f.friend_id = g.winner_id OR f.friend_id = g.loser_id)
                  )
              )`, c.Param("id"), claims.ID)
	if err != nil {
		if errorsIs(err, pgx.ErrNoRows) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Game not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "DB Error"})
		return
	}

	backfillLegacyGameData(game)
	c.JSON(http.StatusOK, game)
}

func sanitizeSetup(value string) string {
	trimmed := stringsTrimSpace(value)
	if len(trimmed) > 50 {
		return ""
	}
	return trimmed
}

func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func defaultString(value, fallback string) string {
	if stringsTrimSpace(value) == "" {
		return fallback
	}
	return value
}

func backfillLegacyGameData(game map[string]any) {
	moveLog, moveLogOK := game["move_log"].([]any)
	if (!moveLogOK || len(moveLog) == 0) && game["moves"] != nil {
		var parsed any
		if err := json.Unmarshal([]byte(toString(game["moves"])), &parsed); err == nil {
			if parsedMap, ok := parsed.(map[string]any); ok && parsedMap["version"] == float64(2) {
				if parsedMoveLog, ok := parsedMap["moveLog"].([]any); ok {
					game["move_log"] = parsedMoveLog
					if game["cho_setup"] == nil {
						game["cho_setup"] = parsedMap["choSetup"]
					}
					if game["han_setup"] == nil {
						game["han_setup"] = parsedMap["hanSetup"]
					}
					if game["move_count"] == nil {
						game["move_count"] = len(parsedMoveLog)
					}
				}
			} else if legacyFrames, ok := anyToSlice(parsed); ok && len(legacyFrames) > 0 {
				game["move_count"] = maxInt(0, len(legacyFrames)-1)
			}
		}
	}
	if game["move_count"] == nil {
		if parsedMoveLog, ok := game["move_log"].([]any); ok {
			game["move_count"] = len(parsedMoveLog)
		} else {
			game["move_count"] = 0
		}
	}
}

func anyToSlice(value any) ([]any, bool) {
	items, ok := value.([]any)
	return items, ok
}
