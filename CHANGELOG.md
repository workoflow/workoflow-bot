# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
