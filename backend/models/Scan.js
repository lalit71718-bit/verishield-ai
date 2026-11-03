const mongoose = require('mongoose');

const scanSchema = new mongoose.Schema({
  userId :{ type: mongoose.Schema.Types.ObjectId, ref:'User', required:true},
  fileName: { type: String, required: true },
  fileType:{ type: String, required:true},
  fileHash: { type: String, required: true },
  detectionPercentage: { type: Number, required: true },
  riskPercentage: { type: Number, required: true },
  explanation: { type: String, required: true },
  artifacts: [{ type: String }],
  safeActions: [{ type: String }],
  scannedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Scan', scanSchema);