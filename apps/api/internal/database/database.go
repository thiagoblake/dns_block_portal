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

	// Tabelas principais via GORM AutoMigrate (dev/docker).
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

	// Lote de revogação: schema via SQL idempotente (evita conflito 42P07 quando
	// a migração 006 já rodou manualmente e o GORM tentaria CREATE TABLE de novo).
	if err := ensureRevocationBatchSchema(db); err != nil {
		return nil, err
	}

	if err := seedAdmin(db); err != nil {
		return nil, err
	}

	return db, nil
}

func ensureRevocationBatchSchema(db *gorm.DB) error {
	var exists bool
	if err := db.Raw(`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = 'revocation_batches'
		)`).Scan(&exists).Error; err != nil {
		return err
	}
	if exists {
		return nil
	}

	stmts := []string{
		`CREATE TABLE IF NOT EXISTS revocation_batches (
			id UUID PRIMARY KEY,
			title TEXT NOT NULL,
			source_type TEXT NOT NULL,
			process_number TEXT,
			description TEXT,
			reason TEXT NOT NULL DEFAULT '',
			status TEXT NOT NULL,
			reject_reason TEXT,
			created_by UUID REFERENCES users(id),
			approved_by UUID REFERENCES users(id),
			created_at TIMESTAMP DEFAULT now(),
			updated_at TIMESTAMP DEFAULT now(),
			submitted_at TIMESTAMP,
			approved_at TIMESTAMP,
			applied_at TIMESTAMP
		)`,
		`CREATE INDEX IF NOT EXISTS idx_revocation_batches_status ON revocation_batches(status)`,
		`CREATE TABLE IF NOT EXISTS revocation_batch_items (
			id UUID PRIMARY KEY,
			revocation_batch_id UUID NOT NULL REFERENCES revocation_batches(id) ON DELETE CASCADE,
			original_value TEXT NOT NULL,
			normalized_domain TEXT NOT NULL DEFAULT '',
			match_status TEXT NOT NULL,
			validation_error TEXT,
			blocked_domain_id UUID,
			block_list_id UUID,
			block_list_title TEXT,
			created_at TIMESTAMP DEFAULT now()
		)`,
		`CREATE INDEX IF NOT EXISTS idx_revocation_batch_items_batch ON revocation_batch_items(revocation_batch_id)`,
		`CREATE INDEX IF NOT EXISTS idx_revocation_batch_items_match ON revocation_batch_items(match_status)`,
		`ALTER TABLE revocation_requests ADD COLUMN IF NOT EXISTS revocation_batch_id UUID REFERENCES revocation_batches(id)`,
	}
	for _, stmt := range stmts {
		if err := db.Exec(stmt).Error; err != nil {
			return err
		}
	}
	return nil
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
