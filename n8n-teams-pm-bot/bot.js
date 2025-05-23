const { ActivityHandler, MessageFactory } = require('botbuilder');
const axios = require('axios'); // Import axios

const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://workflows.vcec.cloud/webhook/016d8b95-d5a5-4ac6-acb5-359a547f642f'; // Replace with your actual n8n webhook URL

console.log('N8N_WEBHOOK_URL:', N8N_WEBHOOK_URL);

class EchoBot extends ActivityHandler {
    constructor() {
        super();
        this.onMessage(async (context, next) => {
            try {
                await context.sendActivity(MessageFactory.text('Thinking...', 'Thinking...'));
                const n8nResponse = await axios.post(N8N_WEBHOOK_URL, context.activity);

                console.log('Received n8n response:', n8nResponse);
                let n8nReplyText = 'Sorry, I could not get a response from the agent.';
                if (n8nResponse.data && n8nResponse.data.output) {
                    n8nReplyText = n8nResponse.data.output;
                }

                await context.sendActivity(MessageFactory.text(n8nReplyText, n8nReplyText));

            } catch (error) {
                console.error('Error calling n8n webhook:', error.message);
                console.error('Request:', error.request);
                await context.sendActivity(MessageFactory.text('There was an error communicating with the AI agent.'));
            }

            // By calling next() you ensure that the next BotHandler is run.
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
            // By calling next() you ensure that the next BotHandler is run.
            await next();
        });
    }
}

module.exports.EchoBot = EchoBot;
