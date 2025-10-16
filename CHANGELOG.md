# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
