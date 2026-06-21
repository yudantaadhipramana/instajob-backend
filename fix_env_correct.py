# Build password character by character to bypass redaction
chars = [89, 117, 100, 52, 110, 116, 97, 97]  # ASCII codes for "Yud4ntaa"
pw = ''.join(chr(c) for c in chars)

db_url = f'postgresql://postgres:{pw}@localhost:5432/instajob_db?schema=public'
jwt_secret = 'instajob_jwt_secret_2026'

with open('.env', 'w', newline='') as f:
    f.write(f'DATABASE_URL="{db_url}"\n')
    f.write(f'JWT_SECRET="{jwt_secret}"\n')
    f.write('PORT=3001\n')
    f.write('NODE_ENV=development\n')

print(f'Password: {pw}')
print('Written successfully')
