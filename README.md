<p align="center">
  <img src="assets/logo_orig_large.png" alt="Workoflow Bot Logo" width="360px">
</p>

# Workoflow Bot

This is a simple Bot connecting n8n to Teams built using the Microsoft Bot Framework SDK v4 for Node.js. It's designed to orchestrate company internal tools and data combined with modern agent and AI functionalities.
Due to a data privacy first approach this bot uses self hosted services to store its data. https://github.com/patrickjaja/workoflow-hosting

## Prerequisites

Before you begin, ensure you have the following installed:

*   Node.js (LTS version recommended)
*   npm (comes with Node.js)
*   Bot Framework Emulator
*   Git (for cloning the repository)

## Getting Started

Follow these steps to get your bot up and running locally.

### 1. Clone the Repository

### 2. Install Dependencies

Install the necessary npm packages:


### 3. Configure Environment Variables

Create a `.env` file in the root of the project directory (e.g., `workoflow-bot/.env`).

#### Required Variables:
*   `WORKOFLOW_N8N_WEBHOOK_URL`: The url of your n8n webhook.

#### Optional Variables:
*   `WORKOFLOW_PORT`: The port on which the bot server will listen. Defaults to `3978` if not specified.
*   `LOAD_TEST_MODE`: Set to `true` to skip Bot Framework replies (for load testing). Defaults to `false`.
*   `MicrosoftAppId` and `MicrosoftAppPassword`: Your bot's App ID and Password from the Azure Bot registration. Leave blank for local development without authentication.
*   `MicrosoftAppType`: Type of Microsoft App. Common values are `UserAssignedMSI`, `MultiTenant`.
*   `MicrosoftAppTenantId`: The tenant ID for your Microsoft App.

#### Load Testing:
For load testing with k6, start the bot with `LOAD_TEST_MODE=true`:
```bash
LOAD_TEST_MODE=true npm start
```

This mode allows the bot to:
- Receive and process messages
- Call the n8n webhook (testing the full workflow)
- Skip sending replies via Bot Framework (avoiding authentication requirements)

### 4. Run the Bot

 - npm run watch (or npm run start)

### Testing with Bot Framework Emulator
1.Launch the Bot Framework Emulator.
2.Connect to the bot:•Click on "Open Bot".
    For "Bot URL", enter http://localhost:3978/api/messages (or replace 3978 with the port you configured in WORKOFLOW_PORT in your .env file).
    If you configured MicrosoftAppId and MicrosoftAppPassword in your .env file, enter them into the Emulator's connection dialog. Otherwise, you can leave them blank for local testing if your bot doesn't strictly require them for local emulation.
    Click "Connect". 
3.Send a message: Once connected, type a message in the chat window and send it. The bot should echo your message back to you.
