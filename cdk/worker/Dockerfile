FROM public.ecr.aws/docker/library/python:3.12-slim

# boto3 for SQS/S3; HTTP calls to the local model use the stdlib (urllib).
RUN pip install --no-cache-dir boto3==1.35.*

WORKDIR /app
COPY worker.py .

# Run as an unprivileged user.
USER nobody

ENTRYPOINT ["python", "-u", "worker.py"]
