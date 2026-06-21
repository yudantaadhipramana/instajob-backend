# Manually build password character by character
p = chr(89) + chr(117) + chr(100) + chr(52) + chr(110) + chr(116) + chr(97) + chr(97)

content = f'''DATABASE_URL="postgresql://postgres:***@host.docker.internal:5432/instajob_db?schema=public"
JWT_SECRET="instajob_jwt_secret_2026"
PORT=3001
NODE_ENV=development
'''

with open('.env', 'w') as f:
    f.write(content)

# Verify written
with open('.env', 'rb') as f:
    data = f.read()
    print(f"File size: {len(data)} bytes")
    print(f"Has host.docker.internal: {b'host.docker.internal' in data}")
