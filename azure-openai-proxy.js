const axios = require('axios');

// Azure OpenAI configuration from environment
const DEFAULT_AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || 'https://oai-cec-de-germany-west-central.openai.azure.com';
const DEFAULT_AZURE_API_KEY = process.env.AZURE_OPENAI_API_KEY || '';
const DEFAULT_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1';
const DEFAULT_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';

/**
 * Simple Azure OpenAI proxy middleware
 * Forwards requests to Azure OpenAI and returns responses
 */
async function azureOpenAIProxy(req, res) {
    try {
        let originalPath = req.url;
        
        const apiKey = req.headers['api-key'] || DEFAULT_AZURE_API_KEY;
        const endpoint = req.headers['azure-endpoint'] || DEFAULT_AZURE_ENDPOINT;
        
        if (!apiKey) {
            console.error('No API key provided in request or environment');
            res.send(400, { error: 'API key is required. Provide via api-key header or AZURE_OPENAI_API_KEY env variable' });
            return;
        }
        
        const cleanEndpoint = endpoint.replace(/\/+$/, '');
        let targetUrl = `${cleanEndpoint}${originalPath}`;
        
        // Ensure API version is in the URL if not present
        if (!targetUrl.includes('api-version=')) {
            const separator = targetUrl.includes('?') ? '&' : '?';
            targetUrl = `${targetUrl}${separator}api-version=${DEFAULT_API_VERSION}`;
        }
        
        // Log the proxy request
        console.log(`[Azure OpenAI Proxy] ${new Date().toISOString()}`);
        console.log(`  Method: ${req.method}`);
        console.log(`  Original Path: ${originalPath}`);
        console.log(`  Endpoint: ${cleanEndpoint}`);
        console.log(`  Target URL: ${targetUrl}`);
        console.log(`  Has API Key: ${!!apiKey}`);
        
        // Log request body details
        if (req.body && req.method === 'POST') {
            console.log('\n  === REQUEST BODY ===');
            
            // Check for tools/functions in the request
            if (req.body.tools && Array.isArray(req.body.tools)) {
                console.log(`  Tools provided: ${req.body.tools.length}`);
                req.body.tools.forEach(tool => {
                    if (tool.function && tool.function.name) {
                        console.log(`    - ${tool.function.name}`);
                    }
                });
            } else if (req.body.functions && Array.isArray(req.body.functions)) {
                // Legacy function calling format
                console.log(`  Functions provided: ${req.body.functions.length}`);
                req.body.functions.forEach(func => {
                    if (func.name) {
                        console.log(`    - ${func.name}`);
                    }
                });
            }
            
            // Log messages count
            if (req.body.messages && Array.isArray(req.body.messages)) {
                console.log(`  Messages: ${req.body.messages.length}`);
                
                // Check if any messages contain tool calls
                const toolCallMessages = req.body.messages.filter(msg => 
                    msg.tool_calls || msg.function_call
                );
                if (toolCallMessages.length > 0) {
                    console.log(`  Messages with tool calls: ${toolCallMessages.length}`);
                }
            }
            
            // Log other important parameters
            if (req.body.temperature !== undefined) {
                console.log(`  Temperature: ${req.body.temperature}`);
            }
            if (req.body.max_tokens !== undefined) {
                console.log(`  Max tokens: ${req.body.max_tokens}`);
            }
            if (req.body.tool_choice) {
                console.log(`  Tool choice: ${typeof req.body.tool_choice === 'string' ? req.body.tool_choice : JSON.stringify(req.body.tool_choice)}`);
            }
            
            // Optional: Log full request body for debugging (can be commented out in production)
            if (process.env.LOG_FULL_REQUEST === 'true') {
                console.log('\n  Full request body:');
                console.log(JSON.stringify(req.body, null, 2));
            }
        }
        
        // Prepare headers for Azure OpenAI
        const headers = {
            'api-key': apiKey,
            'Content-Type': 'application/json'
        };
        
        // Make the request to Azure OpenAI
        const response = await axios({
            method: req.method,
            url: targetUrl,
            data: req.body,
            headers: headers,
            validateStatus: null // Don't throw on any status code
        });
        
        // Log response info
        console.log('\n  === RESPONSE ===');
        console.log(`  Status: ${response.status}`);
        if (response.headers['x-ms-deployment-name']) {
            console.log(`  Deployment: ${response.headers['x-ms-deployment-name']}`);
        }
        
        // Check for tool calls in the response
        if (response.data && response.data.choices && Array.isArray(response.data.choices)) {
            response.data.choices.forEach((choice, index) => {
                if (choice.message) {
                    // Check for modern tool_calls format
                    if (choice.message.tool_calls && Array.isArray(choice.message.tool_calls)) {
                        console.log(`  Tool Calls: ${choice.message.tool_calls.length}`);
                        choice.message.tool_calls.forEach(toolCall => {
                            if (toolCall.function) {
                                console.log(`    - ${toolCall.function.name} (${toolCall.id})`);
                                // Log arguments if in debug mode
                                if (process.env.LOG_TOOL_ARGUMENTS === 'true') {
                                    console.log(`      Arguments: ${toolCall.function.arguments}`);
                                }
                            }
                        });
                    }
                    
                    // Check for legacy function_call format
                    if (choice.message.function_call) {
                        console.log(`  Function Call:`);
                        console.log(`    - ${choice.message.function_call.name}`);
                        if (process.env.LOG_TOOL_ARGUMENTS === 'true') {
                            console.log(`      Arguments: ${choice.message.function_call.arguments}`);
                        }
                    }
                    
                    // Check if this is a refusal
                    if (choice.message.refusal) {
                        console.log(`  Refusal: ${choice.message.refusal}`);
                    }
                }
                
                // Log finish reason
                if (choice.finish_reason) {
                    console.log(`  Finish reason: ${choice.finish_reason}`);
                }
            });
        }
        
        // Log token usage with more detail
        if (response.data && response.data.usage) {
            console.log(`  Token Usage:`);
            console.log(`    - Prompt tokens: ${response.data.usage.prompt_tokens}`);
            console.log(`    - Completion tokens: ${response.data.usage.completion_tokens}`);
            console.log(`    - Total tokens: ${response.data.usage.total_tokens}`);
            
            // Calculate cost estimate (optional)
            if (process.env.SHOW_COST_ESTIMATE === 'true') {
                // Approximate costs for GPT-4 (adjust based on your model)
                const promptCost = (response.data.usage.prompt_tokens / 1000) * 0.03;
                const completionCost = (response.data.usage.completion_tokens / 1000) * 0.06;
                console.log(`    - Estimated cost: $${(promptCost + completionCost).toFixed(4)}`);
            }
        }
        
        // Optional: Log full response for debugging
        if (process.env.LOG_FULL_RESPONSE === 'true') {
            console.log('\n  Full response:');
            console.log(JSON.stringify(response.data, null, 2));
        }
        
        console.log(''); // Empty line for readability
        
        // Set response headers
        res.setHeader('Content-Type', 'application/json');
        
        // Forward some useful headers from Azure
        const headersToForward = [
            'x-ratelimit-remaining-requests',
            'x-ratelimit-limit-requests', 
            'x-ratelimit-remaining-tokens',
            'x-ratelimit-limit-tokens',
            'x-ms-deployment-name',
            'x-ms-region'
        ];
        
        headersToForward.forEach(header => {
            if (response.headers[header]) {
                res.setHeader(header, response.headers[header]);
            }
        });
        
        // Return the response
        res.send(response.status, response.data);
        
    } catch (error) {
        console.error('[Azure OpenAI Proxy] Error:', error.message);
        if (error.response) {
            console.error('  Error Response:', error.response.data);
        }
        
        res.send(500, {
            error: 'Proxy error',
            message: error.message,
            details: error.response?.data
        });
    }
}

module.exports = { azureOpenAIProxy };
