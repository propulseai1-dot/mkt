FROM node:18-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Default: production build (writes to /app/build)
CMD ["npm", "run", "build"]
