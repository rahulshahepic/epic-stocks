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
COPY backend/app/financial_terms.json /app/backend/app/financial_terms.json
ARG COMMIT_SHA=dev
ENV VITE_COMMIT_SHA=$COMMIT_SHA
ARG APP_ENV=production
ENV VITE_APP_ENV=$APP_ENV
RUN npm run build
# Compile the *same* pure TS retirement engine the browser uses for the MCP worker.
RUN ./node_modules/.bin/tsc --target ES2022 --module ES2022 --moduleResolution bundler --skipLibCheck --outDir /app/retirement-runtime src/app/pages/Retirement.math.ts \
    && mv /app/retirement-runtime/Retirement.math.js /app/retirement-runtime/retirement.math.mjs

# Stage 2: Python runtime
FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl libstdc++6 && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./
COPY plugins/epic-stocks/ ./plugins/epic-stocks/

# Copy built frontend into backend static dir
COPY --from=frontend-build /app/frontend/dist ./static
COPY --from=frontend-build /app/retirement-runtime/retirement.math.mjs ./app/retirement.math.mjs
# Only the Node executable is needed: the simulation is a dependency-free ESM file.
COPY --from=frontend-build /usr/local/bin/node /usr/local/bin/node
# Verify the bundled Node executable and compiled browser engine work together.
RUN printf '{"params":{"epicExit":1,"defaultSpend":50,"minSpend":30,"paths":100,"currentAge":50,"endAge":52,"seed":1}}' | node app/retirement_runner.mjs | python -c 'import json,sys; r=json.load(sys.stdin); assert r["paths"] == 100 and r["startingTotalM"] > 0 and 0 <= r["pctFundingShortfall"] <= 1 and r["pctFundingShortfall"] >= r["pctExhausted"] and isinstance(r["wealthByAge"], list) and len(r["wealthByAge"]) > 0 and isinstance(r["finalPercentiles"], (dict,list)) and 0 <= r["pctLiquidityShortfall"] <= 1'


RUN useradd -m -u 1000 appuser && chown -R appuser /app
ARG COMMIT_SHA=dev
LABEL org.opencontainers.image.revision=$COMMIT_SHA
USER appuser

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
