package services

import (
	"encoding/json"

	"dns-block-portal/api/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

func Audit(db *gorm.DB, c *gin.Context, userID *uuid.UUID, action, entityType string, entityID *uuid.UUID, oldValue, newValue interface{}) {
	oldJSON, _ := toJSON(oldValue)
	newJSON, _ := toJSON(newValue)

	entry := models.AuditLog{
		ID:         uuid.New(),
		UserID:     userID,
		Action:     action,
		EntityType: entityType,
		EntityID:   entityID,
		OldValue:   oldJSON,
		NewValue:   newJSON,
		IPAddress:  c.ClientIP(),
		UserAgent:  c.GetHeader("User-Agent"),
	}
	_ = db.Create(&entry).Error
}

func toJSON(value interface{}) (datatypes.JSON, error) {
	if value == nil {
		return datatypes.JSON([]byte("null")), nil
	}
	bytes, err := json.Marshal(value)
	if err != nil {
		return datatypes.JSON([]byte("null")), err
	}
	return datatypes.JSON(bytes), nil
}
