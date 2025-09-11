const { getOpenAIClient } = require('./phoenix');

// Azure OpenAI configuration from environment
const DEFAULT_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1';

/**
 * Azure OpenAI proxy middleware
 * Simple proxy that uses the instrumented OpenAI client for automatic Phoenix tracing
 * All telemetry is handled automatically by OpenInference instrumentation
 */
async function azureOpenAIProxy(req, res) {
    try {
        const originalPath = req.url;
        
        // Basic logging
        console.log(`[Azure OpenAI Proxy] ${new Date().toISOString()}`);
        console.log(`  Method: ${req.method}`);
        console.log(`  Path: ${originalPath}`);
        
        // Get the instrumented OpenAI client
        const openaiClient = getOpenAIClient();
        
        if (!openaiClient) {
            console.error('[Azure OpenAI Proxy] Failed to get OpenAI client');
            res.send(500, { error: 'Failed to initialize OpenAI client' });
            return;
        }
        
        // Route to appropriate handler based on path
        if (originalPath.includes('/chat/completions')) {
            await handleChatCompletions(req, res, openaiClient);
        } else if (originalPath.includes('/completions')) {
            await handleCompletions(req, res, openaiClient);
        } else if (originalPath.includes('/embeddings')) {
            await handleEmbeddings(req, res, openaiClient);
        } else {
            res.send(404, { error: `Endpoint ${originalPath} not supported` });
        }
        
    } catch (error) {
        console.error('[Azure OpenAI Proxy] Error:', error.message);
        res.send(500, {
            error: 'Proxy error',
            message: error.message
        });
    }
}


/**
 * Handle chat completions - Phoenix automatically traces this
 */
async function handleChatCompletions(req, res, openaiClient) {
    try {
        // Force non-streaming for n8n compatibility
        if (req.body.stream) {
            req.body.stream = false;
            delete req.body.stream_options;
        }
        
        // Extract user's input message for Phoenix display
        let userInput = '';
        if (req.body.messages && req.body.messages.length > 0) {
            // Find the last user message
            const userMessages = req.body.messages.filter(msg => msg.role === 'user');
            if (userMessages.length > 0) {
                userInput = userMessages[userMessages.length - 1].content || '';
            }
        }
        
        // Make the request using instrumented client (Phoenix will automatically trace this)
        const response = await openaiClient.chat.completions.create({
            ...req.body,
            model: req.body.model || DEFAULT_DEPLOYMENT
        });
        
        // Extract assistant's output for Phoenix display
        let assistantOutput = '';
        if (response.choices && response.choices.length > 0 && response.choices[0].message) {
            assistantOutput = response.choices[0].message.content || '';
        }
        
        // Ensure n8n compatibility (content must exist)
        if (response.choices) {
            response.choices.forEach(choice => {
                if (choice.message && choice.message.content === null) {
                    choice.message.content = '';
                }
            });
        }
        
        // Log basic info including input/output for debugging
        console.log(`  User Input: ${userInput.substring(0, 100)}${userInput.length > 100 ? '...' : ''}`);
        console.log(`  Assistant Output: ${assistantOutput.substring(0, 100)}${assistantOutput.length > 100 ? '...' : ''}`);
        if (response.usage) {
            console.log(`  Tokens: ${response.usage.total_tokens} total`);
        }
        
        
        res.send(200, response);
        
    } catch (error) {
        handleError(res, error);
    }
}

/**
 * Handle completions - Phoenix automatically traces this
 */
async function handleCompletions(req, res, openaiClient) {
    try {
        const response = await openaiClient.completions.create({
            ...req.body,
            model: req.body.model || DEFAULT_DEPLOYMENT
        });
        
        if (response.usage) {
            console.log(`  Tokens: ${response.usage.total_tokens} total`);
        }
        
        res.send(200, response);
        
    } catch (error) {
        handleError(res, error);
    }
}

/**
 * Handle embeddings - Phoenix automatically traces this
 */
async function handleEmbeddings(req, res, openaiClient) {
    try {
        const response = await openaiClient.embeddings.create({
            ...req.body,
            model: req.body.model || 'text-embedding-ada-002'
        });
        
        if (response.usage) {
            console.log(`  Tokens: ${response.usage.total_tokens} total`);
        }
        
        res.send(200, response);
        
    } catch (error) {
        handleError(res, error);
    }
}

/**
 * Handle errors consistently
 */
function handleError(res, error) {
    console.error('[Azure OpenAI Proxy] Error:', error.message);
    
    // Return error in OpenAI format
    if (error.status) {
        res.send(error.status, {
            error: {
                message: error.message,
                type: error.type || 'invalid_request_error',
                code: error.code || null
            }
        });
    } else {
        res.send(500, {
            error: {
                message: error.message,
                type: 'proxy_error',
                code: null
            }
        });
    }
}

module.exports = { azureOpenAIProxy };