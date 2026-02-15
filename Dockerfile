FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Build the static assets; wrangler serves from dist.
RUN npm run build

EXPOSE 8788

CMD ["npm","run","pages:dev"]

