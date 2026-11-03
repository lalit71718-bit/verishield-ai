const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const protect = require('../middleware/authMiddleware');
const { scanMedia, scanText, getUserScans } = require('../controllers/scanController');

// Automatically create 'uploads' directory if it doesn't exist
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// upload.any() accepts 'media', 'file', or any field name sent by the frontend
router.post('/media', protect, upload.any(), scanMedia);
router.post('/text', protect, scanText);
router.get('/history', protect, getUserScans);
router.get('/vault', protect, getUserScans);

module.exports = router;