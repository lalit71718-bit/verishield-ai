const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'verishield_super_secret_key');

      // Handles any token payload structure (id, _id, userId, or nested user object)
      const userId = decoded.id || decoded._id || decoded.userId || (decoded.user && (decoded.user._id || decoded.user.id));
      req.user = await User.findById(userId).select('-password');

      if (!req.user) {
        return res.status(401).json({ error: 'User not found, please log in again' });
      }
      return next();
    } catch (error) {
      console.error('JWT Verification Error:', error.message);
      return res.status(401).json({ error: 'Not authorized, token failed' });
    }
  }

  return res.status(401).json({ error: 'Not authorized, no token provided' });
};

protect.protect = protect;
module.exports = protect;