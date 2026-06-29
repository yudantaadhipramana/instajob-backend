const jwt = require('jsonwebtoken');
const bcryptjs = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key-change-in-production';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key-change-in-production';
const JWT_EXPIRY = '24h';
const JWT_REFRESH_EXPIRY = '7d';

/**
 * Hash password using bcrypt
 */
async function hashPassword(password) {
  const salt = await bcryptjs.genSalt(10);
  return await bcryptjs.hash(password, salt);
}

/**
 * Compare password with hash
 */
async function comparePasswords(password, hash) {
  return await bcryptjs.compare(password, hash);
}

/**
 * Generate JWT access token
 */
function generateAccessToken(user) {
  return jwt.sign(user, JWT_SECRET, {
    expiresIn: JWT_EXPIRY,
    algorithm: 'HS256',
  });
}

/**
 * Generate JWT refresh token
 */
function generateRefreshToken(user) {
  return jwt.sign(user, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRY,
    algorithm: 'HS256',
  });
}

/**
 * Generate both access & refresh tokens
 */
function generateTokens(user) {
  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  return {
    accessToken,
    refreshToken,
    expiresIn: JWT_EXPIRY,
  };
}

/**
 * Verify access token
 */
function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Verify refresh token
 */
function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Register new user
 */
async function registerUser(email, password, fullName) {
  // Check if user already exists
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new Error('Email already registered');
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Generate referral code
  const referralCode = crypto.randomBytes(6).toString('hex').toUpperCase();

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      fullName,
      referralCode,
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      subscriptionType: true,
      createdAt: true,
    },
  });

  // Create user profile
  await prisma.userProfile.create({
    data: {
      userId: user.id,
      bio: '',
      location: '',
    },
  });

  // Generate tokens
  const tokens = generateTokens({
    id: user.id,
    email: user.email,
    subscriptionType: user.subscriptionType,
  });

  return { user, tokens };
}

/**
 * Login user
 */
async function loginUser(email, password) {
  // Find user by email
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error('Email or password incorrect');
  }

  // Compare passwords
  const isPasswordValid = await comparePasswords(password, user.passwordHash);
  if (!isPasswordValid) {
    throw new Error('Email or password incorrect');
  }

  // Generate tokens
  const tokens = generateTokens({
    id: user.id,
    email: user.email,
    subscriptionType: user.subscriptionType,
  });

  // Return user without password hash
  const userWithoutPassword = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    subscriptionType: user.subscriptionType,
    createdAt: user.createdAt,
  };

  return { user: userWithoutPassword, tokens };
}

/**
 * Refresh access token
 */
async function refreshAccessToken(refreshToken) {
  // Verify refresh token
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) {
    throw new Error('Invalid or expired refresh token');
  }

  // Generate new access token
  const accessToken = generateAccessToken(decoded);

  return {
    accessToken,
    refreshToken,
    expiresIn: JWT_EXPIRY,
  };
}

/**
 * Get user by ID
 */
async function getUserById(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      subscriptionType: true,
      referralCode: true,
      points: true,
      level: true,
      createdAt: true,
      profile: true,
    },
  });

  if (!user) {
    throw new Error('User not found');
  }

  return user;
}

/**
 * Update user profile
 */
async function updateUserProfile(userId, data) {
  // Update user
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      fullName: data.fullName,
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      subscriptionType: true,
      createdAt: true,
    },
  });

  // Update user profile
  if (data.bio || data.location || data.skills || data.experience || data.education) {
    await prisma.userProfile.update({
      where: { userId },
      data: {
        bio: data.bio,
        location: data.location,
        skills: data.skills ? JSON.stringify(data.skills) : undefined,
        experience: data.experience,
        education: data.education,
      },
    });
  }

  return user;
}

/**
 * Change user password
 */
async function changeUserPassword(userId, oldPassword, newPassword) {
  // Get user
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new Error('User not found');
  }

  // Verify old password
  const isPasswordValid = await comparePasswords(oldPassword, user.passwordHash);
  if (!isPasswordValid) {
    throw new Error('Current password is incorrect');
  }

  // Hash new password
  const passwordHash = await hashPassword(newPassword);

  // Update password
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
}

// Export functions
module.exports = {
  hashPassword,
  comparePasswords,
  generateAccessToken,
  generateRefreshToken,
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
  registerUser,
  loginUser,
  refreshAccessToken,
  getUserById,
  updateUserProfile,
  changeUserPassword,
};
