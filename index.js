const path = require('path');

const dotenv = require('dotenv');
// Import required bot configuration.
const ENV_FILE = path.join(__dirname, '.env');
dotenv.config({ path: ENV_FILE });

const express = require('express');

// Initialize Phoenix tracing for observability
const { initializePhoenix } = require('./phoenix');
initializePhoenix();

// Import required bot services.
// See https://aka.ms/bot-services to learn more about the different parts of a bot.
const {
    CloudAdapter,
    ConfigurationServiceClientCredentialFactory,
    createBotFrameworkAuthenticationFromConfiguration
} = require('botbuilder');

// This bot's main dialog.
const { EchoBot } = require('./bot');
const { azureOpenAIProxy } = require('./azure-openai-proxy');

// Create HTTP server
const server = express();
server.use(express.json());
server.use(express.urlencoded({ extended: true }));

const port = process.env.WORKOFLOW_PORT || 3978;
server.listen(port, () => {
    console.log(`\nServer listening on http://localhost:${port}`);
    console.log('\nGet Bot Framework Emulator: https://aka.ms/botframework-emulator');
    console.log('\nTo talk to your bot, open the emulator select "Open Bot"');
});

// Configure Bot Framework adapter
// Authentication is always disabled when LOAD_TEST_MODE=true
const isLoadTestMode = process.env.LOAD_TEST_MODE === 'true';

let adapter;
if (isLoadTestMode) {
    console.log('🧪 Bot Framework authentication DISABLED (LOAD_TEST_MODE)');
    // No authentication - for load testing
    const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
        MicrosoftAppId: '',
        MicrosoftAppPassword: '',
        MicrosoftAppType: '',
        MicrosoftAppTenantId: ''
    });
    const botFrameworkAuthentication = createBotFrameworkAuthenticationFromConfiguration(null, credentialsFactory);
    adapter = new CloudAdapter(botFrameworkAuthentication);
} else if (process.env.MicrosoftAppId && process.env.MicrosoftAppPassword) {
    console.log('🔐 Bot Framework authentication ENABLED');
    const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
        MicrosoftAppId: process.env.MicrosoftAppId,
        MicrosoftAppPassword: process.env.MicrosoftAppPassword,
        MicrosoftAppType: process.env.MicrosoftAppType,
        MicrosoftAppTenantId: process.env.MicrosoftAppTenantId
    });
    const botFrameworkAuthentication = createBotFrameworkAuthenticationFromConfiguration(null, credentialsFactory);
    adapter = new CloudAdapter(botFrameworkAuthentication);
} else {
    console.log('⚠️  Bot Framework authentication DISABLED (no credentials configured)');
    // No authentication - for local development without credentials
    const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
        MicrosoftAppId: '',
        MicrosoftAppPassword: '',
        MicrosoftAppType: '',
        MicrosoftAppTenantId: ''
    });
    const botFrameworkAuthentication = createBotFrameworkAuthenticationFromConfiguration(null, credentialsFactory);
    adapter = new CloudAdapter(botFrameworkAuthentication);
}

// Catch-all for errors.
const onTurnErrorHandler = async (context, error) => {
    // This check writes out errors to console log .vs. app insights.
    // NOTE: In production environment, you should consider logging this to Azure
    //       application insights.
    console.error(`\n [onTurnError] unhandled error: ${ error }`);

    // Send a trace activity, which will be displayed in Bot Framework Emulator
    await context.sendTraceActivity(
        'OnTurnError Trace',
        `${ error }`,
        'https://www.botframework.com/schemas/error',
        'TurnError'
    );

    // Send a message to the user
    await context.sendActivity('The bot encountered an error or bug.');
    await context.sendActivity('To continue to run this bot, please fix the bot source code.');
};

// Set the onTurnError for the singleton CloudAdapter.
adapter.onTurnError = onTurnErrorHandler;

// Create the main dialog.
const myBot = new EchoBot();

// Health check endpoint
server.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'workoflow-bot',
        port: process.env.WORKOFLOW_PORT || 3978
    });
});

// Phoenix telemetry test endpoint
server.get('/api/test-telemetry', async (req, res) => {
    const { getOpenAIClient } = require('./phoenix');

    console.log('[Phoenix Test] Testing Phoenix integration...');
    const openaiClient = getOpenAIClient();

    if (!openaiClient) {
        console.error('[Phoenix Test] OpenAI client not initialized');
        res.status(500).json({ error: 'Phoenix integration not initialized' });
        return;
    }

    try {
        // Make a simple test call that will be traced by Phoenix
        console.log('[Phoenix Test] Making test OpenAI call...');
        const response = await openaiClient.chat.completions.create({
            model: process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1',
            messages: [
                { role: "system", content: "You are a test assistant." },
                { role: "user", content: "Respond with 'Phoenix test successful'" }
            ],
            max_tokens: 10,
            temperature: 0
        });

        const testResponse = {
            message: 'Phoenix test successful',
            phoenixEnabled: process.env.PHOENIX_ENABLED === 'true',
            phoenixEndpoint: process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://localhost:6006',
            projectName: process.env.PHOENIX_PROJECT_NAME || 'workoflow-bot',
            phoenixUI: process.env.PHOENIX_COLLECTOR_ENDPOINT?.replace('/v1/traces', '') || 'http://localhost:6006',
            openaiResponse: response.choices[0]?.message?.content || 'No response',
            timestamp: new Date().toISOString()
        };

        console.log('[Phoenix Test] Test completed:', testResponse);
        res.json(testResponse);
    } catch (error) {
        console.error('[Phoenix Test] Error:', error.message);
        res.status(500).json({
            error: 'Phoenix test failed',
            message: error.message,
            phoenixEnabled: process.env.PHOENIX_ENABLED === 'true'
        });
    }
});

// Middleware to restrict /openai/* endpoints to localhost and Docker internal networks
function localhostOnly(req, res, next) {
    const remoteAddress = req.socket.remoteAddress || req.headers['x-forwarded-for'];

    // Check for localhost
    const isLocalhost = remoteAddress === '127.0.0.1' ||
                       remoteAddress === '::1' ||
                       remoteAddress === '::ffff:127.0.0.1' ||
                       remoteAddress === 'localhost';

    // Check for Docker bridge network IPs (172.16.0.0/12)
    // Extract IPv4 from IPv6-mapped format (::ffff:172.18.0.1 -> 172.18.0.1)
    let ipv4Address = remoteAddress;
    if (remoteAddress && remoteAddress.startsWith('::ffff:')) {
        ipv4Address = remoteAddress.substring(7);
    }

    const isDockerNetwork = ipv4Address && ipv4Address.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/);

    if (!isLocalhost && !isDockerNetwork) {
        console.warn(`[Security] Blocked /openai/* request from non-localhost IP: ${remoteAddress}`);
        res.status(403).json({
            error: 'Forbidden',
            message: 'Access to /openai/* endpoints is restricted to localhost and Docker internal networks only'
        });
        return;
    }

    next();
}

// Azure OpenAI proxy endpoint - mimics Azure OpenAI's URL structure
// Handles all HTTP methods (GET, POST, PUT, DELETE, etc.)
// Apply localhost restriction before handling requests
server.options('/openai/*', localhostOnly, (req, res) => {
    // Handle CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, api-key, azure-endpoint');
    res.sendStatus(200);
});

// Route all Azure OpenAI requests through the proxy
// Apply localhost restriction to all methods
server.get('/openai/*', localhostOnly, azureOpenAIProxy);
server.post('/openai/*', localhostOnly, azureOpenAIProxy);
server.put('/openai/*', localhostOnly, azureOpenAIProxy);
server.delete('/openai/*', localhostOnly, azureOpenAIProxy);
server.patch('/openai/*', localhostOnly, azureOpenAIProxy);

// Listen for incoming requests.
server.post('/api/messages', async (req, res) => {
    // Route received a request to adapter for processing
    await adapter.process(req, res, (context) => myBot.run(context));
});

// Listen for Upgrade requests for Streaming.
server.on('upgrade', async (req, socket, head) => {
    // Create an adapter scoped to this WebSocket connection to allow storing session data.
    const streamingAdapter = new CloudAdapter(botFrameworkAuthentication);

    // Set onTurnError for the CloudAdapter created for each connection.
    streamingAdapter.onTurnError = onTurnErrorHandler;

    await streamingAdapter.process(req, socket, head, (context) => myBot.run(context));
});
