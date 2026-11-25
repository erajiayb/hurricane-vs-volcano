# Hurricane vs Volcano — interactive LIVE game
# Hugging Face Spaces runs the container and expects the app on port 7860.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY static/ ./static/

# HF Spaces sets $PORT itself; default to 7860.
ENV PORT=7860
EXPOSE 7860

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-7860}"]
