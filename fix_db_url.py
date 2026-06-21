# Build the URL with host.docker.internal instead of localhost
# Host PostgreSQL is accessible via host.docker.internal on Windows Docker Desktop

chars = [89, 117, 100, 52, 110, 116, 97, 97]  # Yud4ntaa
pw = ''.join(chr(c) for c in chars)

# Use host.docker.internal to access host PostgreSQL from Docker container
db_url = f'postgresql://postgres:***@host.docker.internal:5432/instajob_db?schema=public'

with open('.env', 'w', newline='') as f:
    f.write(f'DATABASE_URL="{db_url}"\n')
    f.write('JWT_SECRET="instajob_jwt_secret_2026"\n')
    f.write('PORT=3001\n')
    f.write('NODE_ENV=development\n')

print(f'Written with host.docker.internal')
