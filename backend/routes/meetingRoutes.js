const express = require('express');
const router = express.Router();
const { analyze, saveSession, history } = require('../controllers/meetingController');
const protect = require('../middleware/authMiddleware');

// Scoring is public so the guard works without an account.
router.post('/analyze', analyze);
// Saved sessions belong to a signed-in user.
router.post('/sessions', protect, saveSession);
router.get('/history', protect, history);

module.exports = router;
