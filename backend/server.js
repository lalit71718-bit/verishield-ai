require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const scanRoutes = require('./routes/scanRoutes');
const urlRoutes = require('./routes/urlRoutes');

const app = express();

connectDB();

app.use(cors());
app.use(express.json());
app.use('/api/url', urlRoutes);

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/scan', scanRoutes);

app.get('/', (req, res) => {
  res.json({ status: 'VeriShield AI v2.0 Backend is running!' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend Server running on http://localhost:${PORT}`));