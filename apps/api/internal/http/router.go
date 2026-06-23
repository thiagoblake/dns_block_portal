package http

import (
	"os"

	"dns-block-portal/api/internal/handlers"
	"dns-block-portal/api/internal/middleware"
	"dns-block-portal/api/internal/models"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

func NewRouter(handler *handlers.Handler, frontendURL, jwtSecret string) *gin.Engine {
	router := gin.Default()
	router.Use(cors.New(cors.Config{
		AllowOrigins:     []string{frontendURL, "http://localhost:3000"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Authorization", "Content-Type"},
		AllowCredentials: true,
	}))

	api := router.Group("/api")

	auth := api.Group("/auth")
	{
		auth.POST("/login", handler.Login)
	}

	protected := api.Group("")
	protected.Use(middleware.JWTAuth(jwtSecret))
	{
		authProtected := protected.Group("/auth")
		authProtected.GET("/me", handler.Me)
		authProtected.POST("/logout", handler.Logout)

		users := protected.Group("/users")
		users.Use(middleware.RequireRoles(models.RoleAdmin))
		{
			users.GET("", handler.ListUsers)
			users.POST("", handler.CreateUser)
			users.GET("/:id", handler.GetUser)
			users.PUT("/:id", handler.UpdateUser)
			users.PATCH("/:id/status", handler.UpdateUserStatus)
			users.PATCH("/:id/password", handler.UpdateUserPassword)
		}

		blockLists := protected.Group("/block-lists")
		{
			blockLists.GET("", handler.ListBlockLists)
			blockLists.GET("/:id", handler.GetBlockList)

			write := blockLists.Group("")
			write.Use(middleware.RequireRoles(models.RoleAdmin, models.RoleOperator))
			{
				write.POST("", handler.CreateBlockList)
				write.PUT("/:id", handler.UpdateBlockList)
				write.POST("/:id/submit", handler.SubmitBlockList)
				write.POST("/:id/revoke-requests", handler.CreateListRevocationRequest)
				write.POST("/:id/domains", handler.AddDomain)
				write.POST("/:id/domains/bulk", handler.AddDomainsBulk)
				write.POST("/:id/upload", handler.UploadDomains)
				write.GET("/:id/domains", handler.ListDomains)
			}

			admin := blockLists.Group("")
			admin.Use(middleware.RequireRoles(models.RoleAdmin))
			{
				admin.DELETE("/:id", handler.DeleteBlockList)
				admin.POST("/:id/approve", handler.ApproveBlockList)
				admin.POST("/:id/revoke", handler.RevokeBlockList)
				admin.POST("/:id/apply", handler.ApplyBlockList)
			}
		}

		protected.POST("/blocked-domains/:id/revoke-requests", middleware.RequireRoles(models.RoleAdmin, models.RoleOperator), handler.CreateDomainRevocationRequest)

		revocation := protected.Group("/revocation-requests")
		{
			revocation.GET("", handler.ListRevocationRequests)
			revocation.POST("/:id/approve", middleware.RequireRoles(models.RoleAdmin), handler.ApproveRevocationRequest)
			revocation.POST("/:id/reject", middleware.RequireRoles(models.RoleAdmin), handler.RejectRevocationRequest)
		}

		protected.DELETE("/domains/:id", middleware.RequireRoles(models.RoleAdmin, models.RoleOperator), handler.DeleteDomain)
		protected.POST("/domains/normalize-preview", handler.NormalizePreview)

		protected.GET("/apply-runs", middleware.RequireRoles(models.RoleAdmin, models.RoleAuditor), handler.ListApplyRuns)
		protected.GET("/apply-runs/:id", middleware.RequireRoles(models.RoleAdmin, models.RoleAuditor), handler.GetApplyRun)
		protected.POST("/unbound/apply", middleware.RequireRoles(models.RoleAdmin), handler.TriggerUnboundApply)
		protected.POST("/unbound/validate", middleware.RequireRoles(models.RoleAdmin), handler.ValidateUnbound)

		protected.GET("/audit-logs", middleware.RequireRoles(models.RoleAdmin, models.RoleAuditor), handler.ListAuditLogs)
		protected.GET("/dashboard", handler.Dashboard)
	}

	router.GET("/healthz", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok", "mock": os.Getenv("UNBOUND_MOCK")})
	})

	return router
}
