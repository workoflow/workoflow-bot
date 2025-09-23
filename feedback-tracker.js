// In-memory storage for tracking daily feedback
const feedbackTracker = {};

// Log initialization to detect module reloading
console.log(`[FEEDBACK DEBUG] feedback-tracker.js initialized at ${new Date().toISOString()} - PID: ${process.pid}`);

// Helper function to get today's date in YYYY-MM-DD format
function getTodayDate() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Check if we should ask for feedback from this user
function shouldAskForFeedback(userId) {
    if (!userId) return false;

    const today = getTodayDate();
    const userRecord = feedbackTracker[userId];

    console.log(`[FEEDBACK DEBUG] Checking shouldAskForFeedback for userId: ${userId}`);
    console.log(`[FEEDBACK DEBUG] Current date: ${today}`);
    console.log(`[FEEDBACK DEBUG] User record:`, userRecord);
    console.log(`[FEEDBACK DEBUG] All tracked users:`, Object.keys(feedbackTracker));

    // If no record exists, we should ask
    if (!userRecord) {
        console.log(`[FEEDBACK DEBUG] No record exists - will ask for feedback`);
        return true;
    }

    // If record exists but for a different day, we should ask
    if (userRecord.date !== today) {
        console.log(`[FEEDBACK DEBUG] Record exists but for different day (${userRecord.date}) - will ask for feedback`);
        return true;
    }

    // If feedback was already prompted or given today, don't ask again
    const shouldAsk = !userRecord.feedbackPrompted && !userRecord.feedbackGiven;
    console.log(`[FEEDBACK DEBUG] feedbackPrompted: ${userRecord.feedbackPrompted}, feedbackGiven: ${userRecord.feedbackGiven}`);
    console.log(`[FEEDBACK DEBUG] Should ask for feedback: ${shouldAsk}`);
    return shouldAsk;
}

// Mark that feedback was given (or dismissed) by a user
function markFeedbackGiven(userId, rating = null) {
    if (!userId) return;

    const today = getTodayDate();
    console.log(`[FEEDBACK DEBUG] markFeedbackGiven called for userId: ${userId}, rating: ${rating}`);

    feedbackTracker[userId] = {
        date: today,
        feedbackGiven: true,
        feedbackPrompted: true, // Preserve that feedback was prompted
        rating: rating,
        timestamp: new Date().toISOString()
    };

    console.log(`[FEEDBACK DEBUG] Updated user record:`, feedbackTracker[userId]);
    console.log(`[FEEDBACK DEBUG] All tracked users after update:`, Object.keys(feedbackTracker));
}

// Mark that we've interacted with a user today (but haven't asked for feedback yet)
function markUserInteraction(userId) {
    if (!userId) return;

    const today = getTodayDate();

    // Only update if user doesn't have a record for today
    if (!feedbackTracker[userId] || feedbackTracker[userId].date !== today) {
        feedbackTracker[userId] = {
            date: today,
            feedbackGiven: false,
            feedbackPrompted: false,
            firstInteraction: new Date().toISOString()
        };
    }
}

// Mark that feedback has been prompted to the user
function markFeedbackPrompted(userId) {
    if (!userId) return;

    const today = getTodayDate();
    console.log(`[FEEDBACK DEBUG] markFeedbackPrompted called for userId: ${userId}`);

    // Initialize record if it doesn't exist
    if (!feedbackTracker[userId] || feedbackTracker[userId].date !== today) {
        feedbackTracker[userId] = {
            date: today,
            feedbackGiven: false,
            feedbackPrompted: true,
            promptedAt: new Date().toISOString()
        };
    } else {
        // Update existing record
        feedbackTracker[userId].feedbackPrompted = true;
        feedbackTracker[userId].promptedAt = new Date().toISOString();
    }

    console.log(`[FEEDBACK DEBUG] Updated user record:`, feedbackTracker[userId]);
    console.log(`[FEEDBACK DEBUG] All tracked users after prompt:`, Object.keys(feedbackTracker));
}

// Get feedback status for a user
function getFeedbackStatus(userId) {
    if (!userId) return null;
    return feedbackTracker[userId] || null;
}

// Clean up old entries (optional - can be called periodically)
function cleanupOldEntries() {
    const today = getTodayDate();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    Object.keys(feedbackTracker).forEach(userId => {
        if (feedbackTracker[userId].date !== today && feedbackTracker[userId].date !== yesterdayStr) {
            delete feedbackTracker[userId];
        }
    });
}

// Optional: Run cleanup every hour
setInterval(cleanupOldEntries, 60 * 60 * 1000);

module.exports = {
    shouldAskForFeedback,
    markFeedbackGiven,
    markUserInteraction,
    markFeedbackPrompted,
    getFeedbackStatus,
    cleanupOldEntries
};