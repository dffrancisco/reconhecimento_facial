# syntax=docker/dockerfile:1

FROM python:3.11-slim AS modelos
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Do buffalo_l só entram a detecção (SCRFD 10G) e o reconhecimento (ArcFace R50).
RUN curl -fsSL -o /tmp/buffalo_l.zip https://github.com/deepinsight/insightface/releases/download/model-zoo/buffalo_l.zip \
    && mkdir -p /modelos \
    && unzip -j /tmp/buffalo_l.zip '*det_10g.onnx' '*w600k_r50.onnx' -d /modelos \
    && rm /tmp/buffalo_l.zip

FROM python:3.11-slim AS base
ARG ORT=onnxruntime==1.30.0
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    VISION_MODELOS_DIR=/modelos
RUN apt-get update \
    && apt-get install -y --no-install-recommends libturbojpeg0 libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
# O insightface puxa o onnxruntime de CPU; a variante escolhida o substitui (os dois não podem coexistir).
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall -y onnxruntime \
    && pip install --no-cache-dir "$ORT"
COPY --from=modelos /modelos /modelos
COPY app app

FROM base AS teste
COPY requirements-dev.txt .
RUN pip install --no-cache-dir -r requirements-dev.txt
COPY pyproject.toml .
COPY tests tests
CMD ["python", "-m", "pytest", "-q", "-rs"]

FROM base AS final
RUN useradd --create-home --uid 1000 vision
USER vision
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status == 200 else 1)"
CMD ["python", "-m", "app.main"]
