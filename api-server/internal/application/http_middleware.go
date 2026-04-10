package application

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func (app *app) AuthenticateToken() gin.HandlerFunc {
	return func(c *gin.Context) {
		tokenString := extractBearerToken(c.GetHeader("Authorization"))
		if tokenString == "" {
			c.Status(http.StatusUnauthorized)
			c.Abort()
			return
		}

		claims := &authClaims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
			return []byte(app.cfg.JWTSecret), nil
		})
		if err != nil || !token.Valid {
			c.Status(http.StatusForbidden)
			c.Abort()
			return
		}
		if claims.ID == 0 || claims.SID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid session", "code": "SESSION_INVALID"})
			c.Abort()
			return
		}
		if !app.isSessionActive(claims.ID, claims.SID) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Duplicate login detected", "code": "DUPLICATE_LOGIN"})
			c.Abort()
			return
		}

		c.Set("userClaims", claims)
		c.Next()
	}
}

func currentClaims(c *gin.Context) *authClaims {
	value, _ := c.Get("userClaims")
	claims, _ := value.(*authClaims)
	return claims
}
