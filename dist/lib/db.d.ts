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
export declare function findUserByEmail(email: string): Promise<UserRow | null>;
/**
 * Find user by Google ID
 */
export declare function findUserByGoogleId(googleId: string): Promise<UserRow | null>;
/**
 * Create new user from Google OAuth
 */
export declare function createGoogleUser(data: {
    email: string;
    fullName: string;
    googleId: string;
    avatarUrl?: string;
}): Promise<UserRow>;
/**
 * Create new user with email/password
 */
export declare function createUser(data: {
    fullName: string;
    email: string;
    password: string;
}): Promise<UserRow>;
/**
 * Update user Google info
 */
export declare function updateUserGoogle(userId: string, data: {
    googleId: string;
    avatarUrl?: string;
}): Promise<UserRow>;
/**
 * Get or create user from Google OAuth
 */
export declare function getOrCreateGoogleUser(data: {
    email: string;
    fullName: string;
    googleId: string;
    avatarUrl?: string;
}): Promise<UserRow>;
//# sourceMappingURL=db.d.ts.map