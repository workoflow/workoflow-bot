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
        // Extract the path - we now only handle /openai/* paths
        const originalPath = req.url; // Will be /openai/deployments/...
        
        // Get credentials - prefer from request headers, fallback to env
        const apiKey = req.headers['api-key'] || DEFAULT_AZURE_API_KEY;
        const endpoint = req.headers['azure-endpoint'] || DEFAULT_AZURE_ENDPOINT;
        
        if (!apiKey) {
            console.error('No API key provided in request or environment');
            res.send(400, { error: 'API key is required. Provide via api-key header or AZURE_OPENAI_API_KEY env variable' });
            return;
        }
        
        // Build the target URL - simple concatenation since path already has /openai/
        let targetUrl = `${endpoint}${originalPath}`;
        
        // Ensure API version is in the URL if not present
        if (!targetUrl.includes('api-version=')) {
            const separator = targetUrl.includes('?') ? '&' : '?';
            targetUrl = `${targetUrl}${separator}api-version=${DEFAULT_API_VERSION}`;
        }
        
        // Log the proxy request
        console.log(`[Azure OpenAI Proxy] ${new Date().toISOString()}`);
        console.log(`  Method: ${req.method}`);
        console.log(`  Target URL: ${targetUrl}`);
        console.log(`  Has API Key: ${!!apiKey}`);
        
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
        console.log(`  Response Status: ${response.status}`);
        if (response.headers['x-ms-deployment-name']) {
            console.log(`  Deployment: ${response.headers['x-ms-deployment-name']}`);
        }
        if (response.data && response.data.usage) {
            console.log(`  Token Usage:`, response.data.usage);
        }
        
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
