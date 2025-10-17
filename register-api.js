/**
 * Registration API Client for Microsoft Teams Bot
 *
 * This module handles user registration via the Workoflow Registration API.
 * Instead of generating JWT tokens locally, it calls the /api/register endpoint
 * which creates users immediately and returns a magic link for authentication.
 */

const axios = require('axios');

/**
 * Register a user via the Workoflow Registration API
 *
 * @param {string} name - User's name
 * @param {string} orgUuid - Organization UUID from Workoflow
 * @param {string} workflowUserId - The user's identifier for workflow (e.g., AAD Object ID)
 * @param {Object} config - Configuration object
 * @param {string} config.baseUrl - Base URL of Workoflow instance (e.g., 'https://yourdomain.com')
 * @param {string} config.apiUser - API username for Basic Auth
 * @param {string} config.apiPassword - API password for Basic Auth
 * @param {string} [config.orgName] - Optional organization name
 * @param {string} [config.channelUuid] - Optional channel UUID
 * @param {string} [config.channelName] - Optional channel name
 * @returns {Promise<Object>} - Registration result with magic link
 */
async function registerUserAndGetMagicLink(name, orgUuid, workflowUserId, config) {
    const { baseUrl, apiUser, apiPassword, orgName, channelUuid, channelName } = config;

    // Validate required parameters
    if (!name || !orgUuid || !workflowUserId) {
        throw new Error('Missing required parameters: name, orgUuid, and workflowUserId are required');
    }

    if (!baseUrl || !apiUser || !apiPassword) {
        throw new Error('Missing required configuration: baseUrl, apiUser, and apiPassword are required');
    }

    try {
        // Prepare request data
        const requestData = {
            name: name,
            org_uuid: orgUuid,
            workflow_user_id: workflowUserId
        };

        // Add optional org name if provided
        if (orgName) {
            requestData.org_name = orgName;
        }

        // Add optional channel parameters if provided
        if (channelUuid) {
            requestData.channel_uuid = channelUuid;
        }
        if (channelName) {
            requestData.channel_name = channelName;
        }

        // Make API request with Basic Auth
        const response = await axios.post(
            `${baseUrl}/api/register`,
            requestData,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic ' + Buffer.from(`${apiUser}:${apiPassword}`).toString('base64')
                },
                timeout: 10000 // 10 second timeout
            }
        );

        if (response.data.success) {
            console.log(`[Registration API] Successfully registered user: ${name} (${response.data.email})`);
            const result = {
                success: true,
                magicLink: response.data.magic_link,
                userId: response.data.user_id,
                email: response.data.email,
                organisation: response.data.organisation
            };

            // Include channel info if present in response
            if (response.data.channel) {
                result.channel = response.data.channel;
                console.log(`[Registration API] User added to channel: ${response.data.channel.name} (${response.data.channel.uuid})`);
            }

            return result;
        } else {
            throw new Error(response.data.error || 'Registration failed');
        }
    } catch (error) {
        // Handle different error types
        if (error.response) {
            // API returned an error response
            const errorMessage = error.response.data?.error || 'Unknown API error';
            console.error(`[Registration API] Error ${error.response.status}: ${errorMessage}`);

            if (error.response.status === 401) {
                throw new Error('Authentication failed. Check API credentials.');
            } else if (error.response.status === 400) {
                throw new Error(`Invalid request: ${errorMessage}`);
            } else {
                throw new Error(`Registration failed: ${errorMessage}`);
            }
        } else if (error.request) {
            // Request was sent but no response received
            console.error('[Registration API] No response from server');
            throw new Error('Unable to reach Workoflow server. Please check the URL and network connection.');
        } else {
            // Something else went wrong
            console.error('[Registration API] Error:', error.message);
            throw error;
        }
    }
}


// Example usage
async function exampleUsage() {
    // Configuration from environment variables
    const config = {
        baseUrl: process.env.MAGIC_LINK_DOMAIN || 'http://localhost:3979',
        apiUser: process.env.WORKOFLOW_API_USER || 'test_api_user',
        apiPassword: process.env.WORKOFLOW_API_PASSWORD || 'test_api_password',
        orgName: 'Example Organization', // Optional
        channelUuid: 'channel-123e4567-e89b-12d3-a456-426614174000', // Optional
        channelName: 'General Channel' // Optional
    };

    // User information (would come from Teams context)
    const userName = 'John Doe';
    const orgUuid = '123e4567-e89b-12d3-a456-426614174000';
    const workflowUserId = 'AAD-OBJECT-ID-12345'; // From Teams context

    try {
        console.log('Registering user via API...');
        const result = await registerUserAndGetMagicLink(
            userName,
            orgUuid,
            workflowUserId,
            config
        );

        console.log('Registration successful!');
        console.log('Magic Link:', result.magicLink);
        console.log('User Email:', result.email);
        console.log('Organization:', result.organisation.name);
        if (result.channel) {
            console.log('Channel:', result.channel.name);
        }

        // Use the magic link in Teams message/card
        return {
            type: 'message',
            text: `Welcome ${userName}! Click here to access Workoflow: ${result.magicLink}`,
            attachments: [{
                contentType: 'application/vnd.microsoft.card.adaptive',
                content: {
                    type: 'AdaptiveCard',
                    version: '1.3',
                    body: [{
                        type: 'TextBlock',
                        text: 'Access Workoflow Integration Platform',
                        size: 'Medium',
                        weight: 'Bolder'
                    }, {
                        type: 'TextBlock',
                        text: `Welcome, ${userName}!`,
                        wrap: true
                    }],
                    actions: [{
                        type: 'Action.OpenUrl',
                        title: 'Open Workoflow',
                        url: result.magicLink
                    }]
                }
            }]
        };
    } catch (error) {
        console.error('Failed to register user:', error.message);

        // Return error message for Teams
        return {
            type: 'message',
            text: `Unable to generate access link: ${error.message}`
        };
    }
}

// Export the main registration function
module.exports = {
    registerUserAndGetMagicLink
};

// Run example if executed directly
if (require.main === module) {
    console.log('\n=== Registration API Client Example ===\n');

    console.log('Required packages:');
    console.log('npm install axios\n');

    console.log('Required environment variables:');
    console.log('WORKOFLOW_API_USER=your_api_username');
    console.log('WORKOFLOW_API_PASSWORD=your_api_password');
    console.log('MAGIC_LINK_DOMAIN=https://your-workoflow-domain.com\n');

    console.log('Running example...\n');

    exampleUsage().then(result => {
        console.log('\nExample Teams message response:');
        console.log(JSON.stringify(result, null, 2));

        console.log('\n=== Key Features ===');
        console.log('1. API handles all token creation server-side');
        console.log('2. User is created immediately when API is called');
        console.log('3. API returns the complete magic link URL');
        console.log('4. Comprehensive error handling and validation');
        console.log('5. Supports organization name configuration');
        console.log('6. NEW: Channel association support for user grouping');
    }).catch(error => {
        console.error('Example failed:', error.message);
    });
}