FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir Pillow==11.3.0 pypdf==5.9.0 matplotlib==3.10.5
COPY runner.py /opt/runner.py
ENV MPLCONFIGDIR=/tmp/matplotlib HOME=/tmp
USER 65534:65534
WORKDIR /tmp
ENTRYPOINT ["python","-I","/opt/runner.py"]
