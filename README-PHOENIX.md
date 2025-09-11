# Phoenix Observability Integration

This application includes integration with Arize Phoenix for LLM observability and monitoring using the OpenInference instrumentation approach.

## Features

Phoenix provides comprehensive LLM observability with automatic instrumentation:

### Core Features
- **Automatic Tracing**: All OpenAI API calls are automatically traced without manual span creation
- **Token Usage Tracking**: Monitor prompt, completion, and total tokens per request
- **User Attribution**: Track usage by Teams user ID and session
- **Cost Analysis**: Real-time cost calculation based on latest Azure OpenAI pricing (2024)
- **Tool/Function Monitoring**: Track which tools and functions are being called
- **Rate Limit Monitoring**: Monitor Azure OpenAI rate limits
- **Performance Metrics**: Track latency, errors, and success rates
- **Interactive Dashboard**: Web-based UI for exploring traces and metrics

### Advanced Features (future implementation)
- **Hallucination Detection**: Automatic detection of hallucinated content
- **Q&A Correctness**: Evaluate answer correctness
- **Relevance Scoring**: Measure response relevance to prompts
- **Toxicity Detection**: Identify potentially harmful content
- **User Feedback**: Thumbs up/down feedback collection

## Architecture

```
Teams Bot → Azure OpenAI Proxy → Phoenix Collector → Phoenix Dashboard
                    ↓
          OpenInference Instrumentation
          (Automatic span creation)
```

## Quick Start

### 1. Start Phoenix with Docker

From the `workoflow-ai-setup` directory:

```bash
# Start all services including Phoenix
docker-compose up -d phoenix

# Or start everything
docker-compose up -d
```

### 2. Access Phoenix Dashboard

Open your browser and navigate to:
```
http://localhost:6006
```

### 3. Configure Environment

Ensure these variables are set in your `.env`:

```env
# Phoenix Observability
PHOENIX_ENABLED=true
PHOENIX_COLLECTOR_ENDPOINT=http://localhost:6006  # For local Phoenix
# PHOENIX_COLLECTOR_ENDPOINT=http://phoenix:6006   # For Docker
PHOENIX_PROJECT_NAME=workoflow-bot

# Optional: Enable debug logging
# PHOENIX_DEBUG=true
# PHOENIX_TEST_CONNECTION=true

# Optional: Enable cost estimates
SHOW_COST_ESTIMATE=true

# Optional: Detailed logging
LOG_FULL_REQUEST=false
LOG_FULL_RESPONSE=false
LOG_TOOL_ARGUMENTS=false
```

### 4. Start the Bot

```bash
npm start
```

Phoenix instrumentation will automatically initialize and start capturing traces.

## Implementation Details

### OpenInference Instrumentation

The new implementation uses the `@arizeai/openinference-instrumentation-openai` package which provides:
- Automatic instrumentation of all OpenAI SDK calls
- Proper OpenTelemetry semantic conventions
- No manual span creation needed
- Automatic error capture and reporting

### Key Files

- **phoenix.js**: Main Phoenix setup and OpenAI instrumentation with production-ready error handling
- **azure-openai-proxy.js**: Simplified proxy that uses the instrumented OpenAI client

## Telemetry Data Collected

Each request to Azure OpenAI automatically captures:

### User Context
- `user.id` - Teams user ID
- `user.name` - Teams user name
- `session.id` - Conversation/session ID
- `channel.id` - Teams channel ID
- `tenant.id` - Teams tenant ID

### Token Metrics
- `llm.token_count.prompt` - Input tokens
- `llm.token_count.completion` - Output tokens
- `llm.token_count.total` - Total tokens

### Cost Tracking (2024 Pricing)
- **GPT-4o**: $5/1M input, $15/1M output tokens
- **GPT-4o-mini**: $0.15/1M input, $0.60/1M output tokens
- Automatic cost calculation per request

### Tool Usage
- Tools provided in request
- Tools actually called
- Tool call arguments (if logging enabled)

### Rate Limiting
- Remaining API requests
- Remaining tokens
- Request and token limits

## Using Phoenix Features

### Viewing Traces

1. Navigate to http://localhost:6006
2. Select your project: `workoflow-teams-bot`
3. View traces in real-time
4. Click on any trace for detailed information

### Sending Feedback

Feedback and evaluation features are planned for future implementation.

### Evaluation Types

1. **Hallucination Detection**: Checks if the response contains fabricated information
2. **Q&A Correctness**: Evaluates if the answer is correct
3. **Relevance**: Measures how relevant the response is to the prompt
4. **Toxicity**: Detects potentially harmful content

## Troubleshooting

### No traces appearing in Phoenix

1. Check that Phoenix is running: `docker ps | grep phoenix`
2. Verify environment variables are set correctly
3. Check console logs for `[Phoenix]` messages
4. Ensure `PHOENIX_ENABLED=true` in your `.env` file
5. Try enabling debug mode with `PHOENIX_DEBUG=true`

### Connection errors

```bash
# For local development
PHOENIX_COLLECTOR_ENDPOINT=http://localhost:6006

# For Docker networking
PHOENIX_COLLECTOR_ENDPOINT=http://phoenix:6006

# For Phoenix Cloud
PHOENIX_COLLECTOR_ENDPOINT=https://app.phoenix.arize.com
PHOENIX_API_KEY=your-api-key
```

### Debugging

Enable detailed logging:
```env
# Enable Phoenix debug logging
PHOENIX_DEBUG=true
PHOENIX_TEST_CONNECTION=true

# Enable Azure OpenAI request/response logging
LOG_FULL_REQUEST=true
LOG_FULL_RESPONSE=true
SHOW_COST_ESTIMATE=true
```

## Migration from Manual Telemetry

The application has been migrated from manual telemetry to automatic OpenInference instrumentation:

### Old Approach (Deprecated)
- Manual span creation with `startSpan()`
- Manual attribute setting with `addLLMAttributes()`
- Complex error handling with `recordException()`

### New Approach (Current)
- Automatic instrumentation via OpenInference
- All OpenAI calls traced automatically
- Proper semantic conventions out of the box
- Simplified codebase (~200 lines removed)

### Benefits
- ✅ Cleaner code
- ✅ Better trace structure
- ✅ Automatic error capture
- ✅ Phoenix built-in features work properly
- ✅ Easier maintenance
- ✅ Better compatibility with Phoenix dashboard

## Cost Monitoring

The system now uses 2024 Azure OpenAI pricing:
- GPT-4o: $5 per million input tokens, $15 per million output tokens
- GPT-4o-mini: $0.15 per million input tokens, $0.60 per million output tokens

Enable cost estimates by setting:
```env
SHOW_COST_ESTIMATE=true
```

## Resources

- [Phoenix Documentation](https://docs.arize.com/phoenix)
- [OpenInference Specification](https://github.com/Arize-ai/openinference)
- [Azure OpenAI Pricing](https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/)
- [OpenTelemetry](https://opentelemetry.io/)