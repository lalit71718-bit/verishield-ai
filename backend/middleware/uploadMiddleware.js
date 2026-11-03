const multer = require('multer');

// Store uploaded file in RAM (req.file.buffer) for fast hashing & AI analysis
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 } // 15 MB limit
});

module.exports = upload;