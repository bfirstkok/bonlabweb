FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/app/data PORT=8000
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server.js ./
COPY admin ./admin
COPY public ./public
COPY src/data ./src/data
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8000
CMD ["node", "server.js"]
