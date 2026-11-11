FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY client/package*.json client/
RUN npm --prefix client ci
COPY . .
RUN npm --prefix client run build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 DATA_DIR=/app/data
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/client/dist client/dist
COPY package.json ./
COPY server server
COPY shared shared
EXPOSE 3001
CMD ["node", "server/index.js"]
