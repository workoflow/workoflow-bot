const axios = require('axios');
require('dotenv').config();

// Test configuration
const PROXY_URL = 'http://localhost:3978/api/azure-openai';
const API_KEY = process.env.AZURE_OPENAI_API_KEY;
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1';
const API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';

async function testProxy() {
    console.log('Testing Azure OpenAI Proxy...\n');
    
    if (!API_KEY) {
        console.error('Error: AZURE_OPENAI_API_KEY not found in environment variables');
        process.exit(1);
    }
    
    try {
        // Test 1: Chat completions endpoint
        console.log('Test 1: Chat Completions');
        console.log('------------------------');
        const chatUrl = `${PROXY_URL}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;
        console.log(`URL: ${chatUrl}`);
        
        const response = await axios.post(chatUrl, {
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: 'Say "Hello from proxy test" in exactly 5 words.' }
            ],
            max_tokens: 50,
            temperature: 0
        }, {
            headers: {
                'api-key': API_KEY,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('Status:', response.status);
        console.log('Response:', JSON.stringify(response.data, null, 2));
        console.log('\nRate Limit Headers:');
        console.log('  Remaining Requests:', response.headers['x-ratelimit-remaining-requests']);
        console.log('  Remaining Tokens:', response.headers['x-ratelimit-remaining-tokens']);
        console.log('  Deployment:', response.headers['x-ms-deployment-name']);
        console.log('  Region:', response.headers['x-ms-region']);
        
        console.log('\n✅ Proxy test successful!');
        
    } catch (error) {
        console.error('\n❌ Test failed:');
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response Status:', error.response.status);
            console.error('Response Data:', error.response.data);
        }
        process.exit(1);
    }
}

// Run the test
console.log('Make sure the bot is running on port 3978 first!\n');
testProxy();