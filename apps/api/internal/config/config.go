package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	AppEnv       string
	AppPort      string
	DatabaseURL  string
	JWTSecret    string
	JWTExpiresIn time.Duration
	FrontendURL  string
}

func Load() Config {
	return Config{
		AppEnv:       getEnv("APP_ENV", "development"),
		AppPort:      getEnv("APP_PORT", "8080"),
		DatabaseURL:  getEnv("DATABASE_URL", "postgres://dnsblock:dnsblock_password@localhost:5432/dnsblock?sslmode=disable"),
		JWTSecret:    getEnv("JWT_SECRET", "change_me"),
		JWTExpiresIn: parseDuration(getEnv("JWT_EXPIRES_IN", "24h"), 24*time.Hour),
		FrontendURL:  getEnv("FRONTEND_URL", "http://localhost:3000"),
	}
}

func getEnv(key string, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func parseDuration(value string, fallback time.Duration) time.Duration {
	d, err := time.ParseDuration(value)
	if err == nil {
		return d
	}
	if hours, convErr := strconv.Atoi(value); convErr == nil {
		return time.Duration(hours) * time.Hour
	}
	return fallback
}
