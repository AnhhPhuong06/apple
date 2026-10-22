FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN node scripts/setup-signer.mjs && mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV HOST=0.0.0.0 PORT=4173 DATA_DIR=/app/data
EXPOSE 4173
CMD ["npm", "start"]
