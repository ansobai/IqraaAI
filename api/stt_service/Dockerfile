FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8010

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY api/stt_service/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip \
  && python -m pip install --no-cache-dir -r requirements.txt

COPY api/stt_service ./api/stt_service

EXPOSE 8010

CMD ["sh", "-c", "uvicorn api.stt_service.app:app --host 0.0.0.0 --port ${PORT}"]
