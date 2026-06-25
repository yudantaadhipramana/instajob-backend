const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seed() {
  console.log('Seeding 50 sample jobs...');
  
  const companies = [
    'TechCorp', 'StartupXYZ', 'DataFlow', 'CloudPlatform', 'SaaSCo',
    'QATeam', 'DesignStudio', 'AILabs', 'Analytics Inc', 'MobileFirst',
    'CloudExperts', 'WebDev Corp', 'PyTech', 'SecureNet', 'DataCore',
    'EnterpriseSoft', 'AngularShop', 'APIHub', 'TechLeaders', 'ReliableOps',
    'QALeadership', 'GoSystems', 'RustTeam', 'JavaCorp', 'CppStudio',
    'AppleDev', 'AndroidStudio', 'CryptoTech', 'DataWarehouse', 'SalesForce',
    'DocTeam', 'AgileCoach', 'BITeam', 'NetOps', 'SysAdmin Co',
    'GameStudio', 'MetaverseLab', 'IoTDevices', 'VisionAI', 'LanguageTech',
    'FastApps', 'DeployOps', 'InfraCo', 'AutomateIt', 'IntegrationHub',
    'PlatformTeam', 'SearchCo', 'ObserveLabs', 'EmailPro', 'RTCTeam'
  ];

  const locations = [
    'Jakarta', 'Bandung', 'Surabaya', 'Yogyakarta', 'Bali',
    'Semarang', 'Medan', 'Makassar', 'Palembang', 'Manado'
  ];

  const jobTemplates = [
    { title: 'Senior Frontend Engineer', desc: 'Build scalable React applications with TypeScript', salaryMin: 150000000, salaryMax: 200000000 },
    { title: 'Full Stack Developer', desc: 'Node.js + React role for growing startup', salaryMin: 120000000, salaryMax: 160000000 },
    { title: 'Backend Engineer', desc: 'PostgreSQL and Fastify expertise required', salaryMin: 130000000, salaryMax: 180000000 },
    { title: 'DevOps Engineer', desc: 'AWS, Docker, Kubernetes experience', salaryMin: 140000000, salaryMax: 190000000 },
    { title: 'Product Manager', desc: 'Lead product strategy for SaaS platform', salaryMin: 160000000, salaryMax: 220000000 },
    { title: 'QA Automation Engineer', desc: 'Selenium and Jest automation testing', salaryMin: 100000000, salaryMax: 140000000 },
    { title: 'UI/UX Designer', desc: 'Design mobile apps with Figma', salaryMin: 110000000, salaryMax: 150000000 },
    { title: 'Machine Learning Engineer', desc: 'Python, TensorFlow, computer vision', salaryMin: 170000000, salaryMax: 250000000 },
    { title: 'Data Analyst', desc: 'SQL and Tableau dashboard creation', salaryMin: 100000000, salaryMax: 130000000 },
    { title: 'Mobile Developer', desc: 'React Native cross-platform development', salaryMin: 120000000, salaryMax: 170000000 },
  ];

  const jobs = [];
  for (let i = 0; i < 50; i++) {
    const template = jobTemplates[i % jobTemplates.length];
    const company = companies[i];
    const location = locations[i % locations.length];
    const isRemote = Math.random() > 0.4; // 60% remote
    const daysAgo = Math.floor(Math.random() * 30);
    const expiresDays = 30 + Math.floor(Math.random() * 60);
    
    jobs.push({
      title: `${template.title} ${i >= 40 ? 'Senior' : ''}`.trim(),
      description: template.desc,
      company,
      location,
      salaryMin: template.salaryMin,
      salaryMax: template.salaryMax,
      remote: isRemote,
      postedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
      expiresAt: new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000),
    });
  }

  const created = await prisma.job.createMany({ data: jobs });
  console.log(`✓ Created ${created.count} jobs`);
  
  await prisma.$disconnect();
  console.log('Seed completed!');
}

seed().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
