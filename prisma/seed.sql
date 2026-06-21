-- Create Jobs table
CREATE TABLE IF NOT EXISTS "Jobs" (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  company VARCHAR(255) NOT NULL,
  description TEXT,
  location VARCHAR(255),
  salary_min INTEGER,
  salary_max INTEGER,
  remote BOOLEAN DEFAULT false,
  postedAt TIMESTAMP DEFAULT NOW(),
  createdAt TIMESTAMP DEFAULT NOW()
);

-- Insert 50 sample jobs
INSERT INTO "Jobs" (title, company, description, location, salary_min, salary_max, remote) VALUES
('Senior React Developer', 'TechCorp', 'Build scalable web applications with React and TypeScript', 'Jakarta', 120000000, 180000000, false),
('Full Stack Engineer', 'StartupXYZ', 'Work on modern web stack - Node.js and React', 'Remote', 100000000, 150000000, true),
('Backend Developer', 'FinanceFlow', 'Develop robust backend services with Go or Python', 'Bandung', 110000000, 160000000, false),
('Frontend Engineer', 'DesignStudio', 'Create beautiful UIs with Vue.js and Tailwind CSS', 'Surabaya', 90000000, 140000000, false),
('DevOps Engineer', 'CloudSync', 'Manage infrastructure on AWS and Kubernetes', 'Remote', 130000000, 190000000, true),
('Data Scientist', 'AI Solutions', 'Build ML models for predictive analytics', 'Jakarta', 140000000, 200000000, false),
('QA Automation', 'SoftwareHub', 'Automate testing with Selenium and Python', 'Medan', 80000000, 120000000, false),
('Mobile Developer', 'AppFactory', 'Develop native and cross-platform mobile apps', 'Jakarta', 100000000, 160000000, false),
('System Administrator', 'Enterprise Corp', 'Manage company IT infrastructure and security', 'Remote', 95000000, 145000000, true),
('Product Manager', 'Innovation Lab', 'Lead product development and strategy', 'Jakarta', 150000000, 220000000, false),
('UX/UI Designer', 'Creative Agency', 'Design user interfaces for web and mobile', 'Yogyakarta', 85000000, 130000000, false),
('Database Administrator', 'DataVault', 'Manage PostgreSQL and MongoDB databases', 'Remote', 120000000, 170000000, true),
('Security Engineer', 'CyberGuard', 'Implement security solutions and perform penetration testing', 'Jakarta', 140000000, 210000000, false),
('Machine Learning Engineer', 'AI Ventures', 'Develop ML pipelines and model training infrastructure', 'Bandung', 130000000, 190000000, true),
('Cloud Architect', 'CloudNative', 'Design and implement cloud solutions on GCP/AWS/Azure', 'Remote', 160000000, 240000000, true),
('API Developer', 'TechServices', 'Build and maintain RESTful and GraphQL APIs', 'Surabaya', 105000000, 155000000, false),
('Platform Engineer', 'DevOps Plus', 'Build internal developer platforms and tools', 'Jakarta', 125000000, 185000000, false),
('Solutions Architect', 'EnterpriseSoft', 'Design enterprise software solutions for clients', 'Remote', 150000000, 230000000, true),
('Junior Developer', 'CodeBootcamp', 'Learn and grow with mentorship from experienced developers', 'Jakarta', 60000000, 90000000, false),
('Technical Lead', 'ProductCorp', 'Lead engineering team and technical decisions', 'Jakarta', 140000000, 210000000, false),
('Blockchain Developer', 'CryptoLabs', 'Build smart contracts and blockchain applications', 'Remote', 120000000, 180000000, true),
('Game Developer', 'GameStudio', 'Create engaging games using Unity or Unreal Engine', 'Jakarta', 100000000, 160000000, false),
('Data Engineer', 'BigData Inc', 'Build data pipelines and ETL systems', 'Bandung', 115000000, 170000000, true),
('Infrastructure Engineer', 'OpsCloud', 'Design and manage cloud infrastructure', 'Remote', 125000000, 185000000, true),
('Software Architect', 'ArchitectureFirst', 'Design large-scale software systems', 'Jakarta', 160000000, 250000000, false),
('Frontend Specialist', 'WebDev Pro', 'Specialize in modern frontend technologies', 'Remote', 100000000, 150000000, true),
('Backend Specialist', 'APIFirst', 'Specialize in backend API development', 'Jakarta', 110000000, 160000000, false),
('DevSecOps Engineer', 'SecureDevOps', 'Integrate security into CI/CD pipelines', 'Remote', 135000000, 195000000, true),
('Release Manager', 'DeployMaster', 'Manage software releases and deployment processes', 'Jakarta', 105000000, 155000000, false),
('Performance Engineer', 'SpeedOptimal', 'Optimize application and system performance', 'Remote', 120000000, 180000000, true),
('Site Reliability Engineer', 'ReliabilityFirst', 'Ensure system reliability and uptime', 'Jakarta', 130000000, 190000000, false),
('Testing Engineer', 'QualityAssurance', 'Design and implement testing frameworks', 'Medan', 85000000, 130000000, false),
('Integration Engineer', 'IntegrationHub', 'Integrate third-party systems and APIs', 'Remote', 100000000, 150000000, true),
('Automation Specialist', 'AutomationFirst', 'Automate business processes and workflows', 'Surabaya', 90000000, 140000000, false),
('Database Specialist', 'DataExpert', 'Specialize in database design and optimization', 'Jakarta', 125000000, 185000000, false),
('Search Engineer', 'SearchTech', 'Develop search and indexing solutions', 'Remote', 120000000, 180000000, true),
('Visualization Engineer', 'DataViz', 'Create interactive data visualizations', 'Yogyakarta', 100000000, 155000000, false),
('Analytics Engineer', 'DataAnalytics', 'Build analytics platforms and dashboards', 'Jakarta', 110000000, 165000000, false),
('Content Engineer', 'ContentTech', 'Build content management and delivery systems', 'Remote', 95000000, 145000000, true),
('Support Engineer', 'CustomerSuccess', 'Provide technical support and maintain customer relationships', 'Jakarta', 75000000, 120000000, false),
('Documentation Engineer', 'DocFirst', 'Create technical documentation and guides', 'Remote', 80000000, 130000000, true),
('Training Specialist', 'TrainingHub', 'Develop training programs and materials', 'Jakarta', 85000000, 135000000, false),
('Research Engineer', 'ResearchLab', 'Conduct research on emerging technologies', 'Remote', 130000000, 200000000, true),
('Innovation Engineer', 'InnovationHub', 'Drive innovation and proof of concepts', 'Jakarta', 120000000, 180000000, false),
('Partnership Engineer', 'PartnerFirst', 'Build and manage technical partnerships', 'Remote', 105000000, 160000000, true),
('Community Manager', 'DevCommunity', 'Manage developer communities and engagement', 'Jakarta', 85000000, 130000000, false),
('Technical Writer', 'TechDocs', 'Write technical documentation and tutorials', 'Remote', 80000000, 130000000, true),
('Developer Advocate', 'DevAdvocate', 'Advocate for technology and build developer relations', 'Jakarta', 100000000, 160000000, false);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_jobs_title ON "Jobs"(title);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON "Jobs"(company);
CREATE INDEX IF NOT EXISTS idx_jobs_location ON "Jobs"(location);
CREATE INDEX IF NOT EXISTS idx_jobs_remote ON "Jobs"(remote);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON "Jobs"("postedAt");
