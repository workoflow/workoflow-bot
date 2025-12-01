# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 2025-12-01

### Added
- Multi-model support for GPT-4.1 and GPT-5-mini
  - Both Azure OpenAI configurations documented in `.env.dist`
  - Switch models by commenting/uncommenting config blocks
  - Model-aware parameter handling in proxy (GPT-5 params only for GPT-5)
  - Startup validation for required Azure OpenAI environment variables

### Changed
- Replaced manual typing indicator with Bot Framework ShowTypingMiddleware
  - Typing now appears within 200ms of receiving a message (was ~5+ seconds)
  - Uses official ShowTypingMiddleware for automatic handling
  - Removed manual setInterval/clearInterval code from bot.js
- Removed hardcoded model fallbacks from bot.js, index.js, test-proxy.js
  - All Azure OpenAI config now requires explicit environment variables

## 2025-11-28

### Added
- Typing indicator for MS Teams chat
  - Shows "..." animation while waiting for webhook response
  - Sends typing activity every 3 seconds to keep indicator active during long processing
  - Properly cleans up interval in finally block to prevent memory leaks

## 2025-11-27

### Changed
- Upgraded Azure OpenAI model from GPT-4.1 to GPT-5-mini
  - Added `reasoning_effort` parameter support (low/medium/high)
  - Default reasoning effort set to `medium` for better tool selection with many tools
  - Auto-converts `max_tokens` to `max_completion_tokens` for GPT-5 compatibility
  - Added reasoning token logging for observability
- Removed `OPENAI_CONCISENESS_ENABLED` and `OPENAI_CONCISENESS_INSTRUCTION` env vars
  - GPT-5-mini uses native `reasoning_effort` parameter instead of prompt injection
- Updated `.env.dist` with new Azure OpenAI endpoint and GPT-5-mini configuration

## 2025-11-25

### Fixed
- Chat sometimes displaying raw JSON instead of formatted message
  - Added recursive unwrapping for double-encoded JSON responses from n8n
  - Bot now correctly extracts message text when AI outputs JSON as text
  - Handles up to 3 levels of JSON nesting for robustness
  - Preserves attachment URLs from any nesting level

## 2025-10-31

### Changed
- Migrated web server from Restify to Express
  - Replaced `restify@11.1.0` with `express@4.21.2`
  - Eliminates DEP0111 deprecation warnings caused by Restify's SPDY dependency
  - Updated all route handlers to use Express syntax
  - Changed response methods from `res.send(status, data)` to `res.status(status).json(data)`
  - Updated middleware: `restify.plugins.bodyParser()` → `express.json()` and `express.urlencoded()`
  - Modified OPTIONS handler from `server.opts()` to `server.options()`
  - Updated DELETE handler from `server.del()` to `server.delete()`
  - Fixed deprecated `req.connection.remoteAddress` to `req.socket.remoteAddress`
  - All functionality preserved including Bot Framework integration and Phoenix tracing

### Improved
- **Simplified configuration for load testing**
  - Cleaned up `.env` file - removed commented multi-environment sections (#PROD, #STAGE, #DEV)
  - Consolidated Microsoft App credentials to single clean section
  - Added clear comment indicating credentials not needed when `LOAD_TEST_MODE=true`
  - Improved `.env.dist` template - removed environment-specific comments
  - Better documentation of `LOAD_TEST_MODE` purpose and usage

### Technical Details
- Configuration now emphasizes single unified approach
- `LOAD_TEST_MODE=true` bypasses Bot Framework authentication for load testing
- Cleaner, more maintainable environment configuration files

## 2025-10-29

### Fixed
- Bot Framework Emulator compatibility for status bar and magic link display
  - Fixed conversation type detection to handle `undefined` conversationType
  - Status bar, tips, and magic link now display correctly in Bot Framework Emulator
  - Added `isGroup` check to explicitly exclude group conversations
  - Improved logging to show full conversation details for debugging

## 2025-10-28

### Security
- Added localhost-only restriction to `/openai/*` endpoints
  - Middleware now blocks all non-localhost requests to Azure OpenAI proxy endpoints
  - Allows access from localhost (127.0.0.1, ::1, ::ffff:127.0.0.1) and Docker internal networks (172.16.0.0/12)
  - Docker containers can access via both host.docker.internal and direct bridge network IPs
  - Returns 403 Forbidden with clear error message for unauthorized access attempts
  - Logs all blocked requests with source IP for security monitoring
  - Other endpoints (/api/messages, /api/health) remain accessible externally

## 2025-10-21

### Fixed
- Error message formatting in Teams/Slack chat interfaces
  - Added proper newlines (`\n\n` instead of `\n`) to error message bullet points
  - Fixes issue where "Possible causes" bullet points were rendered on a single line
  - Each bullet point now displays on its own line for better readability

## 2025-10-20

### Changed
- Improved user experience in group chats by removing unnecessary UI elements
  - Tips are now only shown in personal (1:1) conversations
  - Azure OpenAI rate limit status bar is now only shown in personal conversations
  - Group chat loading messages now display only the base loading message without extra information
  - Updated logging to indicate when tips and status bars are skipped for non-personal conversations
- Enhanced webhook payload with consistent custom data structure
  - `custom` property is now always included in webhook payloads sent to n8n
  - Extended user information (including email) is now fetched for all messages, not just thread replies
  - Non-thread messages receive custom data with null thread properties but populated user and conversation details
  - Ensures consistent payload structure for easier n8n workflow parsing
- Improved magic link generation with real user email
  - Magic link API now receives the actual user's email address from Microsoft Teams
  - Extended user information is fetched early to provide email for registration
  - Added email parameter to `registerUserAndGetMagicLink()` function
  - Better logging to track email usage in registration requests

## 2025-10-17

### Changed
- **BREAKING**: Magic link generation now uses Registration API instead of local JWT tokens
  - Bot now calls Workoflow's `/api/register` endpoint to create users immediately
  - Users are created in the database when the bot generates the link, not when clicked
  - Magic link generation is now asynchronous and requires API credentials
  - Better error handling with specific error messages for different failure scenarios
- Updated Teams app manifest version from 1.0.4 to 1.0.5
- Enhanced bot.js with Teams-specific functionality imports (TeamsInfo, ConnectorClient)
- Replaced local magic link generation with API-based approach in bot.js

### Added
- New `register-api.js` module for API-based user registration
  - `registerUserAndGetMagicLink()` function for full control over registration
  - `generateMagicLinkViaAPI()` function for backward compatibility
  - Support for organization name configuration
  - Returns user ID, email, and organization details along with magic link
- New environment variables for API authentication:
  - `WORKOFLOW_API_USER` - API username for Basic Auth
  - `WORKOFLOW_API_PASSWORD` - API password for Basic Auth
- Channel information extraction and association
  - Bot now extracts channel information from Teams conversation context
  - Passes channel UUID and name to registration API for user grouping
  - Users are automatically associated with their Teams channel
- Thread detection and enrichment functionality
  - `isThreadReply()` function to detect thread replies in Teams messages
  - `extractThreadMessageId()` to extract message IDs from thread replies
  - Support for HTML attachment parsing with Schema.org Reply type detection
  - Enhanced payload sent to n8n with thread context and custom data
- Extended user information fetching
  - `fetchExtendedUserInfo()` function using TeamsInfo API
  - Retrieves detailed user profiles including team context
  - Enriches thread replies with complete user information
- New `test-thread-detection.js` test script for thread detection verification
- New dependency: `botframework-connector@^4.23.3` for Teams-specific APIs
- Comprehensive error handling for API failures, timeouts, and authentication issues

### Security
- Magic link generation restricted to personal chats only
  - Added `conversationType` check before generating magic links
  - Magic links are now only generated when `conversationType === 'personal'`
  - Group chats and channels no longer receive magic links
  - Prevents exposure of personal integration links in shared conversations
  - Logs indication when magic link generation is skipped for non-personal conversations

### Deprecated
- Local JWT generation in `generate-magic-link.js` (kept for backward compatibility)
- `MAGIC_LINK_SECRET` environment variable (no longer needed with API approach)

### Removed
- Deleted `deploy/deploy-stage.zip` (replaced with deploy-staging.zip)

## 2025-10-16

### Fixed
- Fixed n8n response parsing for nested JSON structure
  - N8n webhook now returns `output` field containing stringified JSON
  - Updated parsing logic to handle the nested JSON structure properly
  - Bot now correctly extracts message and attachment URLs from the parsed response
  - Removed backward compatibility for old array-based response format

### Added
- New deployment configuration for staging and production environments
  - Added `deploy/deploy-stage.zip` for staging deployments
  - Created `deploy/manifest.prod.json` for production Teams app configuration
  - Added `stop` script in package.json to gracefully terminate process on port 3978

### Changed
- Updated Teams app manifest configuration
  - Changed app ID from `224ba22b-cdfb-4fca-9e3b-f5b3051c73b4` to `9bc8ed66-8b19-4afc-bcac-29dca5e41d10`
  - Updated bot ID to `9aab910c-cfab-4366-b2c0-bbb364e1b1bc`
  - Removed authorization permissions section from manifest
  - Bumped manifest version from 1.0.3 to 1.0.4

## 2025-09-23

### Fixed (Critical)
- Fixed PM2 cluster mode causing feedback to appear multiple times
  - Changed Dockerfile from `-i max` to `-i 1` to run single process
  - Multiple PM2 workers were causing each request to hit different process with separate memory
  - This was the root cause of feedback appearing on every message

## 2025-09-23

### Added
- Environment variable `FEEDBACK_ENABLED` to control feedback collection
  - Set to `false` to disable feedback prompts entirely
  - Defaults to `true` if not set (feedback enabled by default)

### Fixed
- Fixed feedback prompt appearing after every response instead of once per day
  - Added `feedbackPrompted` field to track when feedback card has been shown
  - Updated `shouldAskForFeedback()` to check both `feedbackPrompted` and `feedbackGiven` flags
  - Added `markFeedbackPrompted()` function to properly track feedback card display
  - Changed bot.js to call `markFeedbackPrompted()` instead of `markUserInteraction()` when showing feedback
  - Added debug logging to track feedback state and user IDs
  - Fixed userId consistency issues between feedback prompt and submission

## 2025-09-12

### Fixed
- Phoenix integration now properly traces OpenAI calls
  - Resolved issue where N8N was bypassing instrumented client
  - Fixed bot.js to use exported OpenAI client from phoenix.js
  - Restored rate limit status bar functionality alongside Phoenix tracing
  - Fixed async/await handler issue in Restify for test endpoint
  
### Changed
- Updated README-PHOENIX.md with critical N8N configuration instructions
  - N8N must use bot's proxy endpoint (http://bot-host:3978/openai/*) instead of direct Azure OpenAI
  - Added troubleshooting steps for trace visibility
- Modified bot.js to support both rate limit monitoring and Phoenix instrumentation
  - Rate limit checks use direct API calls for header access
  - Main OpenAI operations use instrumented client via proxy
  
### Added
- Phoenix test endpoint at `/api/test-telemetry` for integration verification

## 2025-09-11

### Added
- Azure OpenAI proxy endpoint for n8n integration
  - New `/api/azure-openai/*` endpoint to proxy requests to Azure OpenAI
  - Created `azure-openai-proxy.js` module for request forwarding and logging
  - Support for using n8n's api-key header or fallback to bot's environment variables  
  - Logs token usage and request details for monitoring
  - Forwards rate limit headers back to n8n
  - CORS support for cross-origin requests
  - Test script `test-proxy.js` for verification
- Enhanced logging for Azure OpenAI proxy to track tool usage
  - Logs tools/functions provided in requests
  - Logs tool calls made by the AI in responses
  - Detailed token usage breakdown (prompt/completion/total)
  - Optional environment variables for debug logging (LOG_FULL_REQUEST, LOG_FULL_RESPONSE, LOG_TOOL_ARGUMENTS, SHOW_COST_ESTIMATE)
  - Shows finish reason and refusal messages

### Changed
- Refactored proxy to use root-level `/openai/*` endpoints instead of `/api/azure-openai/*`
  - Proxy now mimics Azure OpenAI's exact URL structure for n8n compatibility
  - Simplified path handling in proxy middleware
  - Updated test script to use new endpoint structure

### Fixed
- Corrected Restify route patterns from `/.*` to `/*` for proper wildcard matching in Restify 7.x

## 2025-09-09

### Added
- Magic link authentication integration in bot messages
  - Added `generate-magic-link.js` module for JWT-based magic link generation
  - Integrated magic link with "Manage your Integrations" hyperlink in bot thinking messages
  - Magic link uses Teams tenant ID as organization UUID dynamically
  - Links expire after 24 hours for security
  - Support for user email and name extraction from Teams context
- Azure OpenAI rate limit status bar
  - Real-time monitoring of API rate limits
  - Visual progress bars showing request and token usage
  - Displays model name, region, and usage percentages
  - Format: `gpt-4.1 (Germany West Central) • [████████░░] 99% (RLR) • [████████░░] 99% (RLT)`

### Changed
- Enhanced bot loading messages with clickable integration management links
- Loading messages now include magic link for direct access to Workoflow platform
- Loading messages now display Azure OpenAI rate limit status below magic link

### Security
- JWT tokens for magic links use HS256 algorithm with configurable secret
- Magic link secret stored in environment variables
- Azure OpenAI API key stored in environment variables
## 2025-09-18

### Added
- User feedback system with adaptive cards
  - Interactive feedback card with Bad/Fine/Good rating options
  - Daily feedback prompt on first interaction
  - Feedback submission to dedicated webhook endpoint
  - Feedback tracking module to manage user interaction state

### Changed
- Enhanced magic link generation with workflow user ID support
  - Added AAD Object ID mapping for user identification
  - Updated tenant ID for development environment
  - Added fallback values for missing user context properties
  - Improved JWT payload structure with workflow_user_id field

### Technical
- Modified bot.js to extract and pass AAD Object ID to magic link generator
- Updated generateMagicLink function signature to accept workflowUserId parameter
- Added feedback-tracker module dependency for session management
- Integrated CardFactory from botbuilder for adaptive card creation
