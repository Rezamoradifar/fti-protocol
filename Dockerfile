FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run compile
ENV HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["npm","run","demo"]
