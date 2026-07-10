require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.findUnique({ where: { email: 'test-phase-i@instajob.test' }, select: { id: true, email: true, password: true } })
  .then(u => {
    if (!u) { console.log('USER_NOT_FOUND'); process.exit(0); }
    console.log('USER_FOUND: id=' + u.id + ' email=' + u.email + ' hasPassword=' + !!u.password);
    process.exit(0);
  })
  .catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
