const express = require('express');
const router = express.Router();
const { analyzeUrl, getUserUrlScans } = require('../controllers/urlController');
// Optional: include your auth middleware if you have one protecting routes
// const auth = require('../middleware/auth'); 

router.post('/check', analyzeUrl);
router.get('/history', getUserUrlScans);

// Also support root-level post for convenience
router.post('/', analyzeUrl);

module.exports = router;