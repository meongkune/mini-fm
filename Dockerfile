# syntax=docker/dockerfile:1
# =====================================================================
# Mini FM — 멀티 스테이지 빌드
#   1단계(frontend-build): Node.js로 React(Vite) 앱을 정적 파일로 빌드
#   2단계(runtime)       : Python + gunicorn으로 Flask API 실행, 1단계 결과물만 복사해 서빙
#   → 최종 이미지에는 Node.js·node_modules·소스(JSX)가 들어가지 않아 가볍고 안전하다.
# =====================================================================

# ---------- 1단계: React 빌드 ----------
# FROM: 베이스 이미지 지정. Node 22 LTS의 경량 Alpine 버전을 쓰고, 이 단계에 frontend-build라는 이름을 붙인다.
FROM node:22-alpine AS frontend-build

# WORKDIR: 이후 명령이 실행될 작업 디렉터리. 없으면 자동으로 만든다.
WORKDIR /build

# COPY: 의존성 목록만 먼저 복사한다. 소스가 바뀌어도 package*.json이 그대로면 아래 npm ci 레이어를 캐시에서 재사용한다.
COPY frontend/package.json frontend/package-lock.json ./

# RUN: 이미지 빌드 중에 명령 실행. lock 파일에 적힌 버전 그대로 의존성을 깨끗하게 설치한다(npm ci).
RUN npm ci --no-audit --no-fund

# COPY: 나머지 프론트엔드 소스 코드를 복사한다(.dockerignore로 node_modules·dist는 제외).
COPY frontend/ ./

# RUN: Vite 프로덕션 빌드 → /build/dist 에 HTML·JS·CSS 정적 파일이 생성된다.
RUN npm run build


# ---------- 2단계: 실행 이미지 ----------
# FROM: 새 단계 시작. 1단계의 Node 환경은 버리고 Python 3.12 slim 이미지에서 다시 시작한다.
FROM python:3.12-slim AS runtime

# ENV: 환경 변수. .pyc 파일을 만들지 않고, 로그를 버퍼 없이 바로 출력(CloudWatch에 즉시 보이도록)하며, 정적 파일 위치를 알려준다.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STATIC_DIR=/app/static

# WORKDIR: 애플리케이션 디렉터리를 /app 으로 지정한다.
WORKDIR /app

# COPY: 파이썬 의존성 목록만 먼저 복사한다(레이어 캐시 활용).
COPY backend/requirements.txt ./

# RUN: Flask와 gunicorn 설치. --no-cache-dir로 pip 캐시를 남기지 않아 이미지 크기를 줄인다.
RUN pip install --no-cache-dir -r requirements.txt

# COPY: Flask 백엔드 코드(app.py, engine.py, data/teams.json)를 복사한다.
COPY backend/ ./

# COPY --from: 1단계(frontend-build)에서 만든 빌드 결과물(dist)만 골라서 /app/static 으로 가져온다.
COPY --from=frontend-build /build/dist ./static

# EXPOSE: 컨테이너가 80번 포트를 사용한다는 것을 문서화한다(실제 공개는 docker run -p / ECS 포트 매핑이 담당).
EXPOSE 80

# CMD: 컨테이너가 시작될 때 실행할 기본 명령. gunicorn(WSGI 서버)이 0.0.0.0:80에서 Flask 앱(app.py의 app)을 워커 2개로 실행하고, 접근 로그를 표준 출력으로 내보낸다.
CMD ["gunicorn", "--bind", "0.0.0.0:80", "--workers", "2", "--access-logfile", "-", "app:app"]
