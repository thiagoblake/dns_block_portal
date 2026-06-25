package handlers

import (
	"net/http"
	"strings"
	"time"

	"dns-block-portal/api/internal/models"
	"dns-block-portal/api/internal/services"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type revocationBatchStats struct {
	Total            int64 `json:"total"`
	Matched          int64 `json:"matched"`
	NotFound         int64 `json:"not_found"`
	AlreadyRevoked   int64 `json:"already_revoked"`
	PendingRevocation int64 `json:"pending_revocation"`
	Invalid          int64 `json:"invalid"`
}

func (h *Handler) revocationBatchStats(batchID uuid.UUID) (revocationBatchStats, error) {
	var stats revocationBatchStats
	type row struct {
		MatchStatus string
		Count       int64
	}
	var rows []row
	if err := h.DB.Model(&models.RevocationBatchItem{}).
		Select("match_status, count(*) as count").
		Where("revocation_batch_id = ?", batchID).
		Group("match_status").
		Scan(&rows).Error; err != nil {
		return stats, err
	}
	for _, r := range rows {
		stats.Total += r.Count
		switch models.RevocationBatchMatchStatus(r.MatchStatus) {
		case models.RevocationMatchMatched:
			stats.Matched = r.Count
		case models.RevocationMatchNotFound:
			stats.NotFound = r.Count
		case models.RevocationMatchAlreadyRevoked:
			stats.AlreadyRevoked = r.Count
		case models.RevocationMatchPending:
			stats.PendingRevocation = r.Count
		case models.RevocationMatchInvalid:
			stats.Invalid = r.Count
		}
	}
	return stats, nil
}

func isRevocationBatchEditable(status models.RevocationBatchStatus) bool {
	return status == models.RevocationBatchDraft || status == models.RevocationBatchPendingApproval
}

func isRevocationBatchDeletable(status models.RevocationBatchStatus) bool {
	return status == models.RevocationBatchDraft || status == models.RevocationBatchPendingApproval
}

type domainMatchRow struct {
	DomainID         uuid.UUID `gorm:"column:domain_id"`
	BlockListID      uuid.UUID `gorm:"column:block_list_id"`
	BlockListTitle   string    `gorm:"column:block_list_title"`
	BlockListStatus  string    `gorm:"column:block_list_status"`
	NormalizedDomain string    `gorm:"column:normalized_domain"`
	RevokedAt        *time.Time
}

func (h *Handler) findActiveDomainMatches(normalized string) ([]domainMatchRow, error) {
	var rows []domainMatchRow
	err := h.DB.Raw(`
		SELECT d.id AS domain_id, d.block_list_id, bl.title AS block_list_title,
		       bl.status AS block_list_status, d.normalized_domain, d.revoked_at
		FROM blocked_domains d
		INNER JOIN block_lists bl ON bl.id = d.block_list_id
		WHERE d.normalized_domain = ? AND d.is_valid = true
		ORDER BY bl.title
	`, normalized).Scan(&rows).Error
	return rows, err
}

func (h *Handler) domainHasPendingRevocation(domainID uuid.UUID) (bool, error) {
	var n int64
	err := h.DB.Model(&models.RevocationRequest{}).
		Where("blocked_domain_id = ? AND status = ?", domainID, models.RevocationPendingApproval).
		Count(&n).Error
	return n > 0, err
}

func (h *Handler) buildRevocationBatchItems(batchID uuid.UUID, values []string) ([]models.RevocationBatchItem, error) {
	preview := processRawDomains(values)
	items := make([]models.RevocationBatchItem, 0)
	seenDomainIDs := map[uuid.UUID]struct{}{}

	for _, entry := range preview.Items {
		if entry.IsDuplicate {
			continue
		}
		if !entry.IsValid {
			items = append(items, models.RevocationBatchItem{
				ID:                uuid.New(),
				RevocationBatchID: batchID,
				OriginalValue:     entry.Original,
				NormalizedDomain:  entry.Normalized,
				MatchStatus:       models.RevocationMatchInvalid,
				ValidationError:   entry.Error,
			})
			continue
		}

		matches, err := h.findActiveDomainMatches(entry.Normalized)
		if err != nil {
			return nil, err
		}
		if len(matches) == 0 {
			items = append(items, models.RevocationBatchItem{
				ID:                uuid.New(),
				RevocationBatchID: batchID,
				OriginalValue:     entry.Original,
				NormalizedDomain:  entry.Normalized,
				MatchStatus:       models.RevocationMatchNotFound,
			})
			continue
		}

		addedMatch := false
		for _, m := range matches {
			if m.RevokedAt != nil {
				if !addedMatch {
					items = append(items, models.RevocationBatchItem{
						ID:                uuid.New(),
						RevocationBatchID: batchID,
						OriginalValue:     entry.Original,
						NormalizedDomain:  entry.Normalized,
						MatchStatus:       models.RevocationMatchAlreadyRevoked,
						BlockedDomainID:   &m.DomainID,
						BlockListID:       &m.BlockListID,
						BlockListTitle:    m.BlockListTitle,
					})
					addedMatch = true
				}
				continue
			}
			if m.BlockListStatus != string(models.StatusApplied) {
				continue
			}
			if _, dup := seenDomainIDs[m.DomainID]; dup {
				continue
			}
			pending, err := h.domainHasPendingRevocation(m.DomainID)
			if err != nil {
				return nil, err
			}
			status := models.RevocationMatchMatched
			if pending {
				status = models.RevocationMatchPending
			}
			listID := m.BlockListID
			domainID := m.DomainID
			items = append(items, models.RevocationBatchItem{
				ID:                uuid.New(),
				RevocationBatchID: batchID,
				OriginalValue:     entry.Original,
				NormalizedDomain:  entry.Normalized,
				MatchStatus:       status,
				BlockedDomainID:   &domainID,
				BlockListID:       &listID,
				BlockListTitle:    m.BlockListTitle,
			})
			seenDomainIDs[m.DomainID] = struct{}{}
			addedMatch = true
		}

		if !addedMatch {
			items = append(items, models.RevocationBatchItem{
				ID:                uuid.New(),
				RevocationBatchID: batchID,
				OriginalValue:     entry.Original,
				NormalizedDomain:  entry.Normalized,
				MatchStatus:       models.RevocationMatchNotFound,
			})
		}
	}
	return items, nil
}

func (h *Handler) appendRevocationBatchItems(batchID uuid.UUID, values []string) error {
	newItems, err := h.buildRevocationBatchItems(batchID, values)
	if err != nil {
		return err
	}
	if len(newItems) == 0 {
		return nil
	}

	var existingKeys []struct {
		NormalizedDomain string
		BlockedDomainID  *uuid.UUID
	}
	_ = h.DB.Model(&models.RevocationBatchItem{}).
		Select("normalized_domain, blocked_domain_id").
		Where("revocation_batch_id = ?", batchID).
		Find(&existingKeys)
	seen := map[string]struct{}{}
	for _, e := range existingKeys {
		if e.BlockedDomainID != nil {
			seen[e.BlockedDomainID.String()] = struct{}{}
		} else if e.NormalizedDomain != "" {
			seen["n:"+strings.ToLower(e.NormalizedDomain)] = struct{}{}
		}
	}

	filtered := make([]models.RevocationBatchItem, 0, len(newItems))
	for _, it := range newItems {
		if it.BlockedDomainID != nil {
			key := it.BlockedDomainID.String()
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}
		} else if it.NormalizedDomain != "" {
			key := "n:" + strings.ToLower(it.NormalizedDomain)
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}
		}
		filtered = append(filtered, it)
	}
	if len(filtered) == 0 {
		return nil
	}
	return h.DB.Create(&filtered).Error
}

func (h *Handler) replaceRevocationBatchItems(batchID uuid.UUID, values []string) error {
	newItems, err := h.buildRevocationBatchItems(batchID, values)
	if err != nil {
		return err
	}
	tx := h.DB.Begin()
	if tx.Error != nil {
		return tx.Error
	}
	if err := tx.Where("revocation_batch_id = ?", batchID).Delete(&models.RevocationBatchItem{}).Error; err != nil {
		tx.Rollback()
		return err
	}
	if len(newItems) > 0 {
		if err := tx.Create(&newItems).Error; err != nil {
			tx.Rollback()
			return err
		}
	}
	return tx.Commit().Error
}

func (h *Handler) ListRevocationBatches(c *gin.Context) {
	q := h.DB.Model(&models.RevocationBatch{})
	if st := strings.TrimSpace(c.Query("status")); st != "" {
		q = q.Where("status = ?", st)
	}
	if search := strings.TrimSpace(c.Query("q")); search != "" {
		like := "%" + search + "%"
		q = q.Where("title ILIKE ? OR description ILIKE ? OR process_number ILIKE ?", like, like, like)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	page, perPage, offset := listPaginationOrDefault(c)
	var batches []models.RevocationBatch
	if err := q.Order("created_at desc").Limit(perPage).Offset(offset).Find(&batches).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	type batchRow struct {
		models.RevocationBatch
		Stats revocationBatchStats `json:"stats"`
	}
	out := make([]batchRow, 0, len(batches))
	for _, b := range batches {
		stats, _ := h.revocationBatchStats(b.ID)
		out = append(out, batchRow{RevocationBatch: b, Stats: stats})
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

func (h *Handler) CreateRevocationBatch(c *gin.Context) {
	actor, _ := userContext(c)
	var req struct {
		Title         string `json:"title" binding:"required"`
		SourceType    string `json:"source_type" binding:"required"`
		ProcessNumber string `json:"process_number"`
		Description   string `json:"description"`
		Reason        string `json:"reason" binding:"required,min=3"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	batch := models.RevocationBatch{
		ID:            uuid.New(),
		Title:         req.Title,
		SourceType:    req.SourceType,
		ProcessNumber: req.ProcessNumber,
		Description:   req.Description,
		Reason:        req.Reason,
		Status:        models.RevocationBatchDraft,
		CreatedBy:     *actor,
	}
	if err := h.DB.Create(&batch).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "REVOCATION_BATCH_CREATED", "revocation_batches", &batch.ID, nil, batch)
	c.JSON(http.StatusCreated, batch)
}

func (h *Handler) GetRevocationBatch(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var batch models.RevocationBatch
	if err := h.DB.First(&batch, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "batch not found"})
		return
	}
	stats, _ := h.revocationBatchStats(id)
	c.JSON(http.StatusOK, gin.H{"batch": batch, "stats": stats})
}

func (h *Handler) UpdateRevocationBatch(c *gin.Context) {
	actor, _ := userContext(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var batch models.RevocationBatch
	if err := h.DB.First(&batch, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "batch not found"})
		return
	}
	if !isRevocationBatchEditable(batch.Status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "lote nao pode ser editado neste status"})
		return
	}
	old := batch
	var req struct {
		Title         string `json:"title"`
		SourceType    string `json:"source_type"`
		ProcessNumber string `json:"process_number"`
		Description   string `json:"description"`
		Reason        string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Title != "" {
		batch.Title = req.Title
	}
	if req.SourceType != "" {
		batch.SourceType = req.SourceType
	}
	if req.ProcessNumber != "" {
		batch.ProcessNumber = req.ProcessNumber
	}
	if req.Description != "" {
		batch.Description = req.Description
	}
	if req.Reason != "" {
		if len(strings.TrimSpace(req.Reason)) < 3 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "reason must be at least 3 characters"})
			return
		}
		batch.Reason = req.Reason
	}
	if err := h.DB.Save(&batch).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "REVOCATION_BATCH_UPDATED", "revocation_batches", &batch.ID, old, batch)
	c.JSON(http.StatusOK, batch)
}

func (h *Handler) DeleteRevocationBatch(c *gin.Context) {
	actor, _ := userContext(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var batch models.RevocationBatch
	if err := h.DB.First(&batch, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "batch not found"})
		return
	}
	if !isRevocationBatchDeletable(batch.Status) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only DRAFT or PENDING_APPROVAL batches can be deleted"})
		return
	}
	tx := h.DB.Begin()
	if err := tx.Where("revocation_batch_id = ?", id).Delete(&models.RevocationBatchItem{}).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := tx.Delete(&batch).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "REVOCATION_BATCH_DELETED", "revocation_batches", &id, batch, nil)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *Handler) ListRevocationBatchItems(c *gin.Context) {
	batchID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	q := h.DB.Model(&models.RevocationBatchItem{}).Where("revocation_batch_id = ?", batchID)
	if st := strings.TrimSpace(c.Query("match_status")); st != "" {
		q = q.Where("match_status = ?", st)
	}
	if search := strings.TrimSpace(c.Query("q")); search != "" {
		like := "%" + search + "%"
		q = q.Where("original_value ILIKE ? OR normalized_domain ILIKE ? OR block_list_title ILIKE ?", like, like, like)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	page, perPage, offset := listPaginationOrDefault(c)
	var items []models.RevocationBatchItem
	if err := q.Order("match_status asc, normalized_domain asc").Limit(perPage).Offset(offset).Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	totalPages := int((total + int64(perPage) - 1) / int64(perPage))
	if totalPages < 1 {
		totalPages = 1
	}
	c.JSON(http.StatusOK, gin.H{
		"items":       items,
		"total":       total,
		"page":        page,
		"per_page":    perPage,
		"total_pages": totalPages,
	})
}

func (h *Handler) UploadRevocationBatchDomains(c *gin.Context) {
	actor, _ := userContext(c)
	batchID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var batch models.RevocationBatch
	if err := h.DB.First(&batch, "id = ?", batchID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "batch not found"})
		return
	}
	if batch.Status != models.RevocationBatchDraft {
		c.JSON(http.StatusBadRequest, gin.H{"error": "upload permitido apenas em rascunho"})
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
	content, _, err := readAndHash(file)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "failed to read file"})
		return
	}
	values, err := parseUploadedValues(fileHeader.Filename, content)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if mode == "replace" {
		err = h.replaceRevocationBatchItems(batchID, values)
	} else {
		err = h.appendRevocationBatchItems(batchID, values)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	stats, _ := h.revocationBatchStats(batchID)
	services.Audit(h.DB, c, actor, "REVOCATION_BATCH_UPLOAD", "revocation_batches", &batchID, nil, gin.H{
		"filename": fileHeader.Filename,
		"mode":     mode,
		"lines":    len(values),
	})
	c.JSON(http.StatusOK, gin.H{"stats": stats, "lines_processed": len(values)})
}

func (h *Handler) BulkRevocationBatchDomains(c *gin.Context) {
	actor, _ := userContext(c)
	batchID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var batch models.RevocationBatch
	if err := h.DB.First(&batch, "id = ?", batchID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "batch not found"})
		return
	}
	if batch.Status != models.RevocationBatchDraft {
		c.JSON(http.StatusBadRequest, gin.H{"error": "inclusao em lote permitida apenas em rascunho"})
		return
	}
	var req struct {
		Values []string `json:"values" binding:"required"`
		Mode   string   `json:"mode"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	mode := strings.TrimSpace(strings.ToLower(req.Mode))
	if mode == "" {
		mode = "append"
	}
	var opErr error
	if mode == "replace" {
		opErr = h.replaceRevocationBatchItems(batchID, req.Values)
	} else {
		opErr = h.appendRevocationBatchItems(batchID, req.Values)
	}
	if opErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": opErr.Error()})
		return
	}
	stats, _ := h.revocationBatchStats(batchID)
	services.Audit(h.DB, c, actor, "REVOCATION_BATCH_BULK", "revocation_batches", &batchID, nil, gin.H{"mode": mode, "lines": len(req.Values)})
	c.JSON(http.StatusOK, gin.H{"stats": stats})
}

func (h *Handler) PreviewRevocationBatchDomains(c *gin.Context) {
	var req struct {
		Values []string `json:"values" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	items, err := h.buildRevocationBatchItems(uuid.Nil, req.Values)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var stats revocationBatchStats
	stats.Total = int64(len(items))
	for _, it := range items {
		switch it.MatchStatus {
		case models.RevocationMatchMatched:
			stats.Matched++
		case models.RevocationMatchNotFound:
			stats.NotFound++
		case models.RevocationMatchAlreadyRevoked:
			stats.AlreadyRevoked++
		case models.RevocationMatchPending:
			stats.PendingRevocation++
		case models.RevocationMatchInvalid:
			stats.Invalid++
		}
	}
	c.JSON(http.StatusOK, gin.H{"items": items, "stats": stats})
}

func (h *Handler) SubmitRevocationBatch(c *gin.Context) {
	actor, _ := userContext(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var batch models.RevocationBatch
	if err := h.DB.First(&batch, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "batch not found"})
		return
	}
	if batch.Status != models.RevocationBatchDraft {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only DRAFT batch can be submitted"})
		return
	}
	stats, err := h.revocationBatchStats(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if stats.Matched == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nenhum dominio elegivel para revogacao (MATCHED)"})
		return
	}
	now := time.Now()
	old := batch
	batch.Status = models.RevocationBatchPendingApproval
	batch.SubmittedAt = &now
	if err := h.DB.Save(&batch).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "REVOCATION_BATCH_SUBMITTED", "revocation_batches", &batch.ID, old, batch)
	c.JSON(http.StatusOK, batch)
}

func (h *Handler) ApproveRevocationBatch(c *gin.Context) {
	actor, _ := userContext(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var batch models.RevocationBatch
	if err := h.DB.First(&batch, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "batch not found"})
		return
	}
	if batch.Status != models.RevocationBatchPendingApproval {
		c.JSON(http.StatusBadRequest, gin.H{"error": "lote nao esta pendente de aprovacao"})
		return
	}

	var items []models.RevocationBatchItem
	if err := h.DB.Where("revocation_batch_id = ? AND match_status = ?", id, models.RevocationMatchMatched).Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if len(items) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "nenhum item MATCHED para revogar"})
		return
	}

	now := time.Now()
	tx := h.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": tx.Error.Error()})
		return
	}

	revokedCount := 0
	for _, item := range items {
		if item.BlockedDomainID == nil || item.BlockListID == nil {
			continue
		}
		var domain models.BlockedDomain
		if err := tx.First(&domain, "id = ?", *item.BlockedDomainID).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusBadRequest, gin.H{"error": "dominio nao encontrado: " + item.NormalizedDomain})
			return
		}
		if domain.RevokedAt != nil {
			continue
		}
		oldDomain := domain
		domain.RevokedAt = &now
		if err := tx.Save(&domain).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		batchID := id
		req := models.RevocationRequest{
			ID:                uuid.New(),
			Kind:              models.RevocationKindDomain,
			BlockListID:       *item.BlockListID,
			BlockedDomainID:   item.BlockedDomainID,
			RevocationBatchID: &batchID,
			Status:            models.RevocationApproved,
			Reason:            batch.Reason,
			RequestedBy:       batch.CreatedBy,
			ApprovedBy:        actor,
			ApprovedAt:        &now,
		}
		if err := tx.Create(&req).Error; err != nil {
			tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		services.Audit(h.DB, c, actor, "DOMAIN_REVOKED_AFTER_BATCH", "blocked_domains", &domain.ID, oldDomain, domain)
		revokedCount++
	}

	oldBatch := batch
	batch.Status = models.RevocationBatchApplied
	batch.ApprovedBy = actor
	batch.ApprovedAt = &now
	batch.AppliedAt = &now
	if err := tx.Save(&batch).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	run, err := h.enqueueApplyRun(c, actor, "DNS atualizado apos aprovacao de lote de revogacao")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "lote aprovado mas falha ao enfileirar DNS: " + err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "REVOCATION_BATCH_APPROVED", "revocation_batches", &batch.ID, oldBatch, batch)
	c.JSON(http.StatusOK, gin.H{
		"batch":          batch,
		"revoked_count":  revokedCount,
		"apply_run":      run,
	})
}

func (h *Handler) RejectRevocationBatch(c *gin.Context) {
	actor, _ := userContext(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var body struct {
		RejectReason string `json:"reject_reason" binding:"required,min=3"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var batch models.RevocationBatch
	if err := h.DB.First(&batch, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "batch not found"})
		return
	}
	if batch.Status != models.RevocationBatchPendingApproval {
		c.JSON(http.StatusBadRequest, gin.H{"error": "lote nao esta pendente"})
		return
	}
	old := batch
	batch.Status = models.RevocationBatchRejected
	batch.RejectReason = body.RejectReason
	if err := h.DB.Save(&batch).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "REVOCATION_BATCH_REJECTED", "revocation_batches", &batch.ID, old, batch)
	c.JSON(http.StatusOK, batch)
}

func (h *Handler) RematchRevocationBatch(c *gin.Context) {
	actor, _ := userContext(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var batch models.RevocationBatch
	if err := h.DB.First(&batch, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "batch not found"})
		return
	}
	if batch.Status != models.RevocationBatchDraft {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rematch permitido apenas em rascunho"})
		return
	}
	var originals []string
	if err := h.DB.Model(&models.RevocationBatchItem{}).
		Where("revocation_batch_id = ?", id).
		Pluck("original_value", &originals).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if len(originals) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "lote sem dominios"})
		return
	}
	if err := h.replaceRevocationBatchItems(id, originals); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	stats, _ := h.revocationBatchStats(id)
	services.Audit(h.DB, c, actor, "REVOCATION_BATCH_REMATCH", "revocation_batches", &id, nil, stats)
	c.JSON(http.StatusOK, gin.H{"stats": stats})
}
