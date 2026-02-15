FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 8788

# Vite bakes `VITE_*` vars at build time, so we build on container start to pick up
# values from `docker compose`'s `env_file`.
CMD ["sh","-lc","npm run build && npm run pages:dev"]
