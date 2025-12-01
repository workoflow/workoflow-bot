const { ActivityHandler, MessageFactory, CardFactory, TeamsInfo } = require('botbuilder');
const { ConnectorClient, MicrosoftAppCredentials } = require('botframework-connector');
const axios = require('axios');
const { getOpenAIClient } = require('./phoenix');
const { shouldAskForFeedback, markFeedbackGiven, markUserInteraction, markFeedbackPrompted } = require('./feedback-tracker');

const N8N_WEBHOOK_URL = process.env.WORKOFLOW_N8N_WEBHOOK_URL || 'https://workflows.vcec.cloud/webhook/016d8b95-d5a5-4ac6-acb5-359a547f642f';
const FEEDBACK_WEBHOOK_URL = process.env.WORKOFLOW_FEEDBACK_WEBHOOK_URL || 'https://workflows-stage.vcec.cloud/webhook/a887e442-2c85-4193-b127-24408eaf8b11';
const N8N_BASIC_AUTH_USERNAME = process.env.N8N_BASIC_AUTH_USERNAME;
const N8N_BASIC_AUTH_PASSWORD = process.env.N8N_BASIC_AUTH_PASSWORD;

// Azure OpenAI configuration for rate limit monitoring
// These MUST be set via environment variables - no hardcoded fallbacks
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY || '';
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION;

// Initialize OpenAI client with Phoenix instrumentation
// This client is used by the proxy endpoint for N8N requests
const openaiClient = getOpenAIClient();
if (!openaiClient) {
    console.warn('[Bot] OpenAI client not initialized. Phoenix tracing disabled.');
}

console.log('N8N_WEBHOOK_URL:', N8N_WEBHOOK_URL);

// Helper function to send messages - skips actual sending in load test mode (avoids Bot Framework auth)
// Returns the sent message for logging/testing purposes
async function sendMessage(context, message) {
    if (process.env.LOAD_TEST_MODE === 'true') {
        console.log('[LOAD_TEST_MODE] Skipping reply:',
            typeof message === 'string' ? message.substring(0, 100) : 'Activity');
        return message;
    }
    return await context.sendActivity(message);
}

// Function to format rate limit status into a compact status bar
function formatRateLimitStatus(headers) {
    if (!headers) return null;
    
    const remainingRequests = headers['x-ratelimit-remaining-requests'];
    const limitRequests = headers['x-ratelimit-limit-requests'];
    const remainingTokens = headers['x-ratelimit-remaining-tokens'];
    const limitTokens = headers['x-ratelimit-limit-tokens'];
    const model = headers['x-ms-deployment-name'] || AZURE_OPENAI_DEPLOYMENT;
    const region = headers['x-ms-region'] || 'unknown';
    
    if (!remainingRequests || !limitRequests || !remainingTokens || !limitTokens) {
        return null;
    }
    
    const requestPercentage = Math.round((remainingRequests / limitRequests) * 100);
    const tokenPercentage = Math.round((remainingTokens / limitTokens) * 100);
    
    return `_📊 ${model} (${region}) • ${requestPercentage}% (RLR) • ${tokenPercentage}% (RLT)_`;
}

// Function to get Azure OpenAI rate limit status (using direct call for headers)
// This is separate from Phoenix instrumentation to get rate limit info
async function getAzureOpenAIStatus() {
    try {
        // Make a minimal direct API call just to get rate limit headers
        // This won't be traced by Phoenix but gives us the headers we need
        const url = `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=${AZURE_OPENAI_API_VERSION}`;
        
        const response = await axios.post(url, {
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: "Hi" }
            ],
            max_tokens: 1,
            temperature: 0
        }, {
            headers: {
                'api-key': AZURE_OPENAI_API_KEY,
                'Content-Type': 'application/json'
            },
            validateStatus: function (status) {
                return status < 500; // Accept any status less than 500
            }
        });
        
        return response.headers;
    } catch (error) {
        console.error('Error getting Azure OpenAI status:', error.message);
        return null;
    }
}

// Note: Main OpenAI calls should go through the proxy endpoint (/openai/*) for Phoenix tracing
// N8N workflow must be configured to use http://bot-host:3978/openai/* instead of direct Azure OpenAI

// Helper function to detect if this is a thread reply
function isThreadReply(activity) {
    // Check if there's a replyToId field (direct indicator)
    if (activity.replyToId) {
        console.log('[THREAD DETECTION] Found replyToId:', activity.replyToId);
        return true;
    }

    // Check if there's an HTML attachment with a Reply schema type
    if (activity.attachments && activity.attachments.length > 0) {
        const hasReplySchema = activity.attachments.some(att =>
            att.contentType === 'text/html' &&
            att.content &&
            att.content.includes('itemtype="http://schema.skype.com/Reply"')
        );

        if (hasReplySchema) {
            console.log('[THREAD DETECTION] Found Reply schema in HTML attachment');
            return true;
        }
    }

    return false;
}

// Helper function to extract the thread message ID from the activity
function extractThreadMessageId(activity) {
    // First, try to get from replyToId
    if (activity.replyToId) {
        return activity.replyToId;
    }

    // Try to extract from HTML attachment
    if (activity.attachments && activity.attachments.length > 0) {
        for (const attachment of activity.attachments) {
            if (attachment.contentType === 'text/html' && attachment.content) {
                // Look for itemid in the blockquote
                const itemIdMatch = attachment.content.match(/itemid="([^"]+)"/);
                if (itemIdMatch && itemIdMatch[1]) {
                    console.log('[THREAD EXTRACTION] Found itemid in HTML:', itemIdMatch[1]);
                    return itemIdMatch[1];
                }
            }
        }
    }

    return null;
}

// Function to fetch the complete thread message using Bot Framework API
async function fetchCompleteThreadMessage(context, messageId) {
    console.log(`[THREAD FETCH] Message ID: ${messageId}`);
    console.log('[THREAD FETCH] Note: Teams does not allow bots to fetch historical messages');

    // Teams/Bot Framework limitation: Bots cannot access conversation history
    // The original message is only available as a truncated preview in the HTML attachment
    return {
        id: messageId,
        available: false,
        reason: 'Teams API restriction - bots cannot access conversation history',
        note: 'Only the HTML preview from the current activity is available'
    };
}

// Function to fetch extended user information
async function fetchExtendedUserInfo(context, userId) {
    try {
        console.log(`[USER FETCH] Fetching extended info for user: ${userId}`);

        // Get detailed user information using TeamsInfo
        const member = await TeamsInfo.getMember(context, userId);

        // Try to get additional team context if in a team
        let teamContext = null;
        try {
            const teamDetails = await TeamsInfo.getTeamDetails(context);
            if (teamDetails) {
                teamContext = {
                    teamId: teamDetails.id,
                    teamName: teamDetails.name,
                    teamDescription: teamDetails.description
                };
            }
        } catch (teamError) {
            // Not in a team context, that's okay
            console.log('[USER FETCH] Not in team context or unable to fetch team details');
        }

        // Get meeting info if in a meeting
        let meetingContext = null;
        try {
            const meetingInfo = await TeamsInfo.getMeetingInfo(context);
            if (meetingInfo) {
                meetingContext = {
                    meetingId: meetingInfo.details?.id,
                    meetingTitle: meetingInfo.details?.title,
                    meetingType: meetingInfo.details?.type
                };
            }
        } catch (meetingError) {
            // Not in a meeting context, that's okay
            console.log('[USER FETCH] Not in meeting context or unable to fetch meeting details');
        }

        const extendedInfo = {
            ...member,
            teamContext,
            meetingContext,
            fetchedAt: new Date().toISOString()
        };

        console.log('[USER FETCH] Successfully fetched extended user info');
        return extendedInfo;

    } catch (error) {
        console.error('[USER FETCH] Error fetching extended user info:', error.message);
        return null;
    }
}

// Function to create feedback adaptive card
function createFeedbackCard() {
    return CardFactory.adaptiveCard({
        type: 'AdaptiveCard',
        body: [
            {
                type: 'TextBlock',
                text: 'How is Workoflow doing this session? (optional)',
                size: 'Medium',
                weight: 'Bolder',
                wrap: true
            }
        ],
        actions: [
            {
                type: 'Action.Submit',
                title: '😞 Bad',
                data: {
                    action: 'feedback',
                    rating: 1,
                    ratingText: 'Bad'
                }
            },
            {
                type: 'Action.Submit',
                title: '😐 Fine',
                data: {
                    action: 'feedback',
                    rating: 2,
                    ratingText: 'Fine'
                }
            },
            {
                type: 'Action.Submit',
                title: '😊 Good',
                data: {
                    action: 'feedback',
                    rating: 3,
                    ratingText: 'Good'
                }
            },
            {
                type: 'Action.Submit',
                title: 'Dismiss',
                data: {
                    action: 'feedback',
                    rating: 0,
                    ratingText: 'Dismissed'
                }
            }
        ],
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.3'
    });
}

/**
 * Recursively unwraps JSON strings that contain { "output": "..." } structure.
 * Handles double/triple encoding where AI outputs JSON as text.
 * @param {any} value - The value to unwrap
 * @param {number} maxDepth - Maximum recursion depth (default 3)
 * @returns {{ output: string, attachment: string|null }}
 */
function unwrapJsonOutput(value, maxDepth = 3) {
    if (maxDepth <= 0) return { output: value, attachment: null };

    // If it's a string, check if it's JSON
    if (typeof value === 'string') {
        // Quick check: does it look like JSON?
        const trimmed = value.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                const parsed = JSON.parse(trimmed);
                // If parsed has an "output" field, recurse
                if (parsed && typeof parsed === 'object' && 'output' in parsed) {
                    const result = unwrapJsonOutput(parsed.output, maxDepth - 1);
                    return {
                        output: result.output,
                        attachment: result.attachment || parsed.attachment || null
                    };
                }
                // Parsed but no output field - return original string
                return { output: value, attachment: null };
            } catch (e) {
                // Not valid JSON - return as-is
                return { output: value, attachment: null };
            }
        }
        // Not JSON-like - return as-is
        return { output: value, attachment: null };
    }

    // If it's an object with output field, unwrap it
    if (value && typeof value === 'object' && 'output' in value) {
        const result = unwrapJsonOutput(value.output, maxDepth - 1);
        return {
            output: result.output,
            attachment: result.attachment || value.attachment || null
        };
    }

    // Otherwise, convert to string
    return { output: String(value), attachment: null };
}

class EchoBot extends ActivityHandler {
    constructor() {
        super();

        // Loading messages for better user experience
        this.loadingMessages = [
            "🔍 Analyzing your request...",
            "🔍 Processing your query...",
            "🔍 Working on it...",
            "🔍 Finding the best solution...",
            "🔍 Generating response...",
            "🔍 Almost there...",
            "🔍 Preparing your answer...",
            "🔍 Consulting the knowledge base...",
            "🔍 Searching for information...",
            "🔍 Gathering data..."
        ];

        // Tips array to showcase bot capabilities
        this.tips = [
            // Jira Integration Tips
            "💡 Tip: Erkläre mir Jira-Tickets mit 'Erkläre mir bitte den Inhalt dieses Jira-Tickets: [Link]'",
            "💡 Tip: Fasse Sprint-Ziele zusammen mit 'Fasse die Sprintziele des aktuellen Sprints kompakt zusammen [Sprint-Board-Link]'",
            "💡 Tip: Erstelle Release Notes mit 'Beschreibe den aktuellen Jira-Sprint als Markdown-Datei [Sprint-Board-Link]'",
            "💡 Tip: Teste Jira-Tickets besser mit 'Wie kann ich das folgende Jira-Ticket am besten testen? [Ticket-Link]'",
            "💡 Tip: Bewerte Ticket-Qualität mit 'Bewerte die Qualität auf einer Skala von 1 bis 10: [Ticket-Link]'",
            "💡 Tip: Zeige Projekthistorie mit 'Zeige mir die Projekthistorie auf Basis der wichtigsten Jira-Tickets [Sprint-Board-Link]'",
            "💡 Tip: Fasse Kommentare zusammen mit 'Fasse die letzten 5 Kommentare aus folgendem Jira-Ticket zusammen [Ticket-Link]'",
            "💡 Tip: Kommentiere Jira-Tickets mit 'Füge einen Kommentar zu [Ticket-Link] hinzu: [Dein Text]'",
            
            // Employee & Skills Search Tips
            "💡 Tip: Finde Experten mit 'Nenne mir einen erfahrenen [Rolle] mit Projekterfahrung im [Technologie]-Umfeld'",
            "💡 Tip: Suche Teammitglieder mit 'Wer aus unserem Team hat Erfahrung im Bereich [Skill] und ist als [Rolle] tätig?'",
            "💡 Tip: Finde Ansprechpartner mit 'Wer kann unseren Kunden [Service] beraten und welche Kosten wären damit verbunden?'",
            "💡 Tip: Prüfe Mitarbeiter-Skills mit 'Hat [Mitarbeiter] [Technologie]-Projekte betreut? In welchen Rollen?'",
            "💡 Tip: Kontaktiere Kollegen mit 'Wie kann ich [Mitarbeiter] erreichen?'",
            "💡 Tip: Finde passende Aufgaben mit 'Welche Tickets lassen sich am besten von [Mitarbeiter] bearbeiten? [Board-Link]'",
            
            // Document Generation Tips
            "💡 Tip: Erstelle PDFs mit 'Packe diese [Informationen] in eine PDF'",
            "💡 Tip: Generiere PowerPoints mit 'Erstelle eine Kurzvorstellung von [Mitarbeiter] als PowerPoint-Slide'",
            "💡 Tip: Erstelle Top-Listen mit 'Erstelle anhand [URL] eine Liste der Top 10 [Thema] als PDF-File'",
            "💡 Tip: Fasse Dokumente zusammen mit 'Fasse mir die Kernaussagen dieser Datei in 3 Sätze zusammen [pdf-file]'",
            "💡 Tip: Erstelle Projektübergaben mit 'Erstelle eine Projektübergabe-Zusammenfassung basierend auf [Jira-Board-Link]'",
            
            // Web Research Tips
            "💡 Tip: Recherchiere Unternehmen mit 'Recherchiere Informationen über das Unternehmen [Firma]'",
            "💡 Tip: Extrahiere CSS-Farben mit 'Gib mir die CSS-Farbcodes der Webseite [URL]'",
            "💡 Tip: Suche im Internet mit 'Bitte suche im Internet nach [Thema]'",
            "💡 Tip: Analysiere Webseiten mit 'Generiere mir einen ausführlichen Aufsatz über [URL] als PDF'",
            "💡 Tip: Prüfe Technologie-Support mit 'Welche Filetypes werden von [Technologie] supported? [web-page]'",
            
            // Project Management Tips
            "💡 Tip: Finde Case Studies mit 'Gibt es eine Case Study zum Thema [Service]? Wer ist der Ansprechpartner?'",
            "💡 Tip: Erstelle Urlaubsvertretungen mit 'Erstelle eine Übersicht für Urlaubsvertretung mit [Jira-Board] und [Confluence-Link]'",
            "💡 Tip: Schätze Aufwände mit 'Wie lange würde ein erfahrener Entwickler für [Ticket-Link] brauchen?'",
            "💡 Tip: Finde Kunden mit 'Welche Kunden haben wir in der [Branche]?'",
            "💡 Tip: Plane Events mit 'Welche valantic Events stehen demnächst an?'",
            
            // General Bot Capabilities
            "💡 Tip: Frage nach meinen Fähigkeiten mit 'Was kannst du eigentlich?'",
            "💡 Tip: Melde Fehler mit 'Ich möchte einen Fehler melden: [Bug-Beschreibung]'",
            "💡 Tip: Erstelle SEO-Analysen mit 'Erstelle Suchbegriffe zum Thema [Thema] und zeige wo [Firma] gut abschneidet'",
            "💡 Tip: Finde Projekthistorie mit 'In welchen Projekten war [Mitarbeiter] bislang tätig?'",
            "💡 Tip: Identifiziere Tätigkeitsfelder mit 'Nenne mir 10 Tätigkeitsfelder die [Mitarbeiter] bearbeiten kann'"
        ];

        this.onMessage(async (context, next) => {
            try {
                // Set fallback values at the highest level for Bot Framework Emulator compatibility
                // These will be used throughout the message handling
                if (!context.activity.from.name) {
                    context.activity.from.name = 'Patrick Schönfeld';
                }
                if (!context.activity.from.aadObjectId) {
                    context.activity.from.aadObjectId = '45908692-019e-4436-810c-b417f58f5f4f';
                }
                if (!context.activity.conversation.tenantId) {
                    context.activity.conversation.tenantId = 'afe4d4f4-06e0-4f82-9596-0de3fb577ff3';
                }

                // Handle adaptive card submissions (feedback)
                if (context.activity.value && context.activity.value.action === 'feedback') {
                    const feedbackData = context.activity.value;
                    // Use same fallback logic as feedback prompt check for consistency
                    const userId = context.activity.from.aadObjectId || context.activity.from.id || 'default-user';
                    console.log(`[FEEDBACK DEBUG] Feedback submission from userId: ${userId}`);

                    // Mark feedback as given
                    markFeedbackGiven(userId, feedbackData.rating);

                    // Send feedback to webhook
                    try {
                        const feedbackPayload = {
                            userId: userId,
                            userName: context.activity.from.name,
                            tenantId: context.activity.conversation.tenantId,
                            timestamp: new Date().toISOString(),
                            feedback: {
                                rating: feedbackData.rating,
                                ratingText: feedbackData.ratingText
                            }
                        };

                        console.log('Sending feedback to webhook:', feedbackPayload);

                        const feedbackResponse = await axios.post(FEEDBACK_WEBHOOK_URL, feedbackPayload, {
                            headers: {
                                'Content-Type': 'application/json'
                            }
                        });

                        console.log('Feedback webhook response:', feedbackResponse.data);

                        // Send thank you message
                        if (feedbackData.rating > 0) {
                            await sendMessage(context, MessageFactory.text('Thank you for your feedback! 🙏'));
                        }
                    } catch (error) {
                        console.error('Error sending feedback to webhook:', error.message);
                    }

                    await next();
                    return;
                }

                // Comprehensive logging to understand the activity structure
                console.log('=== FULL ACTIVITY OBJECT ===');
                console.log(JSON.stringify(context.activity, null, 2));
                console.log('=== END ACTIVITY ===');

                // Log specific properties that might contain file info
                console.log('Activity type:', context.activity.type);
                console.log('Text:', context.activity.text);
                console.log('Attachments count:', context.activity.attachments?.length || 0);
                console.log('Entities count:', context.activity.entities?.length || 0);

                // Detailed attachment logging
                if (context.activity.attachments && context.activity.attachments.length > 0) {
                    console.log('=== ATTACHMENTS DETAIL ===');
                    context.activity.attachments.forEach((attachment, index) => {
                        console.log(`Attachment ${index}:`, {
                            contentType: attachment.contentType,
                            name: attachment.name,
                            contentUrl: attachment.contentUrl,
                            content: attachment.content ? 'Has content' : 'No content',
                            thumbnailUrl: attachment.thumbnailUrl
                        });
                    });
                }

                // Check entities for file information
                if (context.activity.entities && context.activity.entities.length > 0) {
                    console.log('=== ENTITIES DETAIL ===');
                    context.activity.entities.forEach((entity, index) => {
                        console.log(`Entity ${index}:`, {
                            type: entity.type,
                            ...entity
                        });
                    });
                }

                // Check channelData for Teams-specific information
                if (context.activity.channelData) {
                    console.log('=== CHANNEL DATA ===');
                    console.log(JSON.stringify(context.activity.channelData, null, 2));
                }

                // Check for file URLs in the message text
                let detectedFileUrls = [];
                if (context.activity.text) {
                    // Pattern to detect SharePoint/OneDrive URLs
                    const sharePointPattern = /(https:\/\/[^\s]*\.(sharepoint\.com|microsoft\.com|office\.com)[^\s]*)/gi;
                    const teamsFilePattern = /(https:\/\/teams\.microsoft\.com[^\s]*)/gi;

                    const sharePointUrls = context.activity.text.match(sharePointPattern) || [];
                    const teamsUrls = context.activity.text.match(teamsFilePattern) || [];

                    detectedFileUrls = [...sharePointUrls, ...teamsUrls];

                    if (detectedFileUrls.length > 0) {
                        console.log('=== DETECTED FILE URLS IN TEXT ===');
                        console.log(detectedFileUrls);
                    }
                }

                // Check value property (sometimes used for card submissions)
                if (context.activity.value) {
                    console.log('=== ACTIVITY VALUE ===');
                    console.log(JSON.stringify(context.activity.value, null, 2));
                }

                // Select a random loading message
                const randomLoadingMessage = this.loadingMessages[Math.floor(Math.random() * this.loadingMessages.length)];

                // Check if this is a personal (1:1) conversation
                // Fetch extended user information early (needed for both magic link and custom data)
                console.log('[ENRICHMENT] Fetching extended user information...');
                const extendedUserInfo = await fetchExtendedUserInfo(
                    context,
                    context.activity.from.id
                );

                // Check if this is a personal (1:1) conversation
                // Include undefined conversationType for Bot Framework Emulator compatibility
                // Explicitly exclude group conversations using isGroup flag
                const conversationType = context.activity.conversation.conversationType;
                const isGroup = context.activity.conversation.isGroup || false;
                const isPersonalChat = (conversationType === 'personal' || conversationType === undefined) && !isGroup;

                // Initialize optional message components (only for personal chats)
                let magicLinkText = '';
                let randomTip = '';
                let statusBarText = '';

                if (isPersonalChat) {
                    // Select a random tip (only for personal chats)
                    randomTip = this.tips[Math.floor(Math.random() * this.tips.length)];

                    // Generate magic link for the user using the new API approach
                    try {
                        // Use the values from context.activity which now have fallbacks set at the top
                        const userName = context.activity.from.name;
                        const orgUuid = context.activity.conversation.tenantId;
                        const workflowUserId = context.activity.from.aadObjectId;
                        const userEmail = extendedUserInfo?.email || null;

                        // Extract channel information from the conversation context
                        const channelId = context.activity.conversation.id;
                        const channelName = context.activity.conversation.name ||
                                          context.activity.channelData?.channel?.name ||
                                          `Channel-${channelId.substring(0, 8)}`;

                        // Check if API credentials are configured
                        if (!process.env.WORKOFLOW_API_USER || !process.env.WORKOFLOW_API_PASSWORD) {
                            console.log('[Magic Link] API credentials not configured, skipping magic link generation');
                            console.log('[Magic Link] Please set WORKOFLOW_API_USER and WORKOFLOW_API_PASSWORD in .env');
                        } else {
                            // Import the new function directly
                            const { registerUserAndGetMagicLink } = require('./register-api');

                            // Prepare configuration with channel information and email
                            const config = {
                                baseUrl: process.env.MAGIC_LINK_DOMAIN || 'http://localhost:3979',
                                apiUser: process.env.WORKOFLOW_API_USER,
                                apiPassword: process.env.WORKOFLOW_API_PASSWORD,
                                channelUuid: `channel-${channelId}`, // Use conversation ID as channel UUID
                                channelName: channelName,
                                email: userEmail // Add real user email
                            };

                            console.log('[Magic Link] Registering user with channel:', {
                                userName,
                                orgUuid,
                                workflowUserId,
                                userEmail,
                                channelUuid: config.channelUuid,
                                channelName: config.channelName
                            });

                            // Call the registration API with channel information
                            const result = await registerUserAndGetMagicLink(
                                userName,
                                orgUuid,
                                workflowUserId,
                                config
                            );

                            const magicLink = result.magicLink;

                            // Create the hyperlink text
                            magicLinkText = `\n\n[Manage your Integrations](${magicLink})`;
                            console.log('[Magic Link] Successfully generated magic link for user:', userName);

                            if (result.channel) {
                                console.log('[Magic Link] User added to channel:', {
                                    channelId: result.channel.id,
                                    channelUuid: result.channel.uuid,
                                    channelName: result.channel.name
                                });
                            }
                        }
                    } catch (error) {
                        console.error('[Magic Link] Error generating magic link:', error.message);
                        // If magic link generation fails, continue without it
                        magicLinkText = '';
                    }

                    // Get Azure OpenAI rate limit status (only for personal chats)
                    try {
                        const azureHeaders = await getAzureOpenAIStatus();
                        const formattedStatus = formatRateLimitStatus(azureHeaders);
                        if (formattedStatus) {
                            statusBarText = `\n\n${formattedStatus}`;
                        }
                    } catch (error) {
                        console.error('Error getting Azure OpenAI status:', error);
                        // Continue without status bar if it fails
                    }
                } else {
                    console.log('[Magic Link] Skipping magic link, tip, and status bar for non-personal conversation');
                    console.log('[Magic Link] Conversation details:', {
                        conversationType: conversationType,
                        isGroup: isGroup,
                        conversationId: context.activity.conversation.id,
                        isPersonalChat: isPersonalChat
                    });
                }

                // Create the loading message conditionally based on conversation type
                const loadingMessage = isPersonalChat
                    ? `${randomLoadingMessage}\n\n_${randomTip}_${statusBarText}${magicLinkText}`
                    : randomLoadingMessage;

                await sendMessage(context, MessageFactory.text(loadingMessage, loadingMessage));

                const config = {};
                if (N8N_BASIC_AUTH_USERNAME && N8N_BASIC_AUTH_PASSWORD) {
                    config.auth = {
                        username: N8N_BASIC_AUTH_USERNAME,
                        password: N8N_BASIC_AUTH_PASSWORD
                    };
                }

                // Always enrich with custom data (using already-fetched extendedUserInfo)
                // Initialize custom data with common properties
                let customData = {
                    isThreadReply: false,
                    threadMessageId: null,
                    originalThreadMessage: null,
                    user: extendedUserInfo,
                    conversationDetails: {
                        conversationType: context.activity.conversation.conversationType,
                        conversationId: context.activity.conversation.id,
                        tenantId: context.activity.conversation.tenantId,
                        isGroup: context.activity.conversation.isGroup || false
                    },
                    enrichmentTimestamp: new Date().toISOString()
                };

                // Additional enrichment for thread replies
                if (isThreadReply(context.activity)) {
                    console.log('[THREAD ENRICHMENT] Detected thread reply, fetching thread data...');

                    // Extract the thread message ID
                    const threadMessageId = extractThreadMessageId(context.activity);

                    // Fetch complete thread message
                    let originalThreadMessage = null;
                    if (threadMessageId) {
                        originalThreadMessage = await fetchCompleteThreadMessage(context, threadMessageId);
                    }

                    // Update custom data with thread-specific properties
                    customData.isThreadReply = true;
                    customData.threadMessageId = threadMessageId;
                    customData.originalThreadMessage = originalThreadMessage;

                    console.log('[THREAD ENRICHMENT] Thread data prepared:', {
                        hasOriginalMessage: !!originalThreadMessage,
                        threadMessageId: threadMessageId
                    });
                }

                console.log('[ENRICHMENT] Custom data prepared:', {
                    isThreadReply: customData.isThreadReply,
                    hasUserInfo: !!extendedUserInfo,
                    hasConversationDetails: !!customData.conversationDetails
                });

                // Create enriched payload for n8n
                const enrichedPayload = {
                    ...context.activity,
                    _fileDetection: {
                        hasNonHtmlAttachments: context.activity.attachments?.some(att =>
                            att.contentType !== 'text/html' && att.contentType !== 'text/plain'
                        ) || false,
                        detectedFileUrls: detectedFileUrls,
                        attachmentTypes: context.activity.attachments?.map(att => att.contentType) || [],
                        entityTypes: context.activity.entities?.map(ent => ent.type) || [],
                        possibleFileAttachments: context.activity.attachments?.filter(att =>
                            att.contentType !== 'text/html' &&
                            att.contentType !== 'text/plain' &&
                            att.contentUrl
                        ) || []
                    },
                    // Always include custom data (populated for thread replies, null properties otherwise)
                    custom: customData
                };

                // Log what we're sending to n8n
                console.log('=== SENDING TO N8N ===');
                console.log('File detection summary:', enrichedPayload._fileDetection);
                console.log('Custom enrichment included:', {
                    isThreadReply: enrichedPayload.custom.isThreadReply,
                    hasOriginalMessage: !!enrichedPayload.custom.originalThreadMessage,
                    hasExtendedUserInfo: !!enrichedPayload.custom.user
                });

                const n8nResponse = await axios.post(N8N_WEBHOOK_URL, enrichedPayload, config);

                console.log('=== RAW N8N RESPONSE ===');
                console.log('Type of data:', typeof n8nResponse.data);
                console.log('Data:', JSON.stringify(n8nResponse.data, null, 2));
                if (n8nResponse.data && n8nResponse.data.output) {
                    console.log('Type of data.output:', typeof n8nResponse.data.output);
                    console.log('data.output:', n8nResponse.data.output);
                }

                let n8nReplyText = 'Sorry, I could not get a response from the agent.';
                let attachmentUrl = null;

                // Handle the response structure - n8n returns output as stringified JSON
                // Uses unwrapJsonOutput to handle double/triple JSON encoding from AI
                if (n8nResponse.data && n8nResponse.data.output) {
                    try {
                        // Parse the stringified JSON from n8n
                        const parsedOutput = JSON.parse(n8nResponse.data.output);
                        console.log('=== PARSED OUTPUT ===');
                        console.log('Type:', typeof parsedOutput);
                        console.log('Content:', JSON.stringify(parsedOutput, null, 2));

                        // Use recursive unwrapper to handle any level of JSON nesting
                        // This handles cases where AI outputs JSON as text (double-encoding)
                        const unwrapped = unwrapJsonOutput(parsedOutput);
                        n8nReplyText = unwrapped.output;
                        attachmentUrl = unwrapped.attachment;

                        console.log('=== UNWRAPPED OUTPUT ===');
                        console.log('n8nReplyText:', n8nReplyText);
                        console.log('attachmentUrl:', attachmentUrl);

                    } catch (parseError) {
                        console.error('Error parsing n8n response JSON:', parseError);
                        // Fallback: try unwrapping the raw output in case it's double-encoded text
                        const fallbackResult = unwrapJsonOutput(n8nResponse.data.output);
                        n8nReplyText = fallbackResult.output;
                        attachmentUrl = fallbackResult.attachment;
                        console.log('=== FALLBACK UNWRAP ===');
                        console.log('n8nReplyText:', n8nReplyText);
                    }
                }

                // Send the response with or without attachment
                if (attachmentUrl) {
                    // Send the text with a link to the attachment
                    const replyWithLink = `${n8nReplyText}\n\n📎 [Download attachment](${attachmentUrl})`;
                    await sendMessage(context, MessageFactory.text(replyWithLink, replyWithLink));
                } else {
                    // Send just the text message
                    await sendMessage(context, MessageFactory.text(n8nReplyText, n8nReplyText));
                }

                // Check if feedback is enabled and we should ask for feedback (first interaction of the day)
                const feedbackEnabled = process.env.FEEDBACK_ENABLED !== 'false'; // Default to true if not set

                if (feedbackEnabled) {
                    // Use fallback if aadObjectId is not available (happens in some Teams contexts)
                    const userId = context.activity.from.aadObjectId || context.activity.from.id || 'default-user';
                    console.log(`[FEEDBACK DEBUG] Checking feedback for userId: ${userId}, aadObjectId: ${context.activity.from.aadObjectId}, from.id: ${context.activity.from.id}`);

                    if (shouldAskForFeedback(userId)) {
                        // Mark that feedback has been prompted to this user
                        markFeedbackPrompted(userId);

                        // Send feedback card
                        const feedbackCard = createFeedbackCard();
                        await sendMessage(context, { attachments: [feedbackCard] });

                        console.log(`[FEEDBACK DEBUG] Feedback card sent to user: ${context.activity.from.name} (${userId})`);
                    }
                } else {
                    console.log(`[FEEDBACK DEBUG] Feedback collection is disabled via FEEDBACK_ENABLED env variable`);
                }

            } catch (error) {
                console.error('Error calling n8n webhook:', error.message);
                if (error.response) {
                    console.error('Response data:', error.response.data);
                    console.error('Response status:', error.response.status);
                }

                // Check if the error is about file attachments
                if (error.message && error.message.includes('File attachments')) {
                    await sendMessage(context, MessageFactory.text('I received a response but cannot send file attachments directly. Please let me know if you need the information in a different format.'));
                } else {
                    // Determine the specific error type based on error details
                    let errorMessage = 'There was an error communicating with the AI agent.\n\n';

                    // Check for timeout errors (axios timeout or proxy timeout)
                    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' ||
                        (error.response && (error.response.status === 504 || error.response.status === 408))) {
                        errorMessage += '⏱️ **Request Timeout**: Your request took more than 60 seconds and was automatically cancelled.\n';
                        errorMessage += 'We are working on improving this limitation.\n\n';
                    }

                    // Check for rate limit errors
                    if (error.response && error.response.status === 429) {
                        errorMessage += '⚠️ **Rate Limit**: The allowed token limit per minute has been reached (check status line value RLT).\n';
                        errorMessage += 'Please wait a moment before trying again.\n\n';
                    }

                    // Check for workflow/technical errors
                    if (error.response && error.response.status >= 500) {
                        errorMessage += '🔧 **Technical Issue**: The workflow behind your request may have failed.\n';
                        errorMessage += 'This could be a temporary issue with the backend services.\n\n';
                    }

                    // Add general troubleshooting message
                    errorMessage += 'Possible causes:\n\n';
                    errorMessage += '• Requests exceeding 60 seconds are cancelled due to proxy timeout\n\n';
                    errorMessage += '• Rate limit reached (too many requests per minute)\n\n';
                    errorMessage += '• Technical issue with the workflow processing\n\n';
                    errorMessage += 'Please try again with a simpler request or contact support if the issue persists.';

                    await sendMessage(context, MessageFactory.text(errorMessage));
                }
            }

            await next();
        });

        // Add handler for all events to catch file-related activities
        this.onEvent(async (context, next) => {
            console.log('=== EVENT ACTIVITY ===');
            console.log('Event name:', context.activity.name);
            console.log('Event value:', context.activity.value);
            console.log('Full event:', JSON.stringify(context.activity, null, 2));

            // File consent activities in Teams
            if (context.activity.name === 'fileConsent/invoke') {
                console.log('FILE CONSENT DETECTED!');
                console.log('File info:', context.activity.value);
            }

            await next();
        });

        // Handle unrecognized activity types
        this.onUnrecognizedActivityType(async (context, next) => {
            console.log('=== UNRECOGNIZED ACTIVITY TYPE ===');
            console.log('Type:', context.activity.type);
            console.log('Full activity:', JSON.stringify(context.activity, null, 2));
            await next();
        });

        this.onMembersAdded(async (context, next) => {
            const membersAdded = context.activity.membersAdded;
            const welcomeText = 'Hello and welcome! I am your n8n AI Agent. How can I help you today?';
            for (let cnt = 0; cnt < membersAdded.length; ++cnt) {
                if (membersAdded[cnt].id !== context.activity.recipient.id) {
                    await sendMessage(context, MessageFactory.text(welcomeText, welcomeText));
                }
            }
            await next();
        });
    }
}

module.exports.EchoBot = EchoBot;
