"""Mini FM — Flask API + React 빌드 결과 서빙."""
import json
import os
import platform
import socket
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory
from importlib.metadata import version as pkg_version

import engine

BASE_DIR = Path(__file__).resolve().parent
# 컨테이너에서는 Dockerfile이 STATIC_DIR=/app/static 으로 지정, 로컬에서는 frontend/dist
STATIC_DIR = Path(os.environ.get("STATIC_DIR", BASE_DIR.parent / "frontend" / "dist"))
STARTED_AT = datetime.now(timezone.utc)  # 프로세스(컨테이너) 가동 시작 시각

with open(BASE_DIR / "data" / "teams.json", encoding="utf-8") as f:
    DATA = json.load(f)
TEAMS = {t["id"]: t for t in DATA["teams"]}
SCHEDULE = engine.round_robin(list(TEAMS))

app = Flask(__name__, static_folder=None)
app.json.ensure_ascii = False


def get_team(team_id):
    team = TEAMS.get(team_id)
    if team is None:
        abort(400, description=f"알 수 없는 팀: {team_id}")
    return team


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/teams")
def teams():
    return {"league": DATA["league"], "teams": DATA["teams"], "formations": list(engine.FORMATIONS)}


@app.get("/api/teams/<team_id>/auto-lineup")
def auto_lineup(team_id):
    formation = request.args.get("formation", "4-4-2")
    if formation not in engine.FORMATIONS:
        abort(400, description="지원하지 않는 포메이션")
    return {"lineup": engine.auto_lineup(get_team(team_id), formation)}


@app.get("/api/league/schedule")
def schedule():
    return {"rounds": [[{"home": h, "away": a} for h, a in rnd] for rnd in SCHEDULE]}


@app.post("/api/match/simulate")
def simulate_match():
    """내 경기 시뮬레이션. half=1(전반) → half=2(후반, 전반 state 전달)."""
    body = request.get_json(force=True) or {}
    half = int(body.get("half", 1))
    if half not in (1, 2):
        abort(400, description="half는 1 또는 2")
    if half == 2 and not body.get("state"):
        abort(400, description="후반에는 전반 state가 필요합니다")
    home, away = body.get("home", {}), body.get("away", {})
    result = engine.simulate(get_team(home.get("team_id")), get_team(away.get("team_id")),
                             home, away, half=half, state=body.get("state"))
    return jsonify(result)


@app.post("/api/league/round")
def play_round():
    """한 라운드에서 내 경기를 제외한 나머지 경기를 빠르게 시뮬레이션한다."""
    body = request.get_json(force=True) or {}
    rnd = int(body.get("round", 0))
    if not 0 <= rnd < len(SCHEDULE):
        abort(400, description="잘못된 라운드")
    skip = body.get("skip_team")
    results = []
    for home_id, away_id in SCHEDULE[rnd]:
        if skip in (home_id, away_id):
            continue
        r = engine.simulate(TEAMS[home_id], TEAMS[away_id], with_events=False)
        results.append({
            "home": home_id, "away": away_id, "score": r["stats"]["score"],
            "scorers": [{"player_id": s["player_id"], "name": s["name"],
                         "team": home_id if s["team"] == 0 else away_id} for s in r["state"]["scorers"]],
        })
    return {"round": rnd, "results": results}


def _ecs_metadata():
    """ECS Fargate 작업 메타데이터 엔드포인트 v4 조회. 로컬이면 None."""
    uri = os.environ.get("ECS_CONTAINER_METADATA_URI_V4")
    if not uri:
        return None

    def fetch(url):
        with urllib.request.urlopen(url, timeout=2) as resp:
            return json.loads(resp.read().decode())

    try:
        task = fetch(f"{uri}/task")
        container = fetch(uri)
    except Exception as exc:  # 메타데이터 조회 실패해도 앱은 계속 동작
        return {"error": str(exc)}
    networks = container.get("Networks") or [{}]
    return {
        "task_arn": task.get("TaskARN"),
        "task_id": (task.get("TaskARN") or "").split("/")[-1],
        "cluster": (task.get("Cluster") or "").split("/")[-1],
        "family": task.get("Family"),
        "revision": task.get("Revision"),
        "launch_type": task.get("LaunchType"),
        "availability_zone": task.get("AvailabilityZone"),
        "desired_status": task.get("DesiredStatus"),
        "known_status": task.get("KnownStatus"),
        "limits": task.get("Limits"),
        "private_ip": (networks[0].get("IPv4Addresses") or [None])[0],
        "containers": [{
            "name": c.get("Name"),
            "image": c.get("Image"),
            "image_digest": c.get("ImageID"),
            "status": c.get("KnownStatus"),
            "started_at": c.get("StartedAt"),
        } for c in task.get("Containers", [])],
    }


@app.get("/api/meta")
def meta():
    """런타임 정보: 빌드 버전, 실행 플랫폼, 가동 시간, (ECS라면) 작업 메타데이터."""
    ecs = _ecs_metadata()
    now = datetime.now(timezone.utc)
    return {
        "app_version": os.environ.get("APP_VERSION", "dev"),
        "environment": "ecs" if ecs else "local",
        "hostname": socket.gethostname(),
        "region": os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"),
        "started_at": STARTED_AT.isoformat(timespec="seconds"),
        "uptime_seconds": int((now - STARTED_AT).total_seconds()),
        "server_time": now.isoformat(timespec="seconds"),
        "runtime": {
            "python": platform.python_version(),
            "flask": pkg_version("flask"),
            "server": request.environ.get("SERVER_SOFTWARE", "unknown"),  # 예: gunicorn/23.0.0, Werkzeug/3.x
            "os": f"{platform.system()} {platform.machine()}",
        },
        "ecs": ecs,
    }


@app.errorhandler(400)
def bad_request(err):
    return {"error": err.description}, 400


@app.get("/", defaults={"path": ""})
@app.get("/<path:path>")
def spa(path):
    """React SPA: 실제 파일이면 그대로, 아니면 index.html (클라이언트 라우팅)."""
    if path.startswith("api/"):
        abort(404)
    if path and (STATIC_DIR / path).is_file():
        return send_from_directory(STATIC_DIR, path)
    if not (STATIC_DIR / "index.html").is_file():
        return "프론트엔드 빌드 결과가 없습니다. frontend에서 npm run build 를 실행하세요.", 503
    return send_from_directory(STATIC_DIR, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
