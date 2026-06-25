"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canUserApply = canUserApply;
exports.incrementApplyCount = incrementApplyCount;
exports.getUserQuota = getUserQuota;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const DAILY_LIMIT = 5; // Max 5 applications per day
const COOLDOWN_MINUTES = 30; // 30 min cooldown between applies
/**
 * Check if user can apply right now
 */
async function canUserApply(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { subscriptionType: true }
    });
    const isPremium = user?.subscriptionType === 'premium' || user?.subscriptionType === 'pro';
    let quota = await prisma.applyQuota.findUnique({ where: { userId } });
    // Initialize quota if doesn't exist
    if (!quota) {
        quota = await prisma.applyQuota.create({
            data: { userId },
        });
    }
    // Reset daily counter if it's a new day
    const now = new Date();
    const lastReset = new Date(quota.lastResetAt);
    const isNewDay = now.toDateString() !== lastReset.toDateString();
    if (isNewDay) {
        quota = await prisma.applyQuota.update({
            where: { userId },
            data: {
                appliedToday: 0,
                lastResetAt: now,
            },
        });
    }
    if (isPremium) {
        return {
            appliedToday: quota.appliedToday,
            remainingToday: 999999,
            canApply: true,
            dailyLimit: 999999,
            totalApplied: quota.totalApplied,
        };
    }
    // Check if reached daily limit
    const reachedLimit = quota.appliedToday >= DAILY_LIMIT;
    const remainingToday = Math.max(0, DAILY_LIMIT - quota.appliedToday);
    return {
        appliedToday: quota.appliedToday,
        remainingToday,
        canApply: !reachedLimit,
        dailyLimit: DAILY_LIMIT,
        totalApplied: quota.totalApplied,
    };
}
/**
 * Increment apply counter (call after successful application)
 */
async function incrementApplyCount(userId) {
    await prisma.applyQuota.update({
        where: { userId },
        data: {
            appliedToday: { increment: 1 },
            totalApplied: { increment: 1 },
        },
    });
}
/**
 * Get user's quota details
 */
async function getUserQuota(userId) {
    return canUserApply(userId);
}
