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

// revocationRequestResponse inclui rótulos para a UI (evita exibir só UUIDs).
type revocationRequestResponse struct {
	ID                 uuid.UUID                       `json:"id"`
	Kind               models.RevocationKind           `json:"kind"`
	BlockListID        uuid.UUID                       `json:"block_list_id"`
	BlockListTitle     string                          `json:"block_list_title"`
	BlockedDomainID    *uuid.UUID                      `json:"blocked_domain_id"`
	BlockedDomainLabel string                          `json:"blocked_domain_label"`
	Status             models.RevocationRequestStatus  `json:"status"`
	Reason             string                          `json:"reason"`
	RejectReason       string                          `json:"reject_reason"`
	RequestedBy        uuid.UUID                       `json:"requested_by"`
	RequestedByName    string                          `json:"requested_by_name"`
	RequestedByEmail   string                          `json:"requested_by_email"`
	ApprovedBy         *uuid.UUID                      `json:"approved_by,omitempty"`
	ApprovedByName     string                          `json:"approved_by_name,omitempty"`
	ApprovedByEmail    string                          `json:"approved_by_email,omitempty"`
	CreatedAt          time.Time                       `json:"created_at"`
	UpdatedAt          time.Time                       `json:"updated_at"`
	ApprovedAt         *time.Time                      `json:"approved_at,omitempty"`
}

func uuidSetToSlice(m map[uuid.UUID]struct{}) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(m))
	for id := range m {
		out = append(out, id)
	}
	return out
}

func (h *Handler) revocationRequestsToResponse(reqs []models.RevocationRequest) ([]revocationRequestResponse, error) {
	if len(reqs) == 0 {
		return []revocationRequestResponse{}, nil
	}
	listIDs := map[uuid.UUID]struct{}{}
	domainIDs := map[uuid.UUID]struct{}{}
	userIDs := map[uuid.UUID]struct{}{}
	for _, r := range reqs {
		listIDs[r.BlockListID] = struct{}{}
		if r.BlockedDomainID != nil {
			domainIDs[*r.BlockedDomainID] = struct{}{}
		}
		if r.RequestedBy != uuid.Nil {
			userIDs[r.RequestedBy] = struct{}{}
		}
		if r.ApprovedBy != nil && *r.ApprovedBy != uuid.Nil {
			userIDs[*r.ApprovedBy] = struct{}{}
		}
	}

	var lists []models.BlockList
	if err := h.DB.Where("id IN ?", uuidSetToSlice(listIDs)).Find(&lists).Error; err != nil {
		return nil, err
	}
	listTitles := make(map[uuid.UUID]string, len(lists))
	for _, l := range lists {
		listTitles[l.ID] = l.Title
	}

	domainLabels := map[uuid.UUID]string{}
	if len(domainIDs) > 0 {
		var domains []models.BlockedDomain
		if err := h.DB.Where("id IN ?", uuidSetToSlice(domainIDs)).Find(&domains).Error; err != nil {
			return nil, err
		}
		for _, d := range domains {
			label := d.NormalizedDomain
			if label == "" {
				label = d.OriginalValue
			} else if d.OriginalValue != "" && d.OriginalValue != d.NormalizedDomain {
				label = d.OriginalValue + " → " + d.NormalizedDomain
			}
			domainLabels[d.ID] = label
		}
	}

	userInfo := map[uuid.UUID]models.User{}
	if len(userIDs) > 0 {
		var users []models.User
		if err := h.DB.Where("id IN ?", uuidSetToSlice(userIDs)).Find(&users).Error; err != nil {
			return nil, err
		}
		for _, u := range users {
			userInfo[u.ID] = u
		}
	}

	out := make([]revocationRequestResponse, 0, len(reqs))
	for _, r := range reqs {
		reqUser := userInfo[r.RequestedBy]
		resp := revocationRequestResponse{
			ID:                 r.ID,
			Kind:               r.Kind,
			BlockListID:        r.BlockListID,
			BlockListTitle:     listTitles[r.BlockListID],
			BlockedDomainID:    r.BlockedDomainID,
			BlockedDomainLabel: "",
			Status:             r.Status,
			Reason:             r.Reason,
			RejectReason:       r.RejectReason,
			RequestedBy:        r.RequestedBy,
			RequestedByName:    reqUser.Name,
			RequestedByEmail:   reqUser.Email,
			ApprovedBy:         r.ApprovedBy,
			CreatedAt:          r.CreatedAt,
			UpdatedAt:          r.UpdatedAt,
			ApprovedAt:         r.ApprovedAt,
		}
		if r.BlockedDomainID != nil {
			resp.BlockedDomainLabel = domainLabels[*r.BlockedDomainID]
		}
		if r.ApprovedBy != nil {
			if au, ok := userInfo[*r.ApprovedBy]; ok {
				resp.ApprovedByName = au.Name
				resp.ApprovedByEmail = au.Email
			}
		}
		out = append(out, resp)
	}
	return out, nil
}

func (h *Handler) enqueueApplyRun(c *gin.Context, actor *uuid.UUID, output string) (*models.ApplyRun, error) {
	run := models.ApplyRun{
		ID:          uuid.New(),
		Status:      "REQUESTED",
		StartedAt:   time.Now(),
		TriggeredBy: actor,
		Output:      output,
	}
	if err := h.DB.Create(&run).Error; err != nil {
		return nil, err
	}
	return &run, nil
}

// POST /api/block-lists/:id/revoke-requests — solicitar revogação da lista inteira (após aplicada no DNS).
func (h *Handler) CreateListRevocationRequest(c *gin.Context) {
	actor, _ := userContext(c)
	listID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid block list id"})
		return
	}
	var list models.BlockList
	if err := h.DB.First(&list, "id = ?", listID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "block list not found"})
		return
	}
	if list.Status != models.StatusApplied {
		c.JSON(http.StatusBadRequest, gin.H{"error": "somente listas APPLIED podem ter solicitação de revogação"})
		return
	}
	var body struct {
		Reason string `json:"reason" binding:"required,min=3"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var pending int64
	h.DB.Model(&models.RevocationRequest{}).
		Where("block_list_id = ? AND kind = ? AND status = ?", listID, models.RevocationKindList, models.RevocationPendingApproval).
		Count(&pending)
	if pending > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "ja existe solicitacao pendente para esta lista"})
		return
	}
	req := models.RevocationRequest{
		ID:          uuid.New(),
		Kind:        models.RevocationKindList,
		BlockListID: listID,
		Status:      models.RevocationPendingApproval,
		Reason:      body.Reason,
		RequestedBy: *actor,
	}
	if err := h.DB.Create(&req).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "LIST_REVOCATION_REQUESTED", "revocation_requests", &req.ID, nil, req)

	c.JSON(http.StatusCreated, req)
}

// POST /api/blocked-domains/:id/revoke-requests — solicitar revogação de um domínio (lista já aplicada).
func (h *Handler) CreateDomainRevocationRequest(c *gin.Context) {
	actor, _ := userContext(c)
	domainID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid domain id"})
		return
	}
	var domain models.BlockedDomain
	if err := h.DB.First(&domain, "id = ?", domainID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "domain not found"})
		return
	}
	if domain.RevokedAt != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "dominio ja revogado"})
		return
	}
	var list models.BlockList
	if err := h.DB.First(&list, "id = ?", domain.BlockListID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "block list not found"})
		return
	}
	if list.Status != models.StatusApplied {
		c.JSON(http.StatusBadRequest, gin.H{"error": "somente dominios de listas APPLIED podem ser revogados via solicitacao"})
		return
	}
	var body struct {
		Reason string `json:"reason" binding:"required,min=3"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var pending int64
	h.DB.Model(&models.RevocationRequest{}).
		Where("blocked_domain_id = ? AND status = ?", domainID, models.RevocationPendingApproval).
		Count(&pending)
	if pending > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "ja existe solicitacao pendente para este dominio"})
		return
	}
	req := models.RevocationRequest{
		ID:              uuid.New(),
		Kind:            models.RevocationKindDomain,
		BlockListID:     domain.BlockListID,
		BlockedDomainID: &domainID,
		Status:          models.RevocationPendingApproval,
		Reason:          body.Reason,
		RequestedBy:     *actor,
	}
	if err := h.DB.Create(&req).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "DOMAIN_REVOCATION_REQUESTED", "revocation_requests", &req.ID, nil, req)
	c.JSON(http.StatusCreated, req)
}

func (h *Handler) ListRevocationRequests(c *gin.Context) {
	q := h.DB.Model(&models.RevocationRequest{})
	var errMsg string
	q, errMsg = applyTimeRangeGORM(c, q, "revocation_requests.created_at")
	if errMsg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": errMsg})
		return
	}
	if st := strings.TrimSpace(c.Query("status")); st != "" {
		q = q.Where("revocation_requests.status = ?", st)
	}
	if k := strings.TrimSpace(c.Query("kind")); k != "" {
		q = q.Where("revocation_requests.kind = ?", k)
	}
	if bid := strings.TrimSpace(c.Query("block_list_id")); bid != "" {
		if id, err := uuid.Parse(bid); err == nil {
			q = q.Where("revocation_requests.block_list_id = ?", id)
		}
	}
	if search := strings.TrimSpace(c.Query("q")); search != "" {
		like := "%" + search + "%"
		listSub := h.DB.Model(&models.BlockList{}).Select("id").Where("title ILIKE ? OR process_number ILIKE ?", like, like)
		domSub := h.DB.Model(&models.BlockedDomain{}).Select("id").Where("normalized_domain ILIKE ? OR original_value ILIKE ?", like, like)
		q = q.Where(
			`(revocation_requests.reason ILIKE ? OR COALESCE(revocation_requests.reject_reason,'') ILIKE ? OR CAST(revocation_requests.id AS text) ILIKE ? OR revocation_requests.block_list_id IN (?) OR (revocation_requests.blocked_domain_id IS NOT NULL AND revocation_requests.blocked_domain_id IN (?))`,
			like, like, like, listSub, domSub,
		)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	page, perPage, offset := listPaginationOrDefault(c)
	var reqs []models.RevocationRequest
	if err := q.Order("revocation_requests.created_at desc").Limit(perPage).Offset(offset).Find(&reqs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	out, err := h.revocationRequestsToResponse(reqs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
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

func (h *Handler) ApproveRevocationRequest(c *gin.Context) {
	actor, _ := userContext(c)
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var req models.RevocationRequest
	if err := h.DB.First(&req, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if req.Status != models.RevocationPendingApproval {
		c.JSON(http.StatusBadRequest, gin.H{"error": "solicitacao nao esta pendente"})
		return
	}
	now := time.Now()
	req.Status = models.RevocationApproved
	req.ApprovedBy = actor
	req.ApprovedAt = &now

	switch req.Kind {
	case models.RevocationKindList:
		var list models.BlockList
		if err := h.DB.First(&list, "id = ?", req.BlockListID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "lista nao encontrada"})
			return
		}
		old := list
		list.Status = models.StatusRevoked
		list.RevokedAt = &now
		list.RevokeReason = req.Reason
		if err := h.DB.Save(&list).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		services.Audit(h.DB, c, actor, "BLOCK_LIST_REVOKED_AFTER_REQUEST", "block_lists", &list.ID, old, list)

	case models.RevocationKindDomain:
		if req.BlockedDomainID == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "blocked_domain_id ausente"})
			return
		}
		var domain models.BlockedDomain
		if err := h.DB.First(&domain, "id = ?", *req.BlockedDomainID).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "dominio nao encontrado"})
			return
		}
		old := domain
		domain.RevokedAt = &now
		if err := h.DB.Save(&domain).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		services.Audit(h.DB, c, actor, "DOMAIN_REVOKED_AFTER_REQUEST", "blocked_domains", &domain.ID, old, domain)

	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "tipo invalido"})
		return
	}

	if err := h.DB.Save(&req).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	run, err := h.enqueueApplyRun(c, actor, "DNS atualizado apos aprovacao de revogacao")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "REVOCATION_REQUEST_APPROVED", "revocation_requests", &req.ID, nil, req)

	c.JSON(http.StatusOK, gin.H{"request": req, "apply_run": run})
}

func (h *Handler) RejectRevocationRequest(c *gin.Context) {
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
	var req models.RevocationRequest
	if err := h.DB.First(&req, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	if req.Status != models.RevocationPendingApproval {
		c.JSON(http.StatusBadRequest, gin.H{"error": "solicitacao nao esta pendente"})
		return
	}
	req.Status = models.RevocationRejected
	req.RejectReason = body.RejectReason
	if err := h.DB.Save(&req).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	services.Audit(h.DB, c, actor, "REVOCATION_REQUEST_REJECTED", "revocation_requests", &req.ID, nil, req)
	_ = actor
	c.JSON(http.StatusOK, req)
}
