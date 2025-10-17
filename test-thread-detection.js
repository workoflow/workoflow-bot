// Test script to verify thread detection logic
const { isThreadReply, extractThreadMessageId } = require('./bot');

// Test cases for thread detection
const testCases = [
    {
        name: 'Direct thread reply with replyToId',
        activity: {
            replyToId: '1760623952783',
            text: 'This is a reply'
        },
        expected: {
            isReply: true,
            messageId: '1760623952783'
        }
    },
    {
        name: 'Thread reply with HTML attachment (from provided example)',
        activity: {
            text: '\r\nWorkoflow Bot\r\nGott, hier ist eine technisch fokussierte Zusammenfassung...',
            attachments: [
                {
                    contentType: 'text/html',
                    content: '<blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="1760623952783">\r\n<strong itemprop="mri" itemid="28:9aab910c-cfab-4366-b2c0-bbb364e1b1bc">Workoflow Bot</strong><span itemprop="time" itemid="1760623952783"></span>\r\n<p itemprop="preview">Gott, hier ist eine technisch fokussierte Zusammenfassung...</p>\r\n</blockquote>'
                }
            ]
        },
        expected: {
            isReply: true,
            messageId: '1760623952783'
        }
    },
    {
        name: 'Regular message without thread',
        activity: {
            text: 'This is a regular message',
            attachments: []
        },
        expected: {
            isReply: false,
            messageId: null
        }
    },
    {
        name: 'Message with non-reply HTML attachment',
        activity: {
            text: 'Message with attachment',
            attachments: [
                {
                    contentType: 'text/html',
                    content: '<p>Some HTML content</p>'
                }
            ]
        },
        expected: {
            isReply: false,
            messageId: null
        }
    }
];

// Helper functions need to be exported from bot.js for testing
// For now, we'll just define them here for testing
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

// Run tests
console.log('=== THREAD DETECTION TESTS ===\n');

testCases.forEach((testCase, index) => {
    console.log(`Test ${index + 1}: ${testCase.name}`);

    const isReply = isThreadReply(testCase.activity);
    const messageId = extractThreadMessageId(testCase.activity);

    const passedIsReply = isReply === testCase.expected.isReply;
    const passedMessageId = messageId === testCase.expected.messageId;

    console.log(`  - Is thread reply: ${isReply} (expected: ${testCase.expected.isReply}) ${passedIsReply ? '✅' : '❌'}`);
    console.log(`  - Message ID: ${messageId} (expected: ${testCase.expected.messageId}) ${passedMessageId ? '✅' : '❌'}`);
    console.log(`  - Overall: ${passedIsReply && passedMessageId ? '✅ PASSED' : '❌ FAILED'}\n`);
});

console.log('=== TEST COMPLETE ===');