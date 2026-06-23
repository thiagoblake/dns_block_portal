package handlers

import (
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"dns-block-portal/api/internal/models"
	"dns-block-portal/api/internal/services"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type Handler struct {
	DB          *gorm.DB
	JWTSecret   string
	JWTExpires  time.Duration
	UnboundMock bool
}

func New(db *gorm.DB, secret string, expires time.Duration, unboundMock bool) *Handler {
	return &Handler{
		DB:          db,
		JWTSecret:   secret,
		JWTExpires:  expires,
		UnboundMock: unboundMock,
	}
}

func userContext(c *gin.Context) (*uuid.UUID, models.Role) {
	uidValue, ok := c.Get("userID")
	if !ok {
		return nil, ""
	}
	uid := uidValue.(uuid.UUID)
	roleVal, _ := c.Get("role")
	role, _ := roleVal.(models.Role)
	return &uid, role
}

func (h *Handler) Login(c *gin.Context) {
	var req struct {
		Email    string `json:"email" binding:"required,email"`
		Password string `json:"password" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user models.User
	if err := h.DB.Where("email = ?", strings.ToLower(strings.TrimSpace(req.Email))).First(&user).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}
	if !user.IsActive {
		c.JSON(http.StatusForbidden, gin.H{"error": "inactive user"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	token, err := services.BuildToken(user, h.JWTSecret, h.JWTExpires)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "token generation failed"})
		return
	}

	uid := user.ID
	services.Audit(h.DB, c, &uid, "LOGIN", "auth", nil, nil, gin.H{"email": user.Email})
	c.JSON(http.StatusOK, gin.H{
		"token": token,
		"user":  user,
	})
}

func (h *Handler) Me(c *gin.Context) {
	uid, _ := userContext(c)
	var user models.User
	if err := h.DB.First(&user, "id = ?", uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, user)
}

func (h *Handler) Logout(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"message": "logged out"})
}

func (h *Handler) ListUsers(c *gin.Context) {
	q := h.DB.Model(&models.User{})
	if role := strings.TrimSpace(c.Query("role")); role != "" {
		q = q.Where("role = ?", role)
	}
	if ia := strings.TrimSpace(c.Query("is_active")); ia != "" {
		switch ia {
		case "true":
			q = q.Where("is_active = ?", true)
		case "false":
			q = q.Where("is_active = ?", false)
		}
	}
	if search := strings.TrimSpace(c.Query("q")); search != "" {
		like := "%" + search + "%"
		q = q.Where("(name ILIKE ? OR email ILIKE ?)", like, like)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	page, perPage, offset := listPaginationOrDefault(c)
	var users []models.User
	if err := q.Order("created_at desc").Limit(perPage).Offset(offset).Find(&users).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	totalPages := int((total + int64(perPage) - 1) / int64(perPage))
	if totalPages < 1 {
		totalPages = 1
	}
	c.JSON(http.StatusOK, gin.H{
		"items":       users,
		"total":       total,
		"page":        page,
		"per_page":    perPage,
		"total_pages": totalPages,
	})
}

func (h *Handler) CreateUser(c *gin.Context) {
	actor, _ := userContext(c)
	var req struct {
		Name     string      `json:"name" binding:"required"`
		Email    string      `json:"email" binding:"required,email"`
		Password string      `json:"password" binding:"required,min=6"`
		Role     models.Role `json:"role" binding:"required"`
		IsActive *bool       `json:"is_active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "password hash failed"})
		return
	}
	active := true
	if req.IsActive != nil {
		active = *req.IsActive
	}
	user := models.User{
		ID:           uuid.New(),
		Name:         req.Name,
		Email:        strings.ToLower(strings.TrimSpace(req.Email)),
		PasswordHash: string(hash),
		Role:         req.Role,
		IsActive:     active,
	}
	if err := h.DB.Create(&user).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "USER_CREATED", "users", &user.ID, nil, user)
	c.JSON(http.StatusCreated, user)
}

func (h *Handler) GetUser(c *gin.Context) {
	var user models.User
	if err := h.DB.First(&user, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	c.JSON(http.StatusOK, user)
}

func (h *Handler) UpdateUser(c *gin.Context) {
	actor, _ := userContext(c)
	var user models.User
	if err := h.DB.First(&user, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	old := user
	var req struct {
		Name  string      `json:"name"`
		Email string      `json:"email"`
		Role  models.Role `json:"role"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Name != "" {
		user.Name = req.Name
	}
	if req.Email != "" {
		user.Email = strings.ToLower(strings.TrimSpace(req.Email))
	}
	if req.Role != "" {
		user.Role = req.Role
	}
	if err := h.DB.Save(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "USER_UPDATED", "users", &user.ID, old, user)
	c.JSON(http.StatusOK, user)
}

func (h *Handler) UpdateUserStatus(c *gin.Context) {
	actor, _ := userContext(c)
	var user models.User
	if err := h.DB.First(&user, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	old := user
	var req struct {
		IsActive bool `json:"is_active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	user.IsActive = req.IsActive
	if err := h.DB.Save(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "USER_STATUS_UPDATED", "users", &user.ID, old, user)
	c.JSON(http.StatusOK, user)
}

func (h *Handler) UpdateUserPassword(c *gin.Context) {
	actor, _ := userContext(c)
	var user models.User
	if err := h.DB.First(&user, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}
	var req struct {
		Password string `json:"password" binding:"required,min=6"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	user.PasswordHash = string(hash)
	if err := h.DB.Save(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "USER_PASSWORD_UPDATED", "users", &user.ID, nil, gin.H{"changed": true})
	c.JSON(http.StatusOK, gin.H{"message": "password updated"})
}

func (h *Handler) ListBlockLists(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "10"))
	if page < 1 {
		page = 1
	}
	switch perPage {
	case 10, 20, 50, 100:
	default:
		perPage = 10
	}

	q := h.DB.Model(&models.BlockList{})
	if st := strings.TrimSpace(c.Query("status")); st != "" {
		q = q.Where("status = ?", st)
	}
	if st := strings.TrimSpace(c.Query("source_type")); st != "" {
		q = q.Where("source_type = ?", st)
	}
	if da := strings.TrimSpace(c.Query("dns_action")); da != "" {
		q = q.Where("dns_action = ?", da)
	}
	if pn := strings.TrimSpace(c.Query("process_number")); pn != "" {
		q = q.Where("process_number ILIKE ?", "%"+pn+"%")
	}
	if search := strings.TrimSpace(c.Query("q")); search != "" {
		like := "%" + search + "%"
		q = q.Where("(title ILIKE ? OR description ILIKE ? OR process_number ILIKE ?)", like, like, like)
	}
	if dom := strings.TrimSpace(c.Query("domain")); dom != "" {
		normalized, verr := services.NormalizeDomain(dom)
		if verr != "" {
			c.JSON(http.StatusOK, gin.H{
				"items":       []models.BlockList{},
				"total":       0,
				"page":        page,
				"per_page":    perPage,
				"total_pages": 1,
				"domain_hint": "Domínio inválido para filtro: " + verr,
			})
			return
		}
		sub := h.DB.Model(&models.BlockedDomain{}).
			Select("block_list_id").
			Where("normalized_domain = ? AND revoked_at IS NULL", normalized)
		q = q.Where("id IN (?)", sub)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	offset := (page - 1) * perPage
	var lists []models.BlockList
	if err := q.Order("created_at desc").Limit(perPage).Offset(offset).Find(&lists).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	totalPages := int((total + int64(perPage) - 1) / int64(perPage))
	if totalPages < 1 {
		totalPages = 1
	}

	c.JSON(http.StatusOK, gin.H{
		"items":       lists,
		"total":       total,
		"page":        page,
		"per_page":    perPage,
		"total_pages": totalPages,
	})
}

func (h *Handler) CreateBlockList(c *gin.Context) {
	actor, _ := userContext(c)
	var req struct {
		Title         string            `json:"title" binding:"required"`
		SourceType    string            `json:"source_type" binding:"required"`
		ProcessNumber string            `json:"process_number"`
		Description   string            `json:"description"`
		DNSAction     models.DNSAction  `json:"dns_action" binding:"required"`
		RedirectIP    string            `json:"redirect_ip"`
		ExpiresAt     *time.Time        `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.DNSAction == models.ActionRedirect && net.ParseIP(req.RedirectIP) == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "redirect_ip must be valid IPv4/IPv6"})
		return
	}
	list := models.BlockList{
		ID:            uuid.New(),
		Title:         req.Title,
		SourceType:    req.SourceType,
		ProcessNumber: req.ProcessNumber,
		Description:   req.Description,
		DNSAction:     req.DNSAction,
		RedirectIP:    req.RedirectIP,
		Status:        models.StatusDraft,
		CreatedBy:     *actor,
		ExpiresAt:     req.ExpiresAt,
	}
	if err := h.DB.Create(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "BLOCK_LIST_CREATED", "block_lists", &list.ID, nil, list)
	c.JSON(http.StatusCreated, list)
}

func (h *Handler) GetBlockList(c *gin.Context) {
	var list models.BlockList
	if err := h.DB.First(&list, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "block list not found"})
		return
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handler) UpdateBlockList(c *gin.Context) {
	actor, _ := userContext(c)
	var list models.BlockList
	if err := h.DB.First(&list, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "block list not found"})
		return
	}
	old := list
	var req struct {
		Title         string           `json:"title"`
		SourceType    string           `json:"source_type"`
		ProcessNumber string           `json:"process_number"`
		Description   string           `json:"description"`
		DNSAction     models.DNSAction `json:"dns_action"`
		RedirectIP    string           `json:"redirect_ip"`
		ExpiresAt     *time.Time       `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Title != "" {
		list.Title = req.Title
	}
	if req.SourceType != "" {
		list.SourceType = req.SourceType
	}
	if req.ProcessNumber != "" {
		list.ProcessNumber = req.ProcessNumber
	}
	if req.Description != "" {
		list.Description = req.Description
	}
	if req.DNSAction != "" {
		list.DNSAction = req.DNSAction
	}
	if req.RedirectIP != "" {
		list.RedirectIP = req.RedirectIP
	}
	if req.ExpiresAt != nil {
		list.ExpiresAt = req.ExpiresAt
	}
	if list.DNSAction == models.ActionRedirect && net.ParseIP(list.RedirectIP) == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "redirect_ip required for REDIRECT"})
		return
	}
	if err := h.DB.Save(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "BLOCK_LIST_UPDATED", "block_lists", &list.ID, old, list)
	c.JSON(http.StatusOK, list)
}

func (h *Handler) DeleteBlockList(c *gin.Context) {
	actor, _ := userContext(c)
	id := c.Param("id")

	var list models.BlockList
	if err := h.DB.First(&list, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "block list not found"})
		return
	}
	if !isBlockListDeletable(list.Status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only DRAFT or PENDING_APPROVAL lists can be deleted"})
		return
	}

	old := list
	tx := h.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": tx.Error.Error()})
		return
	}
	if err := tx.Where("block_list_id = ?", id).Delete(&models.RevocationRequest{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := tx.Where("block_list_id = ?", id).Delete(&models.BlockedDomain{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := tx.Where("block_list_id = ?", id).Delete(&models.UploadedFile{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := tx.Delete(&list).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	services.Audit(h.DB, c, actor, "BLOCK_LIST_DELETED", "block_lists", &list.ID, old, nil)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *Handler) changeStatus(c *gin.Context, target models.BlockListStatus, action string) {
	actor, _ := userContext(c)
	var list models.BlockList
	if err := h.DB.First(&list, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "block list not found"})
		return
	}
	if !isTransitionAllowed(list.Status, target) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status transition"})
		return
	}
	old := list
	now := time.Now()
	list.Status = target
	switch target {
	case models.StatusPendingApproval:
		list.SubmittedAt = &now
	case models.StatusApproved:
		list.ApprovedAt = &now
		if actor != nil {
			list.ApprovedBy = actor
		}
	case models.StatusApplied:
		list.AppliedAt = &now
	case models.StatusRevoked:
		list.RevokedAt = &now
		var body struct {
			Reason string `json:"reason"`
		}
		_ = c.ShouldBindJSON(&body)
		list.RevokeReason = body.Reason
	}
	if err := h.DB.Save(&list).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, action, "block_lists", &list.ID, old, list)
	if target == models.StatusRevoked {
		if _, err := h.enqueueApplyRun(c, actor, "DNS sync after revogacao imediata de lista"); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "lista revogada mas falha ao enfileirar aplicacao DNS: " + err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, list)
}

func (h *Handler) SubmitBlockList(c *gin.Context)  { h.changeStatus(c, models.StatusPendingApproval, "BLOCK_LIST_SUBMITTED") }
func (h *Handler) ApproveBlockList(c *gin.Context) { h.changeStatus(c, models.StatusApproved, "BLOCK_LIST_APPROVED") }
func (h *Handler) RevokeBlockList(c *gin.Context)  { h.changeStatus(c, models.StatusRevoked, "BLOCK_LIST_REVOKED") }

func (h *Handler) ApplyBlockList(c *gin.Context) {
	actor, _ := userContext(c)
	var list models.BlockList
	if err := h.DB.First(&list, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "block list not found"})
		return
	}
	if list.Status != models.StatusApproved {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only APPROVED list can be applied"})
		return
	}
	started := time.Now()
	run := models.ApplyRun{
		ID:          uuid.New(),
		Status:      "REQUESTED",
		StartedAt:   started,
		TriggeredBy: actor,
		Output:      "apply requested via API; worker will process APPROVED lists",
	}

	if err := h.DB.Create(&run).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "BLOCK_LIST_APPLY_REQUESTED", "block_lists", &list.ID, nil, run)
	c.JSON(http.StatusAccepted, gin.H{"block_list": list, "apply_run": run})
}

func (h *Handler) ListDomains(c *gin.Context) {
	listID := c.Param("id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ := strconv.Atoi(c.DefaultQuery("per_page", "10"))
	if page < 1 {
		page = 1
	}
	switch perPage {
	case 10, 20, 50, 100:
	default:
		perPage = 10
	}

	search := strings.TrimSpace(c.Query("q"))
	var like string
	if search != "" {
		like = "%" + search + "%"
	}

	countQ := h.DB.Model(&models.BlockedDomain{}).Where("block_list_id = ?", listID)
	findQ := h.DB.Where("block_list_id = ?", listID)
	if search != "" {
		countQ = countQ.Where("normalized_domain ILIKE ? OR original_value ILIKE ?", like, like)
		findQ = findQ.Where("normalized_domain ILIKE ? OR original_value ILIKE ?", like, like)
	}

	var total int64
	if err := countQ.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	offset := (page - 1) * perPage
	var domains []models.BlockedDomain
	if err := findQ.
		Order("created_at desc").
		Limit(perPage).
		Offset(offset).
		Find(&domains).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	totalPages := int((total + int64(perPage) - 1) / int64(perPage))
	if totalPages < 1 {
		totalPages = 1
	}

	c.JSON(http.StatusOK, gin.H{
		"items":       domains,
		"total":       total,
		"page":        page,
		"per_page":    perPage,
		"total_pages": totalPages,
	})
}

func (h *Handler) AddDomain(c *gin.Context) {
	actor, _ := userContext(c)
	var req struct {
		OriginalValue string `json:"original_value" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	blockListID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid block list id"})
		return
	}
	normalized, validationErr := services.NormalizeDomain(req.OriginalValue)
	domain := models.BlockedDomain{
		ID:               uuid.New(),
		BlockListID:      blockListID,
		OriginalValue:    req.OriginalValue,
		NormalizedDomain: normalized,
		IsValid:          validationErr == "",
		ValidationError:  validationErr,
	}
	if domain.IsValid {
		var count int64
		h.DB.Model(&models.BlockedDomain{}).
			Where("block_list_id = ? AND normalized_domain = ? AND revoked_at IS NULL", blockListID, normalized).
			Count(&count)
		if count > 0 {
			domain.IsValid = false
			domain.ValidationError = "duplicate domain in list"
		} else if note := crossListPreexistingNote(h.DB, blockListID, normalized); note != "" {
			domain.PreexistingNote = note
		}
	}
	if err := h.DB.Create(&domain).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "DOMAIN_ADDED", "blocked_domains", &domain.ID, nil, domain)
	c.JSON(http.StatusCreated, domain)
}

func (h *Handler) AddDomainsBulk(c *gin.Context) {
	var req struct {
		Values []string `json:"values" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	blockListID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid block list id"})
		return
	}
	preview := processRawDomains(req.Values)
	enrichPreviewCrossList(h.DB, blockListID, &preview.Items)
	c.JSON(http.StatusOK, preview)
}

func (h *Handler) DeleteDomain(c *gin.Context) {
	actor, role := userContext(c)
	var domain models.BlockedDomain
	if err := h.DB.First(&domain, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "domain not found"})
		return
	}
	var list models.BlockList
	if err := h.DB.First(&list, "id = ?", domain.BlockListID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "block list not found"})
		return
	}
	if role != models.RoleAdmin && list.Status != models.StatusDraft && list.Status != models.StatusPendingApproval {
		c.JSON(http.StatusForbidden, gin.H{"error": "remover dominio diretamente só em DRAFT/PENDING ou como admin; listas aplicadas use revogacao"})
		return
	}
	if err := h.DB.Delete(&domain).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "DOMAIN_DELETED", "blocked_domains", &domain.ID, domain, nil)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *Handler) NormalizePreview(c *gin.Context) {
	var req struct {
		Values []string `json:"values" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, processRawDomains(req.Values))
}

func normalizedDomainsActiveInList(db *gorm.DB, blockListID uuid.UUID) map[string]struct{} {
	var norms []string
	_ = db.Model(&models.BlockedDomain{}).
		Where("block_list_id = ? AND revoked_at IS NULL", blockListID).
		Pluck("normalized_domain", &norms)
	out := make(map[string]struct{}, len(norms))
	for _, n := range norms {
		if n != "" {
			out[n] = struct{}{}
		}
	}
	return out
}

func (h *Handler) UploadDomains(c *gin.Context) {
	actor, role := userContext(c)
	blockListID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid block list id"})
		return
	}

	var list models.BlockList
	if err := h.DB.First(&list, "id = ?", blockListID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "block list not found"})
		return
	}

	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "file is required"})
		return
	}

	mode := strings.TrimSpace(strings.ToLower(c.PostForm("mode")))
	if mode == "" {
		mode = "append"
	}
	if mode != "append" && mode != "replace" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "mode must be append or replace"})
		return
	}
	if mode == "replace" {
		if role != models.RoleAdmin && list.Status != models.StatusDraft && list.Status != models.StatusPendingApproval {
			c.JSON(http.StatusForbidden, gin.H{"error": "substituir todos os domínios em lista aplicada exige perfil administrador"})
			return
		}
	}
	if fileHeader.Size > 5*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "max upload size is 5MB"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to open file"})
		return
	}
	defer file.Close()

	content, hash, err := readAndHash(file)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read file"})
		return
	}

	values, err := parseUploadedValues(fileHeader.Filename, content)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	preview := processRawDomains(values)
	enrichPreviewCrossList(h.DB, blockListID, &preview.Items)

	upload := models.UploadedFile{
		ID:               uuid.New(),
		BlockListID:      blockListID,
		OriginalFilename: fileHeader.Filename,
		StoredFilename:   uuid.New().String() + filepath.Ext(fileHeader.Filename),
		MimeType:         fileHeader.Header.Get("Content-Type"),
		SizeBytes:        fileHeader.Size,
		Sha256Hash:       hash,
	}
	if actor != nil {
		upload.CreatedBy = *actor
	}

	tx := h.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": tx.Error.Error()})
		return
	}

	var domainsRemoved int64
	if mode == "replace" {
		res := tx.Where("block_list_id = ?", blockListID).Delete(&models.BlockedDomain{})
		if res.Error != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": res.Error.Error()})
			return
		}
		domainsRemoved = res.RowsAffected
	}

	existingNorm := normalizedDomainsActiveInList(tx, blockListID)
	skippedAlreadyInList := 0

	if err := tx.Create(&upload).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	for _, item := range preview.Items {
		if item.IsValid && !item.IsDuplicate {
			if _, dup := existingNorm[item.Normalized]; dup {
				skippedAlreadyInList++
				continue
			}
			existingNorm[item.Normalized] = struct{}{}
		}

		domain := models.BlockedDomain{
			ID:               uuid.New(),
			BlockListID:      blockListID,
			OriginalValue:    item.Original,
			NormalizedDomain: item.Normalized,
			IsValid:          item.IsValid && !item.IsDuplicate,
			ValidationError:  item.Error,
			PreexistingNote:  item.PreexistingNote,
		}
		if item.IsDuplicate {
			domain.ValidationError = "duplicate in uploaded batch"
		}
		if err := tx.Create(&domain).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if mode == "replace" {
		services.Audit(h.DB, c, actor, "BLOCK_LIST_UPLOAD_REPLACE", "block_lists", &list.ID, nil, gin.H{
			"upload_id":       upload.ID,
			"domains_removed": domainsRemoved,
			"filename":        fileHeader.Filename,
		})
	}
	services.Audit(h.DB, c, actor, "UPLOAD_PROCESSED", "uploaded_files", &upload.ID, nil, upload)

	c.JSON(http.StatusOK, gin.H{
		"upload":                  upload,
		"preview":                 preview,
		"mode":                    mode,
		"skipped_already_in_list": skippedAlreadyInList,
		"domains_removed":         domainsRemoved,
	})
}

type applyRunListResponse struct {
	ID                 uuid.UUID  `json:"id"`
	Status             string     `json:"status"`
	StartedAt          time.Time  `json:"started_at"`
	FinishedAt         *time.Time `json:"finished_at"`
	TriggeredBy        *uuid.UUID `json:"triggered_by"`
	TriggeredByName    string     `json:"triggered_by_name"`
	TriggeredByEmail   string     `json:"triggered_by_email"`
	Output             string     `json:"output"`
	ErrorMessage       string     `json:"error_message"`
	GeneratedFilePath  string     `json:"generated_file_path"`
	BackupFilePath     string     `json:"backup_file_path"`
	CreatedAt          time.Time  `json:"created_at"`
}

func (h *Handler) ListApplyRuns(c *gin.Context) {
	q := h.DB.Model(&models.ApplyRun{})
	var errMsg string
	q, errMsg = applyTimeRangeGORM(c, q, "apply_runs.created_at")
	if errMsg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
		return
	}
	if st := strings.TrimSpace(c.Query("status")); st != "" {
		q = q.Where("status = ?", st)
	}
	if search := strings.TrimSpace(c.Query("q")); search != "" {
		like := "%" + search + "%"
		q = q.Where("(output ILIKE ? OR error_message ILIKE ? OR CAST(id AS text) ILIKE ?)", like, like, like)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	page, perPage, offset := listPaginationOrDefault(c)
	var runs []models.ApplyRun
	if err := q.Order("created_at desc").Limit(perPage).Offset(offset).Find(&runs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	userIDs := map[uuid.UUID]struct{}{}
	for _, r := range runs {
		if r.TriggeredBy != nil && *r.TriggeredBy != uuid.Nil {
			userIDs[*r.TriggeredBy] = struct{}{}
		}
	}
	userInfo := map[uuid.UUID]models.User{}
	if len(userIDs) > 0 {
		ids := make([]uuid.UUID, 0, len(userIDs))
		for id := range userIDs {
			ids = append(ids, id)
		}
		var uu []models.User
		if err := h.DB.Where("id IN ?", ids).Find(&uu).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		for _, u := range uu {
			userInfo[u.ID] = u
		}
	}

	out := make([]applyRunListResponse, 0, len(runs))
	for _, r := range runs {
		row := applyRunListResponse{
			ID:                r.ID,
			Status:            r.Status,
			StartedAt:         r.StartedAt,
			FinishedAt:        r.FinishedAt,
			TriggeredBy:       r.TriggeredBy,
			Output:            r.Output,
			ErrorMessage:      r.ErrorMessage,
			GeneratedFilePath: r.GeneratedFilePath,
			BackupFilePath:    r.BackupFilePath,
			CreatedAt:         r.CreatedAt,
		}
		if r.TriggeredBy != nil {
			if u, ok := userInfo[*r.TriggeredBy]; ok {
				row.TriggeredByName = u.Name
				row.TriggeredByEmail = u.Email
			}
		}
		out = append(out, row)
	}

	totalPages := int((total + int64(perPage) - 1) / int64(perPage))
	if totalPages < 1 {
		totalPages = 1
	}
	c.JSON(http.StatusOK, gin.H{
		"items":       out,
		"total":       total,
		"page":        page,
		"per_page":    perPage,
		"total_pages": totalPages,
	})
}

func (h *Handler) GetApplyRun(c *gin.Context) {
	var run models.ApplyRun
	if err := h.DB.First(&run, "id = ?", c.Param("id")).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "apply run not found"})
		return
	}
	c.JSON(http.StatusOK, run)
}

func (h *Handler) ValidateUnbound(c *gin.Context) {
	mode := "mock"
	if !h.UnboundMock {
		mode = "real"
	}
	c.JSON(http.StatusOK, gin.H{"valid": true, "mode": mode})
}

func (h *Handler) TriggerUnboundApply(c *gin.Context) {
	actor, _ := userContext(c)
	run, err := h.enqueueApplyRun(c, actor, "aplicacao manual global solicitada")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"apply_run": run})
}

// auditLogResponse expõe nome/e-mail do usuário que originou o evento (quando houver).
type auditLogResponse struct {
	ID         uuid.UUID      `json:"id"`
	UserID     *uuid.UUID     `json:"user_id"`
	UserName   string         `json:"user_name"`
	UserEmail  string         `json:"user_email"`
	Action     string         `json:"action"`
	EntityType string         `json:"entity_type"`
	EntityID   *uuid.UUID     `json:"entity_id"`
	OldValue   datatypes.JSON `json:"old_value"`
	NewValue   datatypes.JSON `json:"new_value"`
	IPAddress  string         `json:"ip_address"`
	UserAgent  string         `json:"user_agent"`
	CreatedAt  time.Time      `json:"created_at"`
}

func (h *Handler) ListAuditLogs(c *gin.Context) {
	q := h.DB.Model(&models.AuditLog{})
	var errMsg string
	q, errMsg = applyTimeRangeGORM(c, q, "audit_logs.created_at")
	if errMsg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
		return
	}
	if userID := strings.TrimSpace(c.Query("user_id")); userID != "" {
		q = q.Where("user_id = ?", userID)
	}
	if et := strings.TrimSpace(c.Query("entity_type")); et != "" {
		q = q.Where("entity_type = ?", et)
	}
	if act := strings.TrimSpace(c.Query("action")); act != "" {
		q = q.Where("action ILIKE ?", "%"+act+"%")
	}
	if search := strings.TrimSpace(c.Query("q")); search != "" {
		like := "%" + search + "%"
		q = q.Where("(action ILIKE ? OR entity_type ILIKE ? OR ip_address ILIKE ? OR CAST(entity_id AS text) ILIKE ?)",
			like, like, like, like)
	}
	if uq := strings.TrimSpace(c.Query("user_q")); uq != "" {
		like := "%" + uq + "%"
		sub := h.DB.Model(&models.User{}).Select("id").Where("name ILIKE ? OR email ILIKE ?", like, like)
		q = q.Where("user_id IN (?)", sub)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	page, perPage, offset := listPaginationOrDefault(c)
	var logs []models.AuditLog
	if err := q.Order("created_at desc").Limit(perPage).Offset(offset).Find(&logs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	userIDs := map[uuid.UUID]struct{}{}
	for _, log := range logs {
		if log.UserID != nil && *log.UserID != uuid.Nil {
			userIDs[*log.UserID] = struct{}{}
		}
	}
	userInfo := map[uuid.UUID]models.User{}
	if len(userIDs) > 0 {
		ids := make([]uuid.UUID, 0, len(userIDs))
		for id := range userIDs {
			ids = append(ids, id)
		}
		var users []models.User
		if err := h.DB.Where("id IN ?", ids).Find(&users).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		for _, u := range users {
			userInfo[u.ID] = u
		}
	}
	out := make([]auditLogResponse, 0, len(logs))
	for _, log := range logs {
		row := auditLogResponse{
			ID:         log.ID,
			UserID:     log.UserID,
			UserName:   "",
			UserEmail:  "",
			Action:     log.Action,
			EntityType: log.EntityType,
			EntityID:   log.EntityID,
			OldValue:   log.OldValue,
			NewValue:   log.NewValue,
			IPAddress:  log.IPAddress,
			UserAgent:  log.UserAgent,
			CreatedAt:  log.CreatedAt,
		}
		if log.UserID != nil {
			if u, ok := userInfo[*log.UserID]; ok {
				row.UserName = u.Name
				row.UserEmail = u.Email
			}
		}
		out = append(out, row)
	}

	totalPages := int((total + int64(perPage) - 1) / int64(perPage))
	if totalPages < 1 {
		totalPages = 1
	}
	c.JSON(http.StatusOK, gin.H{
		"items":       out,
		"total":       total,
		"page":        page,
		"per_page":    perPage,
		"total_pages": totalPages,
	})
}

func (h *Handler) Dashboard(c *gin.Context) {
	var totalLists, pending, approved, applied, revoked, expired, totalDomains int64
	h.DB.Model(&models.BlockList{}).Count(&totalLists)
	h.DB.Model(&models.BlockList{}).Where("status = ?", models.StatusPendingApproval).Count(&pending)
	h.DB.Model(&models.BlockList{}).Where("status = ?", models.StatusApproved).Count(&approved)
	h.DB.Model(&models.BlockList{}).Where("status = ?", models.StatusApplied).Count(&applied)
	h.DB.Model(&models.BlockList{}).Where("status = ?", models.StatusRevoked).Count(&revoked)
	h.DB.Model(&models.BlockList{}).Where("status = ?", models.StatusExpired).Count(&expired)
	h.DB.Model(&models.BlockedDomain{}).Where("is_valid = ? AND revoked_at IS NULL", true).Count(&totalDomains)

	var lastSuccess, lastFailure models.ApplyRun
	_ = h.DB.Where("status = ?", "SUCCESS").Order("created_at desc").First(&lastSuccess).Error
	_ = h.DB.Where("status = ?", "FAILED").Order("created_at desc").First(&lastFailure).Error

	c.JSON(http.StatusOK, gin.H{
		"total_lists":          totalLists,
		"pending_approval":     pending,
		"approved_lists":       approved,
		"applied_lists":        applied,
		"revoked_lists":        revoked,
		"expired_lists":        expired,
		"total_domains":        totalDomains,
		"last_successful_apply": lastSuccess,
		"last_failed_apply":     lastFailure,
	})
}

func isBlockListDeletable(status models.BlockListStatus) bool {
	return status == models.StatusDraft || status == models.StatusPendingApproval
}

func isTransitionAllowed(current, target models.BlockListStatus) bool {
	allowed := map[models.BlockListStatus][]models.BlockListStatus{
		models.StatusDraft:           {models.StatusPendingApproval},
		models.StatusPendingApproval: {models.StatusApproved},
		models.StatusApproved:        {models.StatusApplied, models.StatusExpired, models.StatusFailed},
		models.StatusApplied:         {models.StatusRevoked, models.StatusExpired, models.StatusFailed},
	}
	for _, status := range allowed[current] {
		if status == target {
			return true
		}
	}
	return false
}

const maxPreexistingNoteLen = 1024

func crossListPreexistingNote(db *gorm.DB, excludeListID uuid.UUID, normalized string) string {
	if normalized == "" {
		return ""
	}
	var rows []struct {
		ID    uuid.UUID `gorm:"column:id"`
		Title string    `gorm:"column:title"`
	}
	err := db.Raw(`
		SELECT bl.id, bl.title
		FROM block_lists bl
		INNER JOIN blocked_domains d ON d.block_list_id = bl.id
		WHERE d.normalized_domain = ? AND d.revoked_at IS NULL AND d.block_list_id != ?
		GROUP BY bl.id, bl.title
		ORDER BY bl.title
		LIMIT 12
	`, normalized, excludeListID).Scan(&rows).Error
	if err != nil || len(rows) == 0 {
		return ""
	}
	titles := make([]string, 0, len(rows))
	for _, r := range rows {
		t := strings.TrimSpace(r.Title)
		if t == "" {
			t = r.ID.String()
		}
		titles = append(titles, t)
	}
	note := "Já existe em outra(s) lista(s): " + strings.Join(titles, "; ")
	if len(note) > maxPreexistingNoteLen {
		return note[:maxPreexistingNoteLen-3] + "..."
	}
	return note
}

func enrichPreviewCrossList(db *gorm.DB, blockListID uuid.UUID, items *[]services.NormalizeResult) {
	for i := range *items {
		it := &(*items)[i]
		if !it.IsValid || it.Normalized == "" || it.IsDuplicate {
			continue
		}
		it.PreexistingNote = crossListPreexistingNote(db, blockListID, it.Normalized)
	}
}

type previewResponse struct {
	TotalLines       int                        `json:"total_lines"`
	ValidCount       int                        `json:"valid_count"`
	InvalidCount     int                        `json:"invalid_count"`
	DuplicateCount   int                        `json:"duplicate_count"`
	NormalizedValues []string                   `json:"normalized_values"`
	Items            []services.NormalizeResult `json:"items"`
}

func processRawDomains(values []string) previewResponse {
	seen := map[string]bool{}
	resp := previewResponse{TotalLines: len(values), Items: make([]services.NormalizeResult, 0, len(values))}

	for _, value := range values {
		normalized, err := services.NormalizeDomain(value)
		item := services.NormalizeResult{
			Original:   value,
			Normalized: normalized,
			IsValid:    err == "",
			Error:      err,
		}
		if normalized != "" && seen[normalized] {
			item.IsDuplicate = true
			item.IsValid = false
			item.Error = "duplicate domain"
		}
		if normalized != "" {
			seen[normalized] = true
		}
		if item.IsValid {
			resp.ValidCount++
			resp.NormalizedValues = append(resp.NormalizedValues, normalized)
		} else if item.IsDuplicate {
			resp.DuplicateCount++
		} else {
			resp.InvalidCount++
		}
		resp.Items = append(resp.Items, item)
	}
	return resp
}

func readAndHash(file multipart.File) ([]byte, string, error) {
	data, err := io.ReadAll(file)
	if err != nil {
		return nil, "", err
	}
	sum := sha256.Sum256(data)
	return data, hex.EncodeToString(sum[:]), nil
}

func parseUploadedValues(filename string, data []byte) ([]string, error) {
	data = services.StripUTF8BOMFromBytes(data)
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".txt":
		lines := strings.Split(string(data), "\n")
		out := make([]string, 0, len(lines))
		for _, line := range lines {
			line = services.StripInvisibleRunes(strings.TrimSpace(line))
			if line == "" {
				continue
			}
			out = append(out, line)
		}
		return out, nil
	case ".csv":
		reader := csv.NewReader(strings.NewReader(string(data)))
		rows, err := reader.ReadAll()
		if err != nil {
			return nil, err
		}
		if len(rows) == 0 {
			return nil, errors.New("empty csv")
		}
		start := 0
		if len(rows[0]) > 0 && strings.EqualFold(services.StripInvisibleRunes(strings.TrimSpace(rows[0][0])), "domain") {
			start = 1
		}
		out := make([]string, 0, len(rows)-start)
		for i := start; i < len(rows); i++ {
			if len(rows[i]) == 0 {
				continue
			}
			value := services.StripInvisibleRunes(strings.TrimSpace(rows[i][0]))
			if value != "" {
				out = append(out, value)
			}
		}
		return out, nil
	default:
		return nil, errors.New("unsupported file type, use .txt or .csv")
	}
}

func listPaginationOrDefault(c *gin.Context) (page, perPage, offset int) {
	page, _ = strconv.Atoi(c.DefaultQuery("page", "1"))
	perPage, _ = strconv.Atoi(c.DefaultQuery("per_page", "10"))
	if page < 1 {
		page = 1
	}
	switch perPage {
	case 10, 20, 50, 100:
	default:
		perPage = 10
	}
	offset = (page - 1) * perPage
	return page, perPage, offset
}

func applyTimeRangeGORM(c *gin.Context, q *gorm.DB, column string) (*gorm.DB, string) {
	from := strings.TrimSpace(c.Query("from"))
	to := strings.TrimSpace(c.Query("to"))
	if from != "" {
		t, err := parseFlexibleTime(from, false)
		if err != nil {
			return q, "parametro from invalido"
		}
		q = q.Where(column+" >= ?", t)
	}
	if to != "" {
		t, err := parseFlexibleTime(to, true)
		if err != nil {
			return q, "parametro to invalido"
		}
		q = q.Where(column+" <= ?", t)
	}
	return q, ""
}

func parseFlexibleTime(s string, endOfDayIfDateOnly bool) (time.Time, error) {
	s = strings.TrimSpace(s)
	if len(s) == 10 && s[4] == '-' && s[7] == '-' {
		t, err := time.ParseInLocation("2006-01-02", s[:10], time.Local)
		if err != nil {
			return time.Time{}, err
		}
		if endOfDayIfDateOnly {
			return time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 999_999_999, t.Location()), nil
		}
		return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location()), nil
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02T15:04"} {
		if t, err := time.ParseInLocation(layout, s, time.Local); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid time")
}
