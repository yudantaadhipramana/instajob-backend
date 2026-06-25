FROM node:20-slim

RUN apt-get update && apt-get install -y openssl postgresql-client && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./

RUN npm install --ignore-scripts

COPY prisma/ ./prisma/
COPY src/ ./src/

RUN npx prisma generate && npx tsc

EXPOSE 3001

CMD ["node", "dist/index.js"]
