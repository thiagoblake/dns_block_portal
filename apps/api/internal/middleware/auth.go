package middleware

import (
	"net/http"
	"strings"

	"dns-block-portal/api/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type AuthClaims struct {
	UserID   string      `json:"user_id"`
	Role     models.Role `json:"role"`
	IsActive bool        `json:"is_active"`
	jwt.RegisteredClaims
}

func JWTAuth(secret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		header := c.GetHeader("Authorization")
		if header == "" || !strings.HasPrefix(header, "Bearer ") {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing bearer token"})
			c.Abort()
			return
		}

		tokenString := strings.TrimPrefix(header, "Bearer ")
		claims := &AuthClaims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
			return []byte(secret), nil
		})
		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
			c.Abort()
			return
		}

		userID, err := uuid.Parse(claims.UserID)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user in token"})
			c.Abort()
			return
		}
		if !claims.IsActive {
			c.JSON(http.StatusForbidden, gin.H{"error": "user inactive"})
			c.Abort()
			return
		}

		c.Set("userID", userID)
		c.Set("role", claims.Role)
		c.Next()
	}
}

func RequireRoles(allowed ...models.Role) gin.HandlerFunc {
	return func(c *gin.Context) {
		roleValue, ok := c.Get("role")
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "missing role"})
			c.Abort()
			return
		}
		role, _ := roleValue.(models.Role)
		for _, allowedRole := range allowed {
			if role == allowedRole {
				c.Next()
				return
			}
		}
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		c.Abort()
	}
}
