## Multi-Tenant AI Orchestration Platform with LangChain Integration

### Overview
Central intelligence layer that handles all AI orchestration, multi-tenant OAuth management, and integration routing. This service acts as the brain of the system, managing conversations, detecting intents, and then deligating the incomming prompt to a connected webhook for tool execution.

### Project Setup

#### 1. Initialize Project Structure
mkdir ai-orchestrator-api && cd ai-orchestrator-api
go mod init github.com/yourcompany/ai-orchestrator-api

# Create directory structure
mkdir -p cmd/api internal/{config,database,models,handlers,services,middleware,ai} 
mkdir -p pkg/{utils,errors} tests/{integration,e2e} migrations docker


## Core Dependencies
go// go.mod initial dependencies
require (
    github.com/gin-gonic/gin v1.9.1
    gorm.io/gorm v1.25.5
    gorm.io/driver/postgres v1.5.4
    github.com/tmc/langchaingo v0.1.8
    github.com/sashabaranov/go-openai v1.19.2
    github.com/golang-jwt/jwt/v5 v5.2.0
    golang.org/x/oauth2 v0.15.0
    github.com/redis/go-redis/v9 v9.4.0
    github.com/spf13/viper v1.18.2
    github.com/google/uuid v1.5.0
    github.com/stretchr/testify v1.8.4
)

# Database Schema
## Multi-Tenant Models
sql-- migrations/001_initial_schema.sql
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    subdomain VARCHAR(100) UNIQUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),
    external_id VARCHAR(255) NOT NULL, -- MS Teams ID, Slack ID, etc
    channel_type VARCHAR(50) NOT NULL, -- 'teams', 'slack', 'web'
    email VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(organization_id, external_id, channel_type)
);

CREATE TABLE oauth_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),
    provider_type VARCHAR(50) NOT NULL, -- 'microsoft', 'atlassian', 'slack'
    client_id TEXT NOT NULL, -- encrypted
    client_secret TEXT NOT NULL, -- encrypted
    tenant_id VARCHAR(255), -- for Microsoft
    additional_config JSONB,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(organization_id, provider_type)
);

CREATE TABLE user_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    provider_id UUID REFERENCES oauth_providers(id),
    access_token TEXT NOT NULL, -- encrypted
    refresh_token TEXT, -- encrypted
    expires_at TIMESTAMP,
    scopes TEXT[],
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, provider_id)
);

CREATE TABLE n8n_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id),
    webhook_url TEXT NOT NULL,
    api_key TEXT, -- encrypted
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(organization_id, is_default) WHERE is_default = true
);

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    external_conversation_id VARCHAR(255), -- Teams conversation ID
    context JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
# Core Implementation
## Environment Configuration

# .env.example
APP_ENV=development
APP_PORT=8080
APP_NAME=ai-orchestrator

# Database
DATABASE_URL=postgres://user:password@localhost:5432/ai_orchestrator?sslmode=disable

# Redis
REDIS_URL=redis://localhost:6379/0

# Encryption
ENCRYPTION_KEY=your-32-character-encryption-key-here

# JWT
JWT_SECRET=your-jwt-secret-key

# OpenAI (for LangChain)
OPENAI_API_KEY=sk-...

# Default OAuth Redirect Base URL
OAUTH_REDIRECT_BASE_URL=https://your-api-domain.com

# Logging
LOG_LEVEL=debug
LOG_FORMAT=json

# Core Services Implementation
go// internal/services/chat_service.go - Main orchestration service
type ChatService struct {
    tenantService     *TenantService
    aiEngine         *ai.IntentDetector
    tokenManager     *TokenManager
    n8nClient        *N8NClient
    contextManager   *ai.ContextManager
}

type ChatRequest struct {
    Message        string                 `json:"message"`
    UserID         string                 `json:"user_id"`
    Channel        string                 `json:"channel"`
    ConversationID string                 `json:"conversation_id"`
    OrganizationID string                 `json:"organization_id"`
    Metadata       map[string]interface{} `json:"metadata"`
}

type ChatResponse struct {
    Type      string                 `json:"type"` // "message", "auth_required", "error"
    Content   string                 `json:"content,omitempty"`
    AuthURL   string                 `json:"auth_url,omitempty"`
    SessionID string                 `json:"session_id,omitempty"`
    Provider  string                 `json:"provider,omitempty"`
    Actions   []Action               `json:"actions,omitempty"`
}
# AI Integration with LangChain
go// internal/ai/intent_detector.go
type IntentDetector struct {
    llm     llms.Model
    memory  memory.Buffer
    tools   []tools.Tool
}

type Intent struct {
    Type            string   // "search_sharepoint", "query_jira", "general_question"
    RequiredTools   []string // ["microsoft_graph", "jira_api"]
    Confidence      float64
    ExtractedParams map[string]interface{}
}

// Using LangChain for intent detection
func (id *IntentDetector) DetectIntent(message string, context map[string]interface{}) (*Intent, error) {
    // Create chain with LangChain
    chain := chains.NewLLMChain(
        id.llm,
        prompts.NewPromptTemplate(
            `Analyze the user message and determine:
            1. What systems/tools are needed
            2. What the user is trying to accomplish
            3. Extract any parameters
            
            User message: {{.message}}
            Context: {{.context}}
            
            Respond in JSON format with: type, required_tools, confidence, params`,
            []string{"message", "context"},
        ),
    )
    
    // Execute chain
    result, err := chain.Call(context)
    // Parse and return Intent
}
# Multi-Tenant OAuth Management
go// internal/services/oauth_service.go
type OAuthService struct {
    db         *gorm.DB
    encryption *EncryptionService
    redis      *redis.Client
}

func (s *OAuthService) GetAuthURL(userID, provider, orgID string) (string, string, error) {
    // 1. Load organization's OAuth config
    var oauthProvider OAuthProvider
    err := s.db.Where("organization_id = ? AND provider_type = ?", orgID, provider).First(&oauthProvider).Error
    
    // 2. Decrypt client credentials
    clientID := s.encryption.Decrypt(oauthProvider.ClientID)
    
    // 3. Generate session ID for state
    sessionID := uuid.New().String()
    
    // 4. Store session in Redis with context
    sessionData := map[string]interface{}{
        "user_id": userID,
        "org_id":  orgID,
        "provider": provider,
    }
    s.redis.Set(ctx, "oauth_session:"+sessionID, sessionData, 5*time.Minute)
    
    // 5. Build OAuth URL based on provider
    config := &oauth2.Config{
        ClientID:     clientID,
        ClientSecret: s.encryption.Decrypt(oauthProvider.ClientSecret),
        RedirectURL:  fmt.Sprintf("%s/api/oauth/callback/%s", s.baseURL, provider),
        Scopes:       s.getProviderScopes(provider),
        Endpoint:     s.getProviderEndpoint(provider, oauthProvider.TenantID),
    }
    
    return config.AuthCodeURL(sessionID), sessionID, nil
}
API Endpoints
# REST API Definition
yaml# API Endpoints for Teams Bot Integration

POST /api/chat
  Description: Main chat endpoint for all channels
  Headers:
    - Authorization: Bearer {jwt_token}
  Body:
    {
      "message": "string",
      "user_id": "string",
      "channel": "teams|slack|web",
      "conversation_id": "string",
      "organization_id": "string",
      "metadata": {}
    }
  Response:
    {
      "type": "message|auth_required",
      "content": "string",
      "auth_url": "string",
      "session_id": "string"
    }

GET /api/oauth/callback/{provider}
  Description: OAuth callback handler
  Query Params:
    - code: OAuth authorization code
    - state: Session ID
  Response: HTML page with success/error message

POST /api/token/complete
  Description: Notify conversation to continue after auth
  Body:
    {
      "session_id": "string",
      "success": boolean
    }

GET /api/health
  Description: Health check endpoint
  Response:
    {
      "status": "healthy",
      "version": "1.0.0",
      "services": {
        "database": "connected",
        "redis": "connected"
      }
    }

# Admin Endpoints
GET /api/admin/organizations/{org_id}/providers
POST /api/admin/organizations/{org_id}/providers
PUT /api/admin/organizations/{org_id}/providers/{provider_id}
DELETE /api/admin/organizations/{org_id}/providers/{provider_id}

GET /api/admin/organizations/{org_id}/webhooks
POST /api/admin/organizations/{org_id}/webhooks
Testing Requirements
# Test Cases for Completion
go// tests/e2e/chat_test.go
func TestChatFlowWithoutAuth(t *testing.T) {
    // Test: General question without requiring authentication
    // Expected: Direct response without auth requirement
    
    request := ChatRequest{
        Message: "What is the weather today?",
        UserID: "test-user-123",
        Channel: "teams",
        OrganizationID: "org-123",
    }
    
    response := callChatAPI(request)
    assert.Equal(t, "message", response.Type)
    assert.NotEmpty(t, response.Content)
}

func TestChatFlowRequiringSharePoint(t *testing.T) {
    // Test: SharePoint query triggers auth flow
    // Expected: Auth required response with Microsoft OAuth URL
    
    request := ChatRequest{
        Message: "Search for vacation policy in SharePoint",
        UserID: "test-user-456",
        Channel: "teams",
        OrganizationID: "org-123",
    }
    
    response := callChatAPI(request)
    assert.Equal(t, "auth_required", response.Type)
    assert.Contains(t, response.AuthURL, "login.microsoftonline.com")
    assert.NotEmpty(t, response.SessionID)
}

func TestMultiTenantIsolation(t *testing.T) {
    // Test: Different organizations have different OAuth configs
    // Expected: Each org gets their own OAuth URL with their client_id
    
    // Setup two organizations with different OAuth configs
    setupTestOrganization("org-A", "clientA", "secretA")
    setupTestOrganization("org-B", "clientB", "secretB")
    
    // Request from Org A
    responseA := requestAuthURL("org-A", "microsoft")
    assert.Contains(t, responseA.AuthURL, "client_id=clientA")
    
    // Request from Org B
    responseB := requestAuthURL("org-B", "microsoft")
    assert.Contains(t, responseB.AuthURL, "client_id=clientB")
}

func TestOAuthCallbackFlow(t *testing.T) {
    // Test: Complete OAuth callback flow
    // Expected: Token stored and session resumed
    
    // 1. Create session
    sessionID := createOAuthSession("user-123", "org-123", "microsoft")
    
    // 2. Simulate OAuth callback
    callbackURL := fmt.Sprintf("/api/oauth/callback/microsoft?code=auth_code&state=%s", sessionID)
    response := httpGet(callbackURL)
    
    // 3. Verify token stored
    token := getStoredToken("user-123", "microsoft")
    assert.NotNil(t, token)
    
    // 4. Verify session cleared
    session := getRedisKey("oauth_session:" + sessionID)
    assert.Nil(t, session)
}

func TestN8NWebhookTrigger(t *testing.T) {
    // Test: Successful query triggers n8n webhook
    // Expected: n8n webhook called with correct parameters
    
    // Setup mock n8n server
    n8nMock := createN8NMock()
    defer n8nMock.Close()
    
    // Configure org with n8n webhook
    configureN8NWebhook("org-123", n8nMock.URL + "/webhook/test")
    
    // Send query requiring tool execution
    request := ChatRequest{
        Message: "Get my open Jira tickets",
        UserID: "user-with-token",
        Channel: "teams",
        OrganizationID: "org-123",
    }
    
    response := callChatAPI(request)
    
    // Verify n8n was called
    assert.Equal(t, 1, n8nMock.CallCount)
    assert.Contains(t, n8nMock.LastRequest.Body, "jira_search")
}
# Success Criteria Checklist
markdown## Go API Service Completion Checklist

### Core Functionality
- [ ] Multi-tenant database schema implemented
- [ ] Organization isolation working
- [ ] User management per organization
- [ ] JWT authentication implemented

### OAuth Management
- [ ] Multi-provider OAuth configuration (Microsoft, Atlassian, Slack)
- [ ] Per-organization OAuth credentials
- [ ] Token encryption/decryption working
- [ ] Refresh token mechanism implemented
- [ ] OAuth session management with Redis

### AI Integration
- [ ] LangChain integrated for intent detection
- [ ] Tool selection based on user message
- [ ] Context management across conversations
- [ ] Fallback for general questions

### API Endpoints
- [ ] /api/chat endpoint working
- [ ] OAuth callback handlers implemented
- [ ] Admin endpoints for provider management
- [ ] Health check endpoint

### n8n Integration
- [ ] Webhook configuration per organization
- [ ] Token passing to n8n
- [ ] Response handling from n8n

### Testing
- [ ] Unit tests for all services (>80% coverage)
- [ ] Integration tests for OAuth flow
- [ ] E2E tests for complete chat flow
- [ ] Multi-tenant isolation tests passing

### Security
- [ ] All tokens encrypted at rest
- [ ] Tenant isolation verified
- [ ] Rate limiting implemented
- [ ] Audit logging enabled

### Documentation
- [ ] API documentation generated
- [ ] Environment variables documented
- [ ] Setup instructions complete
Docker Setup
# Containerization
dockerfile# docker/Dockerfile
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o main cmd/api/main.go

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/main .
COPY --from=builder /app/migrations ./migrations
EXPOSE 8080
CMD ["./main"]
yaml# docker-compose.yml
version: '3.8'
services:
  api:
    build: 
      context: .
      dockerfile: docker/Dockerfile
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgres://user:pass@postgres:5432/ai_orchestrator
      - REDIS_URL=redis://redis:6379
    depends_on:
      - postgres
      - redis
      
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: ai_orchestrator
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - postgres_data:/var/lib/postgresql/data
      
  redis:
    image: redis:7-alpine
    
volumes:
  postgres_data:
