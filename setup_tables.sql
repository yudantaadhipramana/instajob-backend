-- Drop existing tables if any
DROP TABLE IF EXISTS "Application" CASCADE;
DROP TABLE IF EXISTS "Job" CASCADE;
DROP TABLE IF EXISTS "UserProfile" CASCADE;
DROP TABLE IF EXISTS "Subscription" CASCADE;
DROP TABLE IF EXISTS "Notification" CASCADE;

-- Create Job table
CREATE TABLE "Job" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  company TEXT NOT NULL,
  location TEXT NOT NULL,
  salaryMin INTEGER,
  salaryMax INTEGER,
  remote BOOLEAN DEFAULT false,
  postedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expiresAt TIMESTAMP
);

-- Create User table with correct structure
CREATE TABLE "User" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  fullName TEXT,
  subscriptionType TEXT DEFAULT 'free',
  referralCode TEXT UNIQUE,
  telegramChatId TEXT UNIQUE,
  isTelegramLinked BOOLEAN DEFAULT false,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create UserProfile table
CREATE TABLE "UserProfile" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  userId TEXT NOT NULL UNIQUE,
  bio TEXT,
  skills TEXT[] DEFAULT '{}',
  experience TEXT,
  location TEXT,
  resumeUrl TEXT,
  FOREIGN KEY("userId") REFERENCES "User"(id) ON DELETE CASCADE
);

-- Create Application table
CREATE TABLE "Application" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  userId TEXT NOT NULL,
  jobId TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  appliedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  UNIQUE(userId, jobId),
  FOREIGN KEY(userId) REFERENCES "User"(id) ON DELETE CASCADE,
  FOREIGN KEY(jobId) REFERENCES "Job"(id) ON DELETE CASCADE
);

-- Create Subscription table
CREATE TABLE "Subscription" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  userId TEXT NOT NULL UNIQUE,
  plan TEXT DEFAULT 'free',
  expiresAt TIMESTAMP,
  features TEXT[],
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(userId) REFERENCES "User"(id) ON DELETE CASCADE
);

-- Create Notification table
CREATE TABLE "Notification" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  userId TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  isRead BOOLEAN DEFAULT false,
  type TEXT,
  sentToTelegram BOOLEAN DEFAULT false,
  createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(userId) REFERENCES "User"(id) ON DELETE CASCADE
);
