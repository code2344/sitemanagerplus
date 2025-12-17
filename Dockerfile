FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install dependencies from package.json
COPY package*.json ./
RUN npm ci --only=production

# Copy application code
COPY src/ ./src/
COPY website/ ./website/
COPY .env.example ./.env

# Create required directories
RUN mkdir -p data logs maintenance

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/admin/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start application
CMD ["node", "src/index.js"]
