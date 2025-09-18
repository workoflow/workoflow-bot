// In-memory storage for tracking daily feedback
const feedbackTracker = {};

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

    // If no record exists, we should ask
    if (!userRecord) {
        return true;
    }

    // If record exists but for a different day, we should ask
    if (userRecord.date !== today) {
        return true;
    }

    // If record exists for today and feedback was given, don't ask
    return !userRecord.feedbackGiven;
}

// Mark that feedback was given (or dismissed) by a user
function markFeedbackGiven(userId, rating = null) {
    if (!userId) return;

    const today = getTodayDate();
    feedbackTracker[userId] = {
        date: today,
        feedbackGiven: true,
        rating: rating,
        timestamp: new Date().toISOString()
    };
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
            firstInteraction: new Date().toISOString()
        };
    }
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
    getFeedbackStatus,
    cleanupOldEntries
};