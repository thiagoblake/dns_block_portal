package main

import (
	"bytes"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type BlockList struct {
	ID         uuid.UUID  `gorm:"type:uuid;primaryKey"`
	Title      string
	DNSAction  string
	RedirectIP string
	Status     string
	ExpiresAt  *time.Time
	AppliedAt  *time.Time
}

type BlockedDomain struct {
	ID               uuid.UUID `gorm:"type:uuid;primaryKey"`
	BlockListID      uuid.UUID `gorm:"type:uuid"`
	NormalizedDomain string
	IsValid          bool
	RevokedAt        *time.Time
}

type ApplyRun struct {
	ID                uuid.UUID  `gorm:"type:uuid;primaryKey"`
	Status            string
	StartedAt         time.Time
	FinishedAt        *time.Time
	Output            string
	ErrorMessage      string
	GeneratedFilePath string
	BackupFilePath    string
	CreatedAt         time.Time
}

func main() {
	dsn := env("DATABASE_URL", "postgres://dnsblock:dnsblock_password@localhost:5432/dnsblock?sslmode=disable")
	interval := envInt("WORKER_INTERVAL_SECONDS", 20)
	mock := strings.EqualFold(env("UNBOUND_MOCK", "true"), "true")

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		log.Fatalf("worker db connect failed: %v", err)
	}

	log.Printf("worker started (interval=%ds, mock=%v)", interval, mock)
	ticker := time.NewTicker(time.Duration(interval) * time.Second)
	defer ticker.Stop()

	for {
		if err := process(db, mock); err != nil {
			log.Printf("process error: %v", err)
		}
		<-ticker.C
	}
}

func process(db *gorm.DB, mock bool) error {
	now := time.Now()
	expireTx := db.Model(&BlockList{}).
		Where("expires_at IS NOT NULL AND expires_at <= ? AND status IN ?", now, []string{"APPROVED", "APPLIED"}).
		Updates(map[string]interface{}{"status": "EXPIRED"})
	if expireTx.Error != nil {
		return expireTx.Error
	}
	if expireTx.RowsAffected > 0 {
		run := ApplyRun{
			ID:        uuid.New(),
			Status:    "REQUESTED",
			StartedAt: time.Now(),
			Output:    "lista(s) expirada(s) — regenerar DNS sem dominios expirados",
		}
		if err := db.Create(&run).Error; err != nil {
			return err
		}
	}

	var requestedRun ApplyRun
	if err := db.Where("status = ?", "REQUESTED").Order("created_at asc").First(&requestedRun).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}

	// Sempre regenerar o arquivo a partir do estado atual do banco (listas APPROVED/APPLIED e
	// domínios com revoked_at IS NULL). Não exigir listas APPROVED: após revogação unitária a
	// lista segue APPLIED e só precisamos reemitir o .conf sem aquele domínio.

	started := time.Now()
	requestedRun.Status = "RUNNING"
	requestedRun.StartedAt = started
	requestedRun.Output = "worker apply started"
	_ = db.Save(&requestedRun).Error

	generatedFile, backupFile, output, applyErr := renderAndApply(db, mock)
	finished := time.Now()
	requestedRun.FinishedAt = &finished
	requestedRun.GeneratedFilePath = generatedFile
	requestedRun.BackupFilePath = backupFile
	requestedRun.Output = output
	if applyErr != nil {
		requestedRun.Status = "FAILED"
		requestedRun.ErrorMessage = applyErr.Error()
		_ = db.Save(&requestedRun).Error
		_ = db.Model(&BlockList{}).Where("status = ?", "APPROVED").Update("status", "FAILED").Error
		return applyErr
	}
	requestedRun.Status = "SUCCESS"
	_ = db.Save(&requestedRun).Error

	now = time.Now()
	_ = db.Model(&BlockList{}).Where("status = ?", "APPROVED").Updates(map[string]interface{}{
		"status":     "APPLIED",
		"applied_at": &now,
	}).Error
	return nil
}

func renderAndApply(db *gorm.DB, mock bool) (string, string, string, error) {
	generatedDir := env("UNBOUND_GENERATED_DIR", "/etc/unbound/blocklists/generated")
	currentFile := env("UNBOUND_CURRENT_FILE", "dns-block-portal.conf")
	configPath := env("UNBOUND_CONFIG_PATH", "/etc/unbound/unbound.conf")
	checkconfBin := env("UNBOUND_CHECKCONF_BIN", "/usr/sbin/unbound-checkconf")
	controlBin := env("UNBOUND_CONTROL_BIN", "/usr/sbin/unbound-control")

	if err := os.MkdirAll(generatedDir, 0o755); err != nil {
		return "", "", "", err
	}

	var lists []BlockList
	if err := db.Where("status IN ?", []string{"APPROVED", "APPLIED"}).Find(&lists).Error; err != nil {
		return "", "", "", err
	}

	var builder strings.Builder
	builder.WriteString("# Arquivo gerado automaticamente pelo DNS Block Portal\n")
	builder.WriteString("# Nao editar manualmente\n")
	builder.WriteString("# Gerado em: " + time.Now().Format("2006-01-02 15:04:05") + "\n\n")

	for _, list := range lists {
		if list.ExpiresAt != nil && list.ExpiresAt.Before(time.Now()) {
			continue
		}
		var domains []BlockedDomain
		if err := db.Where("block_list_id = ? AND is_valid = ? AND revoked_at IS NULL", list.ID, true).Find(&domains).Error; err != nil {
			return "", "", "", err
		}
		for _, domain := range domains {
			switch list.DNSAction {
			case "ALWAYS_NXDOMAIN":
				builder.WriteString(fmt.Sprintf("local-zone: \"%s\" always_nxdomain\n", domain.NormalizedDomain))
			case "ALWAYS_NULL":
				builder.WriteString(fmt.Sprintf("local-zone: \"%s\" always_null\n", domain.NormalizedDomain))
			case "REFUSE":
				builder.WriteString(fmt.Sprintf("local-zone: \"%s\" refuse\n", domain.NormalizedDomain))
			case "REDIRECT":
				builder.WriteString(fmt.Sprintf("local-zone: \"%s\" redirect\n", domain.NormalizedDomain))
				builder.WriteString(fmt.Sprintf("local-data: \"%s A %s\"\n", domain.NormalizedDomain, list.RedirectIP))
			}
		}
	}

	tmpPath := filepath.Join(generatedDir, "dns-block-portal.tmp")
	currentPath := filepath.Join(generatedDir, currentFile)
	backupPath := filepath.Join(generatedDir, "dns-block-portal-"+time.Now().Format("20060102-150405")+".conf")

	if err := writeConfigFile(tmpPath, []byte(builder.String())); err != nil {
		return "", "", "", err
	}

	hasCurrent := false
	if _, err := os.Stat(currentPath); err == nil {
		hasCurrent = true
		if err := copyFile(currentPath, backupPath); err != nil {
			return "", "", "", err
		}
	}

	if mock {
		if err := os.Rename(tmpPath, currentPath); err != nil {
			return "", "", "", err
		}
		return currentPath, backupPath, "mock mode: validate/reload simulated", nil
	}

	if err := os.Rename(tmpPath, currentPath); err != nil {
		return "", "", "", err
	}

	check := exec.Command(checkconfBin, configPath)
	checkOut, err := check.CombinedOutput()
	if err != nil {
		if hasCurrent {
			_ = copyFile(backupPath, currentPath)
		} else {
			_ = os.Remove(currentPath)
		}
		return "", backupPath, string(checkOut), fmt.Errorf("unbound-checkconf failed: %w", err)
	}

	reload := exec.Command(controlBin, "reload")
	reloadOut, err := reload.CombinedOutput()
	if err != nil {
		return currentPath, backupPath, string(reloadOut), fmt.Errorf("unbound-control reload failed: %w", err)
	}
	return currentPath, backupPath, string(reloadOut), nil
}

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

func stripUTF8BOM(content []byte) []byte {
	return bytes.TrimPrefix(content, utf8BOM)
}

func writeConfigFile(path string, content []byte) error {
	content = stripUTF8BOM(content)
	if err := os.WriteFile(path, content, 0o644); err != nil {
		return err
	}
	written, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if bytes.HasPrefix(written, utf8BOM) {
		return fmt.Errorf("config file contains UTF-8 BOM after write: %s", path)
	}
	return nil
}

func copyFile(src, dst string) error {
	content, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return writeConfigFile(dst, content)
}

func env(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func envInt(key string, fallback int) int {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}
