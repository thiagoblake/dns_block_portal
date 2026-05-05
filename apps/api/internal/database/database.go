package database

import (
	"log"

	"dns-block-portal/api/internal/models"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func Connect(dsn string) (*gorm.DB, error) {
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, err
	}

	if err := db.AutoMigrate(
		&models.User{},
		&models.BlockList{},
		&models.BlockedDomain{},
		&models.RevocationRequest{},
		&models.UploadedFile{},
		&models.ApplyRun{},
		&models.AuditLog{},
	); err != nil {
		return nil, err
	}

	if err := seedAdmin(db); err != nil {
		return nil, err
	}

	return db, nil
}

func seedAdmin(db *gorm.DB) error {
	var count int64
	if err := db.Model(&models.User{}).Where("email = ?", "admin@local.test").Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	admin := models.User{
		ID:           uuid.New(),
		Name:         "Administrador Inicial",
		Email:        "admin@local.test",
		PasswordHash: string(hash),
		Role:         models.RoleAdmin,
		IsActive:     true,
	}

	if err := db.Create(&admin).Error; err != nil {
		return err
	}

	log.Println("seed: admin user created (admin@local.test)")
	return nil
}
