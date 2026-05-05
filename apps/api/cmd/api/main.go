package main

import (
	"log"
	"os"
	"strings"

	"dns-block-portal/api/internal/config"
	"dns-block-portal/api/internal/database"
	"dns-block-portal/api/internal/handlers"
	httpx "dns-block-portal/api/internal/http"
)

func main() {
	cfg := config.Load()

	db, err := database.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database connect failed: %v", err)
	}

	unboundMock := strings.EqualFold(os.Getenv("UNBOUND_MOCK"), "true")
	handler := handlers.New(db, cfg.JWTSecret, cfg.JWTExpiresIn, unboundMock)
	router := httpx.NewRouter(handler, cfg.FrontendURL, cfg.JWTSecret)

	log.Printf("api listening on :%s", cfg.AppPort)
	if err := router.Run(":" + cfg.AppPort); err != nil {
		log.Fatal(err)
	}
}
