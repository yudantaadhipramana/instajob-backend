import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:***@127.0.0.1:5432/instajob_db';

export const pool = new Pool({
  connectionString: DATABASE_URL,
});

export interface UserRow {
  id: string;
  email: string;
  fullName: string;
  password?: string;
  googleId?: string;
  avatarUrl?: string;
  emailVerified: boolean;
  subscriptionType: string;
}

/**
 * Find user by email
 */
export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const result = await pool.query(
    'SELECT * FROM "User" WHERE email = $1',
    [email]
  );
  return result.rows[0] || null;
}

/**
 * Find user by Google ID
 */
export async function findUserByGoogleId(googleId: string): Promise<UserRow | null> {
  const result = await pool.query(
    'SELECT * FROM "User" WHERE "googleId" = $1',
    [googleId]
  );
  return result.rows[0] || null;
}

/**
 * Create new user from Google OAuth
 */
export async function createGoogleUser(data: {
  email: string;
  fullName: string;
  googleId: string;
  avatarUrl?: string;
}): Promise<UserRow> {
  const crypto = require('crypto');
  const id = crypto.randomUUID();
  
  const result = await pool.query(
    `INSERT INTO "User" (id, email, "fullName", "googleId", "avatarUrl", "emailVerified", "subscriptionType")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [id, data.email, data.fullName, data.googleId, data.avatarUrl || null, true, 'free']
  );
  
  return result.rows[0];
}

/**
 * Create new user with email/password
 */
export async function createUser(data: {
  fullName: string;
  email: string;
  password: string;
}): Promise<UserRow> {
  const crypto = require('crypto');
  const referralCode = crypto.randomUUID().substring(0, 8);
  
  const result = await pool.query(
    `INSERT INTO "User" (email, "fullName", "password", "referralCode", "emailVerified", "subscriptionType")
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [data.email, data.fullName, data.password, referralCode, false, 'free']
  );
  
  return result.rows[0];
}

/**
 * Update user Google info
 */
export async function updateUserGoogle(userId: string, data: {
  googleId: string;
  avatarUrl?: string;
}): Promise<UserRow> {
  const result = await pool.query(
    `UPDATE "User" 
     SET "googleId" = $1, "avatarUrl" = $2, "emailVerified" = true, "updatedAt" = NOW()
     WHERE id = $3
     RETURNING *`,
    [data.googleId, data.avatarUrl || null, userId]
  );
  
  return result.rows[0];
}

/**
 * Get or create user from Google OAuth
 */
export async function getOrCreateGoogleUser(data: {
  email: string;
  fullName: string;
  googleId: string;
  avatarUrl?: string;
}): Promise<UserRow> {
  // Check if user exists by Google ID
  let user = await findUserByGoogleId(data.googleId);
  if (user) return user;

  // Check if user exists by email
  user = await findUserByEmail(data.email);
  if (user) {
    // Update with Google info
    return updateUserGoogle(user.id, {
      googleId: data.googleId,
      avatarUrl: data.avatarUrl,
    });
  }

  // Create new user
  return createGoogleUser(data);
}
