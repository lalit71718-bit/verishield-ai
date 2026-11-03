const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const protect = require('../middleware/authMiddleware');

const registerHandler = authController.registerUser || authController.register;
const loginHandler = authController.loginUser || authController.login;
const profileHandler = authController.getUserProfile || authController.getProfile || ((req, res) => {
  res.json(req.user);
});

router.post('/register', registerHandler);
router.post('/login', loginHandler);
router.get('/profile', protect, profileHandler);
router.get('/me', protect, profileHandler);

module.exports = router;