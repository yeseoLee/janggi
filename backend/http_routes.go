package main

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func (app *app) registerRoutes() {
	app.api.POST("/api/auth/register", app.handleRegister)
	app.api.POST("/api/auth/login", app.handleLogin)

	authorized := app.api.Group("/api")
	authorized.Use(app.authenticateToken())
	authorized.GET("/user/me", app.handleUserMe)
	authorized.GET("/social/users/search", app.handleSocialUserSearch)
	authorized.GET("/social/friend-requests", app.handleFriendRequests)
	authorized.GET("/social/friends", app.handleFriends)
	authorized.POST("/social/friends", app.handleAddFriend)
	authorized.POST("/social/friend-requests/:requestId/accept", app.handleAcceptFriendRequest)
	authorized.POST("/social/friend-requests/:requestId/reject", app.handleRejectFriendRequest)
	authorized.DELETE("/social/friends/:friendId", app.handleDeleteFriend)
	authorized.GET("/social/villains", app.handleVillains)
	authorized.POST("/social/villains", app.handleAddVillain)
	authorized.DELETE("/social/villains/:targetUserId", app.handleDeleteVillain)
	authorized.GET("/social/friends/:friendId/games", app.handleFriendGames)
	authorized.POST("/coins/spend-ai-match", app.handleSpendAIMatch)
	authorized.POST("/ai/move", app.handleAIMove)
	authorized.POST("/games/ai", app.handleSaveAIGame)
	authorized.POST("/coins/recharge", app.handleRecharge)
	authorized.DELETE("/auth/me", app.handleDeleteMe)
	authorized.GET("/games", app.handleGames)
	authorized.GET("/games/:id", app.handleGameDetail)

	app.api.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": "API route not found"})
	})
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
		return uuid.NewString()
	}
	return app.newID()
}

func (app *app) client() httpDoer {
	if app.httpClient == nil {
		return http.DefaultClient
	}
	return app.httpClient
}
