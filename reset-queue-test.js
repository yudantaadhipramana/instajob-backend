const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const user = await prisma.user.findUnique({ where: { email: 'test-phase-i@instajob.test' } });
  if (!user) { console.log('User not found'); return; }
  const deleted = await prisma.autoApplyQueue.deleteMany({ where: { userId: user.id } });
  console.log('Deleted', deleted.count, 'queue items');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
