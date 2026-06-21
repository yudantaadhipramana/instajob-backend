"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findUserByEmail = findUserByEmail;
exports.findUserByGoogleId = findUserByGoogleId;
exports.createGoogleUser = createGoogleUser;
exports.createUser = createUser;
exports.updateUserGoogle = updateUserGoogle;
exports.getOrCreateGoogleUser = getOrCreateGoogleUser;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
});
/**
 * Find user by email
 */
async function findUserByEmail(email) {
    const result = await pool.query('SELECT * FROM "User" WHERE email = $1', [email]);
    return result.rows[0] || null;
}
/**
 * Find user by Google ID
 */
async function findUserByGoogleId(googleId) {
    const result = await pool.query('SELECT * FROM "User" WHERE "googleId" = $1', [googleId]);
    return result.rows[0] || null;
}
/**
 * Create new user from Google OAuth
 */
async function createGoogleUser(data) {
    const id = require('uuid').v4();
    const result = await pool.query(`INSERT INTO "User" (id, email, "fullName", "googleId", "avatarUrl", "emailVerified", "subscriptionType")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`, [id, data.email, data.fullName, data.googleId, data.avatarUrl || null, true, 'free']);
    return result.rows[0];
}
/**
 * Create new user with email/password
 */
async function createUser(data) {
    const id = require('uuid').v4();
    const referralCode = require('uuid').v4().substring(0, 8);
    const result = await pool.query(`INSERT INTO "User" (id, email, "fullName", "passwordHash", "referralCode", "emailVerified", "subscriptionType")
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`, [id, data.email, data.fullName, data.password, referralCode, false, 'free']);
    return result.rows[0];
}
/**
 * Update user Google info
 */
async function updateUserGoogle(userId, data) {
    const result = await pool.query(`UPDATE "User" 
     SET "googleId" = $1, "avatarUrl" = $2, "emailVerified" = true, "updatedAt" = NOW()
     WHERE id = $3
     RETURNING *`, [data.googleId, data.avatarUrl || null, userId]);
    return result.rows[0];
}
/**
 * Get or create user from Google OAuth
 */
async function getOrCreateGoogleUser(data) {
    // Check if user exists by Google ID
    let user = await findUserByGoogleId(data.googleId);
    if (user)
        return user;
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
//# sourceMappingURL=db.js.map