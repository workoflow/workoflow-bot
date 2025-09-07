/**
 * Magic Link Generator for Microsoft Teams Bot
 * 
 * This script shows how to generate magic links from your Microsoft Teams bot
 * that will automatically authenticate users in the Workoflow platform.
 */

const jwt = require('jsonwebtoken');

/**
 * Generate a magic link for user authentication
 * 
 * @param {string} name - User's name
 * @param {string} orgUuid - Organization UUID from Workoflow
 * @param {string} baseUrl - Base URL of your Workoflow instance (e.g., 'https://yourdomain.com')
 * @param {string} secret - The MAGIC_LINK_SECRET from your .env file
 * @returns {string} - The complete magic link URL
 */
function generateMagicLink(name, orgUuid, baseUrl, secret) {
    // Create the JWT payload
    const payload = {
        name: name,
        org_uuid: orgUuid,
        type: 'magic_link',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours expiration
    };
    
    // Sign the token using HMAC with SHA256
    const token = jwt.sign(payload, secret, {
        algorithm: 'HS256'
    });
    
    // Build the complete URL
    return `${baseUrl}/auth/magic-link?token=${token}`;
}

// Example usage in your Teams bot
function exampleUsage() {
    // These values would come from your Teams bot context
    const userEmail = 'user@example.com';
    const organizationUuid = '123e4567-e89b-12d3-a456-426614174000'; // From Workoflow organisation
    
    // Your Workoflow instance URL
    const workoflowUrl = 'http://localhost:3979'; // Change to your production URL
    
    // The secret key - MUST match MAGIC_LINK_SECRET in your Workoflow .env file
    // In production, store this in environment variables, not in code!
    const magicLinkSecret = process.env.MAGIC_LINK_SECRET || 'your-very-secret-key-change-this-in-production-minimum-32-chars';
    
    // Generate the magic link
    const magicLink = generateMagicLink(
        userEmail,
        organizationUuid,
        workoflowUrl,
        magicLinkSecret
    );
    
    console.log('Generated magic link:', magicLink);
    
    // In your Teams bot, you would send this link to the user
    // For example, in an adaptive card or chat message:
    return {
        type: 'message',
        text: `Click here to access Workoflow: ${magicLink}`,
        // Or in an adaptive card:
        attachments: [{
            contentType: 'application/vnd.microsoft.card.adaptive',
            content: {
                type: 'AdaptiveCard',
                body: [{
                    type: 'TextBlock',
                    text: 'Access Workoflow Integration Platform'
                }],
                actions: [{
                    type: 'Action.OpenUrl',
                    title: 'Open Workoflow',
                    url: magicLink
                }]
            }
        }]
    };
}

// Export for use in your Teams bot
module.exports = {
    generateMagicLink
};

// Run example if this file is executed directly
if (require.main === module) {
    console.log('\n=== Magic Link Generator Example ===\n');
    
    // Install required package first:
    console.log('Make sure to install the JWT package:');
    console.log('npm install jsonwebtoken\n');
    
    // Show example usage
    const result = exampleUsage();
    console.log('\nExample Teams message response:');
    console.log(JSON.stringify(result, null, 2));
    
    console.log('\n=== Important Notes ===');
    console.log('1. The MAGIC_LINK_SECRET must be the same in both your Teams bot and Workoflow .env file');
    console.log('2. Store the secret securely in environment variables, never in code');
    console.log('3. The organization UUID comes from the Workoflow organisation table');
    console.log('4. Links expire after 24 hours by default');
    console.log('5. Users will be automatically created if they don\'t exist');
    console.log('6. Users will be assigned ROLE_MEMBER role');
}
