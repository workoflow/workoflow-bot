const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { Resource } = require('@opentelemetry/resources');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { SimpleSpanProcessor, BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OpenAIInstrumentation } = require('@arizeai/openinference-instrumentation-openai');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
const { SEMRESATTRS_PROJECT_NAME } = require('@arizeai/openinference-semantic-conventions');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');
const OpenAI = require('openai');

let openaiClient = null;
let isInitialized = false;
let tracerProvider = null;

/**
 * Initialize Phoenix tracing for OpenAI
 * Production-ready setup with proper error handling and diagnostics
 */
function initializePhoenix() {
    if (isInitialized) {
        return openaiClient;
    }
    
    // Check if Phoenix is enabled
    const phoenixEnabled = process.env.PHOENIX_ENABLED === 'true';
    
    // Check if Azure OpenAI credentials are available
    if (!process.env.AZURE_OPENAI_API_KEY) {
        console.error('[Phoenix] AZURE_OPENAI_API_KEY not set');
        return null;
    }
    
    // Create OpenAI client for Azure (this will be instrumented if Phoenix is enabled)
    openaiClient = new OpenAI({
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
        defaultQuery: { 'api-version': process.env.AZURE_OPENAI_API_VERSION },
        defaultHeaders: { 'api-key': process.env.AZURE_OPENAI_API_KEY }
    });
    
    if (!phoenixEnabled) {
        console.log('[Phoenix] Tracing disabled. Set PHOENIX_ENABLED=true to enable.');
        isInitialized = true;
        return openaiClient;
    }
    
    try {
        // Enable diagnostic logging for troubleshooting
        const debugMode = process.env.PHOENIX_DEBUG === 'true';
        if (debugMode) {
            diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
            console.log('[Phoenix] Debug mode enabled');
        } else {
            diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);
        }
        
        // Configure resource with OpenInference semantic conventions
        const resource = new Resource({
            [SEMRESATTRS_PROJECT_NAME]: process.env.PHOENIX_PROJECT_NAME || 'workoflow-bot',
            [ATTR_SERVICE_NAME]: 'workoflow-bot',
            'service.version': process.env.npm_package_version || '1.0.0',
            'deployment.environment': process.env.NODE_ENV || 'development'
        });
        
        // Create tracer provider
        tracerProvider = new NodeTracerProvider({ resource });
        
        // Configure collector endpoint
        const collectorEndpoint = process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://localhost:6006';
        const exporterUrl = `${collectorEndpoint}/v1/traces`;
        
        console.log(`[Phoenix] Connecting to collector at: ${exporterUrl}`);
        
        // Configure HTTP exporter for Phoenix
        const exporter = new OTLPTraceExporter({
            url: exporterUrl,
            headers: {
                // Add API key if Phoenix Cloud or authenticated self-hosted
                ...(process.env.PHOENIX_API_KEY && {
                    'Authorization': `Bearer ${process.env.PHOENIX_API_KEY}`
                })
            },
            // Timeout configuration
            timeoutMillis: 10000
        });
        
        // Choose span processor based on environment
        const isDevelopment = process.env.NODE_ENV !== 'production';
        if (isDevelopment) {
            // SimpleSpanProcessor for immediate export in development
            tracerProvider.addSpanProcessor(new SimpleSpanProcessor(exporter));
            console.log('[Phoenix] Using SimpleSpanProcessor (development mode)');
        } else {
            // BatchSpanProcessor for better performance in production
            tracerProvider.addSpanProcessor(new BatchSpanProcessor(exporter, {
                maxQueueSize: 2048,
                maxExportBatchSize: 512,
                scheduledDelayMillis: 5000,
                exportTimeoutMillis: 30000
            }));
            console.log('[Phoenix] Using BatchSpanProcessor (production mode)');
        }
        
        // Register the tracer provider
        tracerProvider.register();
        
        // Create and register OpenAI instrumentation
        const instrumentation = new OpenAIInstrumentation({
            // Optional: Configure instrumentation options
            captureMessageContent: true
        });
        
        // Manually instrument OpenAI class
        instrumentation.manuallyInstrument(OpenAI);
        
        // Register the instrumentation
        registerInstrumentations({
            instrumentations: [instrumentation],
        });
        
        console.log('[Phoenix] ✅ OpenAI instrumentation registered');
        
        // Validate connection by creating a test span (optional)
        if (process.env.PHOENIX_TEST_CONNECTION === 'true') {
            testPhoenixConnection();
        }
        
        console.log('[Phoenix] ✅ Tracing enabled successfully');
        console.log(`[Phoenix] 📊 View traces at: ${collectorEndpoint.replace('/v1/traces', '')}`);
        isInitialized = true;
        
    } catch (error) {
        console.error('[Phoenix] ❌ Failed to initialize:', error.message);
        console.error('[Phoenix] Stack trace:', error.stack);
        // Return client without instrumentation on error
        isInitialized = true;
    }
    
    return openaiClient;
}

/**
 * Test Phoenix connection by creating a test span
 */
async function testPhoenixConnection() {
    try {
        const tracer = tracerProvider.getTracer('phoenix-test');
        const span = tracer.startSpan('phoenix.connection.test');
        span.setAttribute('test.type', 'connection-validation');
        span.setAttribute('phoenix.project.name', process.env.PHOENIX_PROJECT_NAME || 'workoflow-bot');
        span.end();
        console.log('[Phoenix] ✅ Connection test span sent');
    } catch (error) {
        console.error('[Phoenix] ⚠️  Connection test failed:', error.message);
    }
}

/**
 * Get the OpenAI client (with or without tracing)
 */
function getOpenAIClient() {
    if (!openaiClient) {
        return initializePhoenix();
    }
    return openaiClient;
}

/**
 * Gracefully shutdown tracing
 */
async function shutdownPhoenix() {
    if (tracerProvider) {
        try {
            await tracerProvider.shutdown();
            console.log('[Phoenix] Tracing shutdown complete');
        } catch (error) {
            console.error('[Phoenix] Error during shutdown:', error.message);
        }
    }
}

// Handle process termination
process.on('SIGTERM', shutdownPhoenix);
process.on('SIGINT', shutdownPhoenix);

module.exports = {
    initializePhoenix,
    getOpenAIClient,
    shutdownPhoenix
};