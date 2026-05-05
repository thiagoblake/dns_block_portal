package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
)

type Role string

const (
	RoleAdmin    Role = "ADMIN"
	RoleOperator Role = "OPERADOR"
	RoleAuditor  Role = "AUDITOR"
)

type BlockListStatus string

const (
	StatusDraft           BlockListStatus = "DRAFT"
	StatusPendingApproval BlockListStatus = "PENDING_APPROVAL"
	StatusApproved        BlockListStatus = "APPROVED"
	StatusApplied         BlockListStatus = "APPLIED"
	StatusRevoked         BlockListStatus = "REVOKED"
	StatusExpired         BlockListStatus = "EXPIRED"
	StatusFailed          BlockListStatus = "FAILED"
)

type DNSAction string

const (
	ActionAlwaysNXDomain DNSAction = "ALWAYS_NXDOMAIN"
	ActionAlwaysNull     DNSAction = "ALWAYS_NULL"
	ActionRefuse         DNSAction = "REFUSE"
	ActionRedirect       DNSAction = "REDIRECT"
)

type User struct {
	ID           uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	Name         string    `json:"name"`
	Email        string    `gorm:"uniqueIndex" json:"email"`
	PasswordHash string    `json:"-"`
	Role         Role      `json:"role"`
	IsActive     bool      `gorm:"default:true" json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type BlockList struct {
	ID            uuid.UUID       `gorm:"type:uuid;primaryKey" json:"id"`
	Title         string          `json:"title"`
	SourceType    string          `json:"source_type"`
	ProcessNumber string          `json:"process_number"`
	Description   string          `json:"description"`
	DNSAction     DNSAction       `json:"dns_action"`
	RedirectIP    string          `json:"redirect_ip"`
	Status        BlockListStatus `json:"status"`
	CreatedBy     uuid.UUID       `gorm:"type:uuid" json:"created_by"`
	ApprovedBy    *uuid.UUID      `gorm:"type:uuid" json:"approved_by"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
	SubmittedAt   *time.Time      `json:"submitted_at"`
	ApprovedAt    *time.Time      `json:"approved_at"`
	AppliedAt     *time.Time      `json:"applied_at"`
	RevokedAt     *time.Time      `json:"revoked_at"`
	ExpiresAt     *time.Time      `json:"expires_at"`
	RevokeReason  string          `json:"revoke_reason"`
}

type BlockedDomain struct {
	ID               uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	BlockListID      uuid.UUID  `gorm:"type:uuid;index" json:"block_list_id"`
	OriginalValue    string     `json:"original_value"`
	NormalizedDomain string    `gorm:"index" json:"normalized_domain"`
	IsValid          bool       `gorm:"default:true" json:"is_valid"`
	ValidationError  string     `json:"validation_error"`
	PreexistingNote  string     `gorm:"type:text;default:''" json:"preexisting_note,omitempty"`
	RevokedAt        *time.Time `json:"revoked_at"`
	CreatedAt        time.Time  `json:"created_at"`
}

type RevocationKind string

const (
	RevocationKindList   RevocationKind = "LIST"
	RevocationKindDomain RevocationKind = "DOMAIN"
)

type RevocationRequestStatus string

const (
	RevocationPendingApproval RevocationRequestStatus = "PENDING_APPROVAL"
	RevocationApproved        RevocationRequestStatus = "APPROVED"
	RevocationRejected        RevocationRequestStatus = "REJECTED"
)

// RevocationRequest solicitação de revogação (lista inteira ou domínio unitário), com aprovação.
type RevocationRequest struct {
	ID              uuid.UUID               `gorm:"type:uuid;primaryKey" json:"id"`
	Kind            RevocationKind          `json:"kind"`
	BlockListID     uuid.UUID               `gorm:"type:uuid;index" json:"block_list_id"`
	BlockedDomainID *uuid.UUID              `gorm:"type:uuid;index" json:"blocked_domain_id"`
	Status          RevocationRequestStatus `gorm:"index" json:"status"`
	Reason          string                  `json:"reason"`
	RejectReason    string                  `json:"reject_reason"`
	RequestedBy     uuid.UUID               `gorm:"type:uuid" json:"requested_by"`
	ApprovedBy      *uuid.UUID              `gorm:"type:uuid" json:"approved_by"`
	CreatedAt       time.Time               `json:"created_at"`
	UpdatedAt       time.Time               `json:"updated_at"`
	ApprovedAt      *time.Time              `json:"approved_at"`
}

type UploadedFile struct {
	ID               uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	BlockListID      uuid.UUID `gorm:"type:uuid;index" json:"block_list_id"`
	OriginalFilename string    `json:"original_filename"`
	StoredFilename   string    `json:"stored_filename"`
	MimeType         string    `json:"mime_type"`
	SizeBytes        int64     `json:"size_bytes"`
	Sha256Hash       string    `json:"sha256_hash"`
	CreatedBy        uuid.UUID `gorm:"type:uuid" json:"created_by"`
	CreatedAt        time.Time `json:"created_at"`
}

type ApplyRun struct {
	ID                uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	Status            string     `json:"status"`
	StartedAt         time.Time  `json:"started_at"`
	FinishedAt        *time.Time `json:"finished_at"`
	TriggeredBy       *uuid.UUID `gorm:"type:uuid" json:"triggered_by"`
	Output            string     `json:"output"`
	ErrorMessage      string     `json:"error_message"`
	GeneratedFilePath string     `json:"generated_file_path"`
	BackupFilePath    string     `json:"backup_file_path"`
	CreatedAt         time.Time  `json:"created_at"`
}

type AuditLog struct {
	ID         uuid.UUID      `gorm:"type:uuid;primaryKey" json:"id"`
	UserID     *uuid.UUID     `gorm:"type:uuid;index" json:"user_id"`
	Action     string         `json:"action"`
	EntityType string         `json:"entity_type"`
	EntityID   *uuid.UUID     `gorm:"type:uuid" json:"entity_id"`
	OldValue   datatypes.JSON `gorm:"type:jsonb" json:"old_value"`
	NewValue   datatypes.JSON `gorm:"type:jsonb" json:"new_value"`
	IPAddress  string         `json:"ip_address"`
	UserAgent  string         `json:"user_agent"`
	CreatedAt  time.Time      `gorm:"index" json:"created_at"`
}
