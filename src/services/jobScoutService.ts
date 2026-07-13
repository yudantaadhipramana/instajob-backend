import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category: string;
  job_type: string;
  publication_date: string;
  candidate_required_location: string;
  salary: string;
  description: string;
  tags: string[];
}

// Map Remotive job_type to remote boolean
const isRemote = (jobType: string, location: string): boolean => {
  const t = (jobType + location).toLowerCase();
  return t.includes('remote') || t.includes('anywhere') || t.includes('worldwide');
};

// Parse salary string to min/max int (rough)
const parseSalary = (salary: string): { min: number; max: number } => {
  if (!salary) return { min: 0, max: 0 };
  const nums = salary.replace(/[^0-9]/g, ' ').trim().split(/\s+/).filter(Boolean).map(Number);
  if (nums.length >= 2) return { min: nums[0], max: nums[nums.length - 1] };
  if (nums.length === 1) return { min: nums[0], max: nums[0] };
  return { min: 0, max: 0 };
};

export async function scoutJobsFromRemotive(searchTerm = 'software engineer', limit = 20): Promise<number> {
  const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(searchTerm)}&limit=${limit}`;
  
  const { data } = await axios.get<{ jobs: RemotiveJob[] }>(url, { timeout: 15000 });
  const jobs = data.jobs || [];

  let inserted = 0;
  for (const j of jobs) {
    // Dedup by title+company
    const existing = await prisma.job.findFirst({
      where: { title: j.title, company: j.company_name },
    });
    if (existing) continue;

    const sal = parseSalary(j.salary);
    await prisma.job.create({
      data: {
        title: j.title,
        company: j.company_name,
        location: j.candidate_required_location || 'Remote',
        description: j.description?.slice(0, 2000) || '',
        remote: isRemote(j.job_type, j.candidate_required_location),
        salaryMin: sal.min || null,
        salaryMax: sal.max || null,
        industry: j.category || null,
        tags: JSON.stringify(j.tags || []),
        postedAt: j.publication_date ? new Date(j.publication_date) : new Date(),
        postedDate: j.publication_date ? new Date(j.publication_date) : new Date(),
      },
    });
    inserted++;
  }

  await prisma.$disconnect();
  return inserted;
}
