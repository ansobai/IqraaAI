FROM debian:bookworm-slim AS whisper-builder

ARG WHISPER_CPP_REF=v1.7.6

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src/whisper.cpp

RUN git clone --depth 1 --branch "${WHISPER_CPP_REF}" https://github.com/ggerganov/whisper.cpp.git . \
  && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
  && cmake --build build --config Release -j"$(nproc)"

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8010 \
    STT_WCPP_BIN=whisper-cli

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    libgomp1 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=whisper-builder /src/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli

COPY api/stt_service_whisper_cpp/requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip \
  && python -m pip install --no-cache-dir -r requirements.txt

COPY api/stt_service_whisper_cpp ./api/stt_service_whisper_cpp

EXPOSE 8010

CMD ["sh", "-c", "uvicorn api.stt_service_whisper_cpp.app:app --host 0.0.0.0 --port ${PORT}"]
