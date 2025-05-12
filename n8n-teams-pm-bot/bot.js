// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const { ActivityHandler, MessageFactory } = require('botbuilder');
const axios = require('axios'); // Import axios

// DEFINE YOUR N8N WEBHOOK URL HERE
const N8N_WEBHOOK_URL = 'https://workflows.vcec.cloud/webhook/016d8b95-d5a5-4ac6-acb5-359a547f642f'; // Replace with your actual n8n webhook URL

class EchoBot extends ActivityHandler {
    constructor() {
        super();

        // //
        // See https://aka.ms/about-bot-activity-message to learn more about the message and activity common concepts.
        this.onMessage(async (context, next) => {
            console.log("Received message from user:"   , context.activity.text);
            console.log("message context:"   , context.activity);
            const userMessage = context.activity.text;
            const replyText = `You said: "${ userMessage }"`;
            await context.sendActivity(MessageFactory.text(replyText, replyText));

            // Now, let's send the user's message to n8n and get a response
            try {
                // You might want to send more structured data to n8n
                const n8nPayload = {
                    userId: context.activity.from.id, // Example: send user ID
                    userName: context.activity.from.name, // Example: send user name
                    text: userMessage,
                    channel: 'msteams'
                };

                // Send data to n8n webhook
                await context.sendActivity(MessageFactory.text('Thinking...', 'Thinking...')); // Optional: let the user know you're processing
                const n8nResponse = await axios.post(N8N_WEBHOOK_URL, n8nPayload);

                console.log("n8n response", n8nResponse);
                // Assuming n8n responds with JSON that has a 'reply' field
                // Adjust this based on your actual n8n workflow's response structure
                let n8nReplyText = 'Sorry, I could not get a response from the agent.';
                if (n8nResponse.data && n8nResponse.data.output) {
                    n8nReplyText = n8nResponse.data.output;
                } else if (typeof n8nResponse.data === 'string') { // If n8n sends a plain string
                    n8nReplyText = n8nResponse.data;
                } else {
                    // If the response is more complex, you might need to stringify it or format it.
                    // For example, if n8n returns an array of items or structured data.
                    console.log("Received complex data from n8n:", n8nResponse.data);
                    n8nReplyText = `Received data: ${JSON.stringify(n8nResponse.data, null, 2)}`;
                }

                await context.sendActivity(MessageFactory.text(n8nReplyText, n8nReplyText));

            } catch (error) {
                console.error("Error calling n8n webhook:", error.message);
                // More detailed error logging
                if (error.response) {
                    // The request was made and the server responded with a status code
                    // that falls out of the range of 2xx
                    console.error("Data:", error.response.data);
                    console.error("Status:", error.response.status);
                    console.error("Headers:", error.response.headers);
                } else if (error.request) {
                    // The request was made but no response was received
                    console.error("Request:", error.request);
                }
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
