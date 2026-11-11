const express = require('express');
const router = express.Router();
const { analyzeUrl, getUserUrlScans } = require('../controllers/urlController');
const protect = require('../middleware/authMiddleware');
const { optionalAuth } = protect;

// Public, but saves the scan against the account when a valid token is sent
router.post('/check', optionalAuth, analyzeUrl);
// History is per-user and requires sign-in
router.get('/history', protect, getUserUrlScans);

// Also support root-level post for convenience
router.post('/', optionalAuth, analyzeUrl);

module.exports = router;