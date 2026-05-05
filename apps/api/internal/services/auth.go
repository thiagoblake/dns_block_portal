package services

import (
	"time"

	"dns-block-portal/api/internal/middleware"
	"dns-block-portal/api/internal/models"

	"github.com/golang-jwt/jwt/v5"
)

func BuildToken(user models.User, secret string, ttl time.Duration) (string, error) {
	claims := middleware.AuthClaims{
		UserID:   user.ID.String(),
		Role:     user.Role,
		IsActive: user.IsActive,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID.String(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}
