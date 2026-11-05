# 24/7 Cloud Backend Container (Hugging Face Spaces Docker SDK / Render / Railway)
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=7860

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
      torch torchvision && \
    pip install --no-cache-dir -r requirements.txt

COPY backend/ /app/backend/

RUN mkdir -p /app/backend/var/uploads /app/backend/var/indices && \
    chmod -R 777 /app/backend/var

EXPOSE 7860

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
