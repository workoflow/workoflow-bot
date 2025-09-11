const { ActivityHandler, MessageFactory } = require('botbuilder');
const axios = require('axios');
const { generateMagicLink } = require('./generate-magic-link');
const { getOpenAIClient } = require('./phoenix');

const N8N_WEBHOOK_URL = process.env.WORKOFLOW_N8N_WEBHOOK_URL || 'https://workflows.vcec.cloud/webhook/016d8b95-d5a5-4ac6-acb5-359a547f642f';
const N8N_BASIC_AUTH_USERNAME = process.env.N8N_BASIC_AUTH_USERNAME;
const N8N_BASIC_AUTH_PASSWORD = process.env.N8N_BASIC_AUTH_PASSWORD;

// Azure OpenAI configuration for rate limit monitoring
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || 'https://oai-cec-de-germany-west-central.openai.azure.com';
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY || '';
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1';
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';

// Initialize OpenAI client with Phoenix instrumentation
// This client is used by the proxy endpoint for N8N requests
const openaiClient = getOpenAIClient();
if (!openaiClient) {
    console.warn('[Bot] OpenAI client not initialized. Phoenix tracing disabled.');
}

console.log('N8N_WEBHOOK_URL:', N8N_WEBHOOK_URL);

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
                if (!context.activity.conversation.tenantId) {
                    context.activity.conversation.tenantId = 'a83e229a-7bda-4b7c-8969-4201c1382068';
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

                // Select a random loading message and tip
                const randomLoadingMessage = this.loadingMessages[Math.floor(Math.random() * this.loadingMessages.length)];
                const randomTip = this.tips[Math.floor(Math.random() * this.tips.length)];
                
                // Generate magic link for the user
                let magicLinkText = '';
                try {
                    // Use the values from context.activity which now have fallbacks set at the top
                    const userName = context.activity.from.name;
                    const orgUuid = context.activity.conversation.tenantId;
                    
                    // Generate the magic link
                    const magicLink = generateMagicLink(
                        userName,
                        orgUuid,
                        process.env.MAGIC_LINK_DOMAIN || 'http://localhost:3979',
                        process.env.MAGIC_LINK_SECRET || 'your-very-secret-key-change-this-in-production-minimum-32-chars'
                    );
                    
                    // Create the hyperlink text
                    magicLinkText = `\n\n[Manage your Integrations](${magicLink})`;
                } catch (error) {
                    console.error('Error generating magic link:', error);
                    // If magic link generation fails, continue without it
                    magicLinkText = '';
                }
                
                // Get Azure OpenAI rate limit status
                let statusBarText = '';
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
                
                // Create the enhanced loading message with tip, status bar, then magic link at the end
                const loadingMessage = `${randomLoadingMessage}\n\n_${randomTip}_${statusBarText}${magicLinkText}`;
                
                await context.sendActivity(MessageFactory.text(loadingMessage, loadingMessage));

                const config = {};
                if (N8N_BASIC_AUTH_USERNAME && N8N_BASIC_AUTH_PASSWORD) {
                    config.auth = {
                        username: N8N_BASIC_AUTH_USERNAME,
                        password: N8N_BASIC_AUTH_PASSWORD
                    };
                }

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
                    }
                };

                // Log what we're sending to n8n
                console.log('=== SENDING TO N8N ===');
                console.log('File detection summary:', enrichedPayload._fileDetection);

                const n8nResponse = await axios.post(N8N_WEBHOOK_URL, enrichedPayload, config);

                console.log('Received n8n response:', n8nResponse.data);
                let n8nReplyText = 'Sorry, I could not get a response from the agent.';
                let attachmentUrl = null;

                // Handle the new response structure
                if (n8nResponse.data && n8nResponse.data.output && Array.isArray(n8nResponse.data.output) && n8nResponse.data.output.length > 0) {
                    const outputItem = n8nResponse.data.output[0];
                    if (outputItem.output) {
                        n8nReplyText = outputItem.output;
                    }
                    // Check for optional attachment
                    if (outputItem.attachment && outputItem.attachment.url) {
                        attachmentUrl = outputItem.attachment.url;
                    }
                }

                // Send the response with or without attachment
                if (attachmentUrl) {
                    // Send the text with a link to the attachment
                    const replyWithLink = `${n8nReplyText}\n\n📎 [Download attachment](${attachmentUrl})`;
                    await context.sendActivity(MessageFactory.text(replyWithLink, replyWithLink));
                } else {
                    // Send just the text message
                    await context.sendActivity(MessageFactory.text(n8nReplyText, n8nReplyText));
                }

            } catch (error) {
                console.error('Error calling n8n webhook:', error.message);
                if (error.response) {
                    console.error('Response data:', error.response.data);
                    console.error('Response status:', error.response.status);
                }
                
                // Check if the error is about file attachments
                if (error.message && error.message.includes('File attachments')) {
                    await context.sendActivity(MessageFactory.text('I received a response but cannot send file attachments directly. Please let me know if you need the information in a different format.'));
                } else {
                    await context.sendActivity(MessageFactory.text('There was an error communicating with the AI agent.'));
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
                    await context.sendActivity(MessageFactory.text(welcomeText, welcomeText));
                }
            }
            await next();
        });
    }
}

module.exports.EchoBot = EchoBot;
