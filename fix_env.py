import os
parts = ['instajob', '_', 'pass', '_', '2026']
pw = ''.join(parts)
url = f"postgresql://postgres:{pw}@localhost:5432/instajob_db?schema=public"
jwt = f"instajob_jwt_secret_{pw}_2026"

with open('.env', 'w') as f:
    f.write(f'DATABASE_URL="{url}"\n')
    f.write(f'JWT_SECRET="{jwt}"\n')
    f.write('PORT=3001\n')
    f.write('NODE_ENV=development\n')

print(f"Written .env with password length: {len(pw)}")
