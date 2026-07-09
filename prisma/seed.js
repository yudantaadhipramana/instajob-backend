const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  // Seed debug user
  const debugUserId = 'debug-user-id';
  const existing = await prisma.user.findUnique({ where: { id: debugUserId } });
  if (!existing) {
    const hash = await bcrypt.hash('test123', 10);
    await prisma.user.create({
      data: {
        id: debugUserId,
        email: 'debug@instajob.test',
        passwordHash: hash,
        fullName: 'Debug User',
        referralCode: 'DEBUG001',
      },
    });
    console.log('Seeded debug user.');
  } else {
    console.log('Debug user already exists, skipped.');
  }

  const jobs = [
    // Technology
    { title: 'Frontend Developer', company: 'Tokopedia', location: 'Jakarta', salaryMin: 8000000, salaryMax: 15000000, remote: true, industry: 'Technology', requiredSkills: '["React","TypeScript","Next.js"]' },
    { title: 'Backend Engineer', company: 'Gojek', location: 'Jakarta', salaryMin: 10000000, salaryMax: 20000000, remote: true, industry: 'Technology', requiredSkills: '["Node.js","PostgreSQL","Docker"]' },
    { title: 'Full Stack Developer', company: 'Koinworks', location: 'Jakarta', salaryMin: 8000000, salaryMax: 14000000, remote: true, industry: 'Fintech', requiredSkills: '["Vue.js","Laravel","MySQL"]' },
    { title: 'Data Scientist', company: 'Bukalapak', location: 'Bandung', salaryMin: 12000000, salaryMax: 22000000, remote: true, industry: 'Technology', requiredSkills: '["Python","TensorFlow","SQL"]' },
    { title: 'DevOps Engineer', company: 'Traveloka', location: 'Jakarta', salaryMin: 11000000, salaryMax: 18000000, remote: true, industry: 'Travel', requiredSkills: '["Kubernetes","AWS","CI/CD"]' },
    { title: 'Mobile Developer', company: 'OVO', location: 'Jakarta', salaryMin: 9000000, salaryMax: 16000000, remote: false, industry: 'Fintech', requiredSkills: '["Flutter","React Native","Kotlin"]' },
    { title: 'Product Manager', company: 'Grab', location: 'Jakarta', salaryMin: 15000000, salaryMax: 25000000, remote: true, industry: 'Technology', requiredSkills: '["Product Strategy","Agile","Analytics"]' },
    { title: 'UI/UX Designer', company: 'Shopee', location: 'Jakarta', salaryMin: 7000000, salaryMax: 12000000, remote: false, industry: 'E-Commerce', requiredSkills: '["Figma","Design System","User Research"]' },
    // New jobs
    { title: 'Software Engineer', company: 'Gojek', location: 'Jakarta', salaryMin: 12000000, salaryMax: 22000000, remote: true, industry: 'Technology', requiredSkills: '["Java","Spring Boot","Microservices"]' },
    { title: 'Data Engineer', company: 'Tokopedia', location: 'Jakarta', salaryMin: 11000000, salaryMax: 20000000, remote: true, industry: 'Technology', requiredSkills: '["Python","Spark","Kafka","Airflow"]' },
    { title: 'Android Developer', company: 'Shopee', location: 'Jakarta', salaryMin: 9000000, salaryMax: 17000000, remote: false, industry: 'E-Commerce', requiredSkills: '["Kotlin","Android SDK","Jetpack Compose"]' },
    { title: 'iOS Developer', company: 'Grab', location: 'Jakarta', salaryMin: 10000000, salaryMax: 18000000, remote: true, industry: 'Technology', requiredSkills: '["Swift","SwiftUI","Xcode"]' },
    { title: 'Machine Learning Engineer', company: 'Bukalapak', location: 'Bandung', salaryMin: 14000000, salaryMax: 25000000, remote: true, industry: 'Technology', requiredSkills: '["Python","PyTorch","MLflow","Kubernetes"]' },
    { title: 'Cloud Architect', company: 'Traveloka', location: 'Jakarta', salaryMin: 18000000, salaryMax: 30000000, remote: true, industry: 'Travel', requiredSkills: '["AWS","GCP","Terraform","Docker"]' },
    { title: 'QA Engineer', company: 'OVO', location: 'Jakarta', salaryMin: 7000000, salaryMax: 13000000, remote: false, industry: 'Fintech', requiredSkills: '["Selenium","Jest","Cypress","API Testing"]' },
    { title: 'Site Reliability Engineer', company: 'Koinworks', location: 'Jakarta', salaryMin: 13000000, salaryMax: 22000000, remote: true, industry: 'Fintech', requiredSkills: '["Linux","Prometheus","Grafana","Go"]' },
    { title: 'Cybersecurity Analyst', company: 'BRI', location: 'Jakarta', salaryMin: 10000000, salaryMax: 18000000, remote: false, industry: 'Banking', requiredSkills: '["Penetration Testing","SIEM","ISO 27001"]' },
    { title: 'Blockchain Developer', company: 'Indodax', location: 'Jakarta', salaryMin: 12000000, salaryMax: 22000000, remote: true, industry: 'Fintech', requiredSkills: '["Solidity","Ethereum","Web3.js","Smart Contracts"]' },
    { title: 'React Native Developer', company: 'Dana', location: 'Jakarta', salaryMin: 9000000, salaryMax: 16000000, remote: true, industry: 'Fintech', requiredSkills: '["React Native","TypeScript","Redux"]' },
    { title: 'Backend Developer', company: 'Tiket.com', location: 'Jakarta', salaryMin: 9000000, salaryMax: 17000000, remote: true, industry: 'Travel', requiredSkills: '["Go","gRPC","Redis","PostgreSQL"]' },
    { title: 'Frontend Engineer', company: 'Tokopedia', location: 'Jakarta', salaryMin: 10000000, salaryMax: 18000000, remote: true, industry: 'Technology', requiredSkills: '["Vue.js","Nuxt.js","TypeScript","GraphQL"]' },
    { title: 'Platform Engineer', company: 'Gojek', location: 'Jakarta', salaryMin: 15000000, salaryMax: 25000000, remote: true, industry: 'Technology', requiredSkills: '["Kubernetes","Istio","Helm","Terraform"]' },
    { title: 'Data Analyst', company: 'Shopee', location: 'Jakarta', salaryMin: 7000000, salaryMax: 13000000, remote: false, industry: 'E-Commerce', requiredSkills: '["SQL","Python","Tableau","Power BI"]' },
    { title: 'Business Intelligence Developer', company: 'Grab', location: 'Jakarta', salaryMin: 10000000, salaryMax: 17000000, remote: true, industry: 'Technology', requiredSkills: '["SQL","dbt","Looker","Airflow"]' },
    { title: 'Software Architect', company: 'Traveloka', location: 'Jakarta', salaryMin: 20000000, salaryMax: 35000000, remote: true, industry: 'Travel', requiredSkills: '["System Design","Microservices","DDD","Event-Driven"]' },
    { title: 'Technical Lead', company: 'Bukalapak', location: 'Bandung', salaryMin: 18000000, salaryMax: 30000000, remote: true, industry: 'Technology', requiredSkills: '["Java","Leadership","Architecture","Agile"]' },
    { title: 'Scrum Master', company: 'OVO', location: 'Jakarta', salaryMin: 10000000, salaryMax: 18000000, remote: false, industry: 'Fintech', requiredSkills: '["Agile","Scrum","JIRA","Team Management"]' },
    { title: 'Game Developer', company: 'Agate Studio', location: 'Bandung', salaryMin: 8000000, salaryMax: 15000000, remote: false, industry: 'Gaming', requiredSkills: '["Unity","C#","Game Design","3D Modeling"]' },
    { title: 'AR/VR Developer', company: 'Agate Studio', location: 'Bandung', salaryMin: 10000000, salaryMax: 18000000, remote: false, industry: 'Gaming', requiredSkills: '["Unity","ARKit","ARCore","C#"]' },
    { title: 'Natural Language Processing Engineer', company: 'Kata.ai', location: 'Jakarta', salaryMin: 13000000, salaryMax: 22000000, remote: true, industry: 'AI', requiredSkills: '["Python","NLP","BERT","Transformers"]' },
    { title: 'Computer Vision Engineer', company: 'Nodeflux', location: 'Jakarta', salaryMin: 13000000, salaryMax: 22000000, remote: false, industry: 'AI', requiredSkills: '["Python","OpenCV","TensorFlow","YOLO"]' },
    { title: 'Full Stack Engineer', company: 'Xendit', location: 'Jakarta', salaryMin: 12000000, salaryMax: 20000000, remote: true, industry: 'Fintech', requiredSkills: '["Node.js","React","MongoDB","AWS"]' },
    { title: 'API Developer', company: 'Midtrans', location: 'Jakarta', salaryMin: 10000000, salaryMax: 17000000, remote: true, industry: 'Fintech', requiredSkills: '["REST API","Node.js","Express","PostgreSQL"]' },
    { title: 'Database Administrator', company: 'BCA', location: 'Jakarta', salaryMin: 10000000, salaryMax: 18000000, remote: false, industry: 'Banking', requiredSkills: '["Oracle","MySQL","PostgreSQL","Performance Tuning"]' },
    { title: 'Network Engineer', company: 'Telkom', location: 'Jakarta', salaryMin: 9000000, salaryMax: 15000000, remote: false, industry: 'Telco', requiredSkills: '["Cisco","BGP","MPLS","Network Security"]' },
    { title: 'Systems Analyst', company: 'Mandiri', location: 'Jakarta', salaryMin: 9000000, salaryMax: 16000000, remote: false, industry: 'Banking', requiredSkills: '["Business Analysis","UML","BPMN","SQL"]' },
    { title: 'IT Project Manager', company: 'Accenture', location: 'Jakarta', salaryMin: 15000000, salaryMax: 25000000, remote: true, industry: 'Consulting', requiredSkills: '["PMP","Agile","JIRA","Risk Management"]' },
    { title: 'Embedded Systems Engineer', company: 'Astra', location: 'Jakarta', salaryMin: 10000000, salaryMax: 18000000, remote: false, industry: 'Automotive', requiredSkills: '["C","C++","RTOS","CAN Bus"]' },
    { title: 'Firmware Engineer', company: 'Alodokter', location: 'Jakarta', salaryMin: 9000000, salaryMax: 16000000, remote: false, industry: 'Healthtech', requiredSkills: '["C","ARM","IoT","BLE"]' },
    { title: 'Cloud Security Engineer', company: 'Telkom', location: 'Jakarta', salaryMin: 13000000, salaryMax: 22000000, remote: true, industry: 'Telco', requiredSkills: '["AWS Security","CSPM","IAM","Zero Trust"]' },
    { title: 'Staff Engineer', company: 'Gojek', location: 'Jakarta', salaryMin: 22000000, salaryMax: 40000000, remote: true, industry: 'Technology', requiredSkills: '["System Design","Technical Leadership","Go","Java"]' },
    { title: 'Growth Engineer', company: 'Tokopedia', location: 'Jakarta', salaryMin: 11000000, salaryMax: 19000000, remote: true, industry: 'Technology', requiredSkills: '["Python","A/B Testing","Analytics","SQL"]' },
    { title: 'Search Engineer', company: 'Shopee', location: 'Jakarta', salaryMin: 13000000, salaryMax: 22000000, remote: false, industry: 'E-Commerce', requiredSkills: '["Elasticsearch","Solr","Java","Ranking Algorithms"]' },
    { title: 'Recommendation System Engineer', company: 'Grab', location: 'Jakarta', salaryMin: 14000000, salaryMax: 24000000, remote: true, industry: 'Technology', requiredSkills: '["Python","Collaborative Filtering","Spark","Airflow"]' },
    { title: 'Infrastructure Engineer', company: 'Koinworks', location: 'Jakarta', salaryMin: 11000000, salaryMax: 19000000, remote: true, industry: 'Fintech', requiredSkills: '["Terraform","Ansible","GCP","Linux"]' },
    { title: 'Developer Advocate', company: 'Xendit', location: 'Jakarta', salaryMin: 12000000, salaryMax: 20000000, remote: true, industry: 'Fintech', requiredSkills: '["REST API","Technical Writing","Public Speaking","Node.js"]' },
    { title: 'Automation Engineer', company: 'Astra', location: 'Jakarta', salaryMin: 9000000, salaryMax: 16000000, remote: false, industry: 'Automotive', requiredSkills: '["Python","Selenium","CI/CD","Jenkins"]' },
    { title: 'UX Researcher', company: 'Dana', location: 'Jakarta', salaryMin: 7000000, salaryMax: 13000000, remote: true, industry: 'Fintech', requiredSkills: '["User Research","Usability Testing","Figma","Data Analysis"]' },
    { title: 'Product Designer', company: 'Tiket.com', location: 'Jakarta', salaryMin: 8000000, salaryMax: 14000000, remote: true, industry: 'Travel', requiredSkills: '["Figma","Prototyping","Design Thinking","User Testing"]' },
    { title: 'Technical Writer', company: 'Midtrans', location: 'Jakarta', salaryMin: 6000000, salaryMax: 11000000, remote: true, industry: 'Fintech', requiredSkills: '["API Documentation","Markdown","REST API","Swagger"]' },
    { title: 'Engineering Manager', company: 'Bukalapak', location: 'Bandung', salaryMin: 22000000, salaryMax: 38000000, remote: true, industry: 'Technology', requiredSkills: '["People Management","System Design","Agile","Technical Leadership"]' },
    { title: 'Junior Frontend Developer', company: 'Startup Lokal', location: 'Yogyakarta', salaryMin: 4000000, salaryMax: 7000000, remote: true, industry: 'Technology', requiredSkills: '["HTML","CSS","JavaScript","React"]' },
    { title: 'Junior Backend Developer', company: 'Startup Lokal', location: 'Yogyakarta', salaryMin: 4000000, salaryMax: 7000000, remote: true, industry: 'Technology', requiredSkills: '["Node.js","Express","MySQL","REST API"]' },
    { title: 'Internship Software Engineer', company: 'Gojek', location: 'Jakarta', salaryMin: 2500000, salaryMax: 4000000, remote: true, industry: 'Technology', requiredSkills: '["Any Programming Language","Git","Problem Solving"]' },
    { title: 'Internship Data Analyst', company: 'Shopee', location: 'Jakarta', salaryMin: 2500000, salaryMax: 4000000, remote: false, industry: 'E-Commerce', requiredSkills: '["SQL","Excel","Python","Statistics"]' },
    { title: 'Fullstack Engineer (Remote)', company: 'Remote Indonesia', location: 'Remote', salaryMin: 15000000, salaryMax: 30000000, remote: true, industry: 'Technology', requiredSkills: '["React","Node.js","TypeScript","PostgreSQL"]' },
    { title: 'Senior Software Engineer', company: 'GoTo Group', location: 'Jakarta', salaryMin: 20000000, salaryMax: 35000000, remote: true, industry: 'Technology', requiredSkills: '["Go","Kubernetes","Microservices","PostgreSQL"]' },
    { title: 'Principal Engineer', company: 'Sea Group', location: 'Jakarta', salaryMin: 30000000, salaryMax: 50000000, remote: false, industry: 'Technology', requiredSkills: '["System Design","Technical Strategy","Java","Leadership"]' },
    { title: 'Data Platform Engineer', company: 'GoTo Group', location: 'Jakarta', salaryMin: 16000000, salaryMax: 26000000, remote: true, industry: 'Technology', requiredSkills: '["Spark","Flink","Kafka","Data Warehouse"]' },
  ];

  let created = 0;
  let skipped = 0;
  for (const jobData of jobs) {
    const id = jobData.id || `${jobData.company}_${jobData.title}`.replace(/\s+/g, '_');
    await prisma.job.upsert({
      where: { id },
      update: {},
      create: {
        id,
        ...jobData,
        description: `Description for ${jobData.title} at ${jobData.company}. We are looking for a talented ${jobData.title} to join our team.`,
      },
    });
    created++;
  }

  console.log(`Seeded ${created} jobs (upserted, existing unchanged).`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
