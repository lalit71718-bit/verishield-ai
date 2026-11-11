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

// Attaches req.user when a valid Bearer token is present, but never rejects.
// For public routes that should still record the signed-in user.
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer')) {
    try {
      const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET || 'verishield_super_secret_key');
      const userId = decoded.id || decoded._id || decoded.userId || (decoded.user && (decoded.user._id || decoded.user.id));
      const user = await User.findById(userId).select('-password');
      if (user) req.user = user;
    } catch (error) {
      // Missing/expired/invalid token: continue as an anonymous request
    }
  }
  return next();
};

protect.protect = protect;
protect.optionalAuth = optionalAuth;
module.exports = protect;