const express = require('express');
const router = express.Router();
const upload = require('../middleware/uploadMiddleware');
const protect = require('../middleware/authMiddleware');
const { optionalAuth } = protect;
const { checkDocument, livenessChallenges, checkLiveness, checkVoice, history } = require('../controllers/kycController');

// Checks are public so a bank officer can try them without an account.
// When a valid token is sent, the verdict is also saved to that account.
router.post('/document', optionalAuth, upload.single('document'), checkDocument);
router.get('/liveness/challenges', livenessChallenges);
router.post('/liveness', optionalAuth, checkLiveness);
router.post('/voice', optionalAuth, checkVoice);
router.get('/history', protect, history);

module.exports = router;
