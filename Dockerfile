# Stage 1: Build frontend
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
# npm 11 removed the fallback to the retired audit endpoint (npm/cli#7911);
# node:20-slim ships npm 10.x. --no-audit: see .github/workflows/test.yml's
# frontend job for why — CI already audits production dependencies against
# the working endpoint, so npm ci's own report is redundant either way.
RUN npm install -g npm@11.19.1 && npm ci --no-audit
COPY frontend/ ./
ARG COMMIT_SHA=dev
ENV VITE_COMMIT_SHA=$COMMIT_SHA
ARG APP_ENV=production
ENV VITE_APP_ENV=$APP_ENV
RUN npm run build

# Stage 2: Python runtime
FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./

# Copy built frontend into backend static dir
COPY --from=frontend-build /app/frontend/dist ./static

RUN useradd -m -u 1000 appuser && chown -R appuser /app
USER appuser

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
