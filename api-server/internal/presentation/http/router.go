package httpapi

import (
	"net/http"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/yeseolee/janggi/api-server/internal/application"
)

func NewRouter(app *application.Service) *gin.Engine {
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"*"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Authorization", "Content-Type"},
		AllowCredentials: false,
		MaxAge:           12 * time.Hour,
	}))

	router.POST("/api/auth/register", app.HandleRegister)
	router.POST("/api/auth/login", app.HandleLogin)

	authorized := router.Group("/api")
	authorized.Use(app.AuthenticateToken())
	authorized.GET("/user/me", app.HandleUserMe)
	authorized.GET("/social/users/search", app.HandleSocialUserSearch)
	authorized.GET("/social/friend-requests", app.HandleFriendRequests)
	authorized.GET("/social/friends", app.HandleFriends)
	authorized.POST("/social/friends", app.HandleAddFriend)
	authorized.POST("/social/friend-requests/:requestId/accept", app.HandleAcceptFriendRequest)
	authorized.POST("/social/friend-requests/:requestId/reject", app.HandleRejectFriendRequest)
	authorized.DELETE("/social/friends/:friendId", app.HandleDeleteFriend)
	authorized.GET("/social/villains", app.HandleVillains)
	authorized.POST("/social/villains", app.HandleAddVillain)
	authorized.DELETE("/social/villains/:targetUserId", app.HandleDeleteVillain)
	authorized.GET("/social/friends/:friendId/games", app.HandleFriendGames)
	authorized.POST("/coins/spend-ai-match", app.HandleSpendAIMatch)
	authorized.POST("/ai/move", app.HandleAIMove)
	authorized.POST("/games/ai", app.HandleSaveAIGame)
	authorized.POST("/coins/recharge", app.HandleRecharge)
	authorized.DELETE("/auth/me", app.HandleDeleteMe)
	authorized.GET("/games", app.HandleGames)
	authorized.GET("/games/:id", app.HandleGameDetail)

	router.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": "API route not found"})
	})
	return router
}
