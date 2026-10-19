"""미니 FM 경기 시뮬레이션 엔진.

서버는 상태를 저장하지 않는다(stateless). 전반이 끝나면 경기 상태(state)를 클라이언트에
돌려주고, 후반을 요청할 때 클라이언트가 그 state를 다시 보내는 방식이다.
그래서 ECS에서 컨테이너가 바뀌거나 여러 개로 늘어나도 경기가 끊기지 않는다.
"""
import random

FORMATIONS = {
    # 포메이션: (DF, MF, FW) 인원, 공격/중원/수비 보정
    "4-4-2": {"slots": (4, 4, 2), "att": 0, "mid": 0, "def": 0},
    "4-3-3": {"slots": (4, 3, 3), "att": 4, "mid": -2, "def": -2},
    "3-5-2": {"slots": (3, 5, 2), "att": 0, "mid": 4, "def": -3},
    "5-3-2": {"slots": (5, 3, 2), "att": -4, "mid": -1, "def": 5},
}
MENTALITY = {
    "attacking": {"att": 6, "def": -6},
    "balanced": {"att": 0, "def": 0},
    "defensive": {"att": -6, "def": 6},
}
PRESSING = {
    # 압박: 점유율 보정, 체력 소모 배수
    "low": {"mid": -3, "drain": 0.6},
    "normal": {"mid": 0, "drain": 1.0},
    "high": {"mid": 4, "drain": 1.6},
}
DEFAULT_TACTICS = {"formation": "4-4-2", "mentality": "balanced", "pressing": "normal"}


def _avg(values, default=50.0):
    values = list(values)
    return sum(values) / len(values) if values else default


def auto_lineup(team, formation="4-4-2"):
    """포메이션에 맞춰 포지션별 능력치가 높은 선수로 베스트 11을 고른다."""
    df, mf, fw = FORMATIONS[formation]["slots"]
    need = {"GK": 1, "DF": df, "MF": mf, "FW": fw}
    key = {"GK": lambda p: p["def"], "DF": lambda p: p["def"],
           "MF": lambda p: p["att"] + p["def"], "FW": lambda p: p["att"]}
    lineup = []
    for pos, n in need.items():
        pool = sorted((p for p in team["players"] if p["pos"] == pos), key=key[pos], reverse=True)
        lineup += [p["id"] for p in pool[:n]]
    return lineup


def _side(team, lineup_ids, tactics):
    """팀 + 선발 + 전술을 받아 경기에 쓸 종합 능력치를 계산한다."""
    tactics = {**DEFAULT_TACTICS, **(tactics or {})}
    if tactics["formation"] not in FORMATIONS:
        tactics["formation"] = "4-4-2"
    by_id = {p["id"]: p for p in team["players"]}
    ids = [i for i in (lineup_ids or []) if i in by_id][:11]
    if len(ids) < 11:
        ids = auto_lineup(team, tactics["formation"])
    xi = [by_id[i] for i in ids]
    group = {pos: [p for p in xi if p["pos"] == pos] for pos in ("GK", "DF", "MF", "FW")}

    f = FORMATIONS[tactics["formation"]]
    m = MENTALITY.get(tactics["mentality"], MENTALITY["balanced"])
    pr = PRESSING.get(tactics["pressing"], PRESSING["normal"])

    # 포메이션 인원과 실제 포지션이 다르면 감점 (포지션 이탈)
    df, mf, fw = f["slots"]
    mismatch = abs(len(group["DF"]) - df) + abs(len(group["MF"]) - mf) + abs(len(group["FW"]) - fw)
    penalty = mismatch * 2.5 + (15 if len(group["GK"]) != 1 else 0)

    attack = _avg([p["att"] for p in group["FW"]] * 2 + [p["att"] for p in group["MF"]]) + f["att"] + m["att"]
    midfield = _avg((p["att"] + p["def"]) / 2 for p in group["MF"]) + f["mid"] + pr["mid"]
    defense = _avg([p["def"] for p in group["DF"]] * 2 + [p["def"] for p in group["MF"]]) + f["def"] + m["def"]
    keeper = _avg((p["def"] for p in group["GK"]), 40)
    return {
        "team_id": team["id"],
        "name": team.get("short") or team["name"],  # 문자 중계용 짧은 이름 (예: 맨유)
        "xi": xi,
        "tactics": tactics,
        "attack": attack - penalty,
        "midfield": midfield - penalty,
        "defense": defense - penalty,
        "keeper": keeper,
        "stamina": _avg(p["sta"] for p in xi),
        "drain": pr["drain"],
    }


def _fatigue(side, minute):
    """60분 이후 체력이 떨어진다. 압박이 강할수록, 체력이 낮을수록 더 많이 떨어진다."""
    if minute <= 55:
        return 0.0
    return (minute - 55) / 35 * 8 * side["drain"] * (100 - side["stamina"]) / 40


def _pick_scorer(rng, side):
    weight = {"FW": 3.0, "MF": 1.4, "DF": 0.35, "GK": 0.0}
    players = side["xi"]
    weights = [weight[p["pos"]] * p["att"] for p in players]
    return rng.choices(players, weights=weights)[0]


GOAL_LINES = [
    "{m}' ⚽ 골! {p}({t})의 오른발 슛이 골망을 가릅니다!",
    "{m}' ⚽ 골! {p}({t}), 문전 혼전 상황에서 침착하게 밀어 넣습니다!",
    "{m}' ⚽ 골!! {p}({t})의 환상적인 중거리포!",
    "{m}' ⚽ 골! {p}({t})이(가) 헤더로 마무리합니다!",
]
SAVE_LINES = [
    "{m}' 🧤 {p}({t})의 슛 — 골키퍼 선방!",
    "{m}' 🧤 {p}({t}) 일대일 찬스! 하지만 골키퍼가 막아냅니다.",
]
MISS_LINES = [
    "{m}' {p}({t})의 슛이 골대를 살짝 벗어납니다.",
    "{m}' {p}({t}), 크로스바를 넘기는 슛.",
    "{m}' 🥅 {p}({t})의 슛이 골대를 맞고 나옵니다!",
]
CARD_LINE = "{m}' 🟨 {p}({t}) 경고. 거친 태클이었습니다."


def new_state(seed=None):
    return {
        "seed": seed if seed is not None else random.randrange(1, 10**9),
        "minute": 0,
        "score": [0, 0],
        "shots": [0, 0],
        "on_target": [0, 0],
        "possession_ticks": [0, 0],
        "scorers": [],
    }


def simulate(home_team, away_team, home_cfg=None, away_cfg=None, half=0, state=None, with_events=True):
    """경기를 시뮬레이션한다.

    half=1 → 1~45분, half=2 → 46~90분(state 필요), half=0 → 90분 전체(빠른 시뮬).
    """
    home_cfg, away_cfg = home_cfg or {}, away_cfg or {}
    state = dict(state) if state else new_state()
    sides = [
        _side(home_team, home_cfg.get("lineup"), home_cfg.get("tactics")),
        _side(away_team, away_cfg.get("lineup"), away_cfg.get("tactics")),
    ]
    start, end = {1: (1, 45), 2: (46, 90)}.get(half, (1, 90))
    # 같은 시드 + 같은 분이면 같은 결과 (재현 가능), 후반은 전술 변경이 반영되도록 별도 시드
    rng = random.Random(state["seed"] * 7 + start)
    events = []
    # 경기장 애니메이션용 분 단위 흐름: t=공격팀(0 홈/1 원정), k=상황(build·card·miss·save·goal), p=슈터 ID
    # 추가 난수를 뽑지 않으므로 경기 결과에는 영향이 없다
    timeline = []
    if with_events and start == 1:
        events.append({"minute": 0, "type": "info", "text": f"0' 킥오프! {sides[0]['name']} vs {sides[1]['name']}"})
    if with_events and start == 46:
        events.append({"minute": 45, "type": "info", "text": "46' 후반전 시작!"})

    for minute in range(start, end + 1):
        fat = [_fatigue(s, minute) for s in sides]
        mid = [sides[i]["midfield"] - fat[i] + (3 if i == 0 else 0) for i in range(2)]  # 홈 어드밴티지
        p_home = 0.5 + (mid[0] - mid[1]) / 80
        atk = 0 if rng.random() < p_home else 1
        dfn = 1 - atk
        state["possession_ticks"][atk] += 1
        tick = {"m": minute, "t": atk, "k": "build"}
        if with_events:
            timeline.append(tick)

        a = sides[atk]["attack"] - fat[atk]
        d = sides[dfn]["defense"] - fat[dfn]
        # 공격권을 가진 팀이 슈팅까지 갈 확률
        if rng.random() > 0.17 + (a - d) / 400:
            if with_events and rng.random() < 0.012:
                p = rng.choice(sides[dfn]["xi"])
                tick.update(k="card", p=p["id"])
                events.append({"minute": minute, "type": "card", "team": dfn,
                               "text": CARD_LINE.format(m=minute, p=p["name"], t=sides[dfn]["name"])})
            continue

        shooter = _pick_scorer(rng, sides[atk])
        tick.update(k="miss", p=shooter["id"])
        state["shots"][atk] += 1
        quality = 0.30 + (shooter["att"] - sides[dfn]["keeper"]) / 400 + (a - d) / 600
        on_target = rng.random() < 0.45 + (shooter["att"] - 60) / 200
        fmt = {"m": minute, "p": shooter["name"], "t": sides[atk]["name"]}
        if on_target:
            state["on_target"][atk] += 1
            tick["k"] = "save"
            if rng.random() < max(0.08, min(0.55, quality)):
                tick["k"] = "goal"
                state["score"][atk] += 1
                state["scorers"].append({"minute": minute, "team": atk, "player_id": shooter["id"],
                                         "name": shooter["name"]})
                if with_events:
                    events.append({"minute": minute, "type": "goal", "team": atk,
                                   "text": rng.choice(GOAL_LINES).format(**fmt),
                                   "score": list(state["score"])})
            elif with_events:
                events.append({"minute": minute, "type": "save", "team": atk,
                               "text": rng.choice(SAVE_LINES).format(**fmt)})
        elif with_events and rng.random() < 0.5:
            events.append({"minute": minute, "type": "miss", "team": atk,
                           "text": rng.choice(MISS_LINES).format(**fmt)})

    state["minute"] = end
    if with_events:
        h, w = state["score"]
        if end == 45:
            events.append({"minute": 45, "type": "info", "text": f"45' 전반 종료. {h} : {w}"})
        if end == 90:
            events.append({"minute": 90, "type": "info", "text": f"90' 경기 종료! 최종 스코어 {h} : {w}"})

    total = sum(state["possession_ticks"]) or 1
    possession = [round(state["possession_ticks"][0] * 100 / total)]
    possession.append(100 - possession[0])
    return {
        "half": half,
        "finished": end == 90,
        "home": {"id": sides[0]["team_id"], "name": sides[0]["name"], "tactics": sides[0]["tactics"]},
        "away": {"id": sides[1]["team_id"], "name": sides[1]["name"], "tactics": sides[1]["tactics"]},
        "events": events,
        "timeline": timeline,
        # 경기장에 그릴 양 팀 선발 11명 (포지션·등번호)
        "lineups": [[{k: p[k] for k in ("id", "name", "number", "pos")} for p in s["xi"]] for s in sides],
        "stats": {"score": state["score"], "shots": state["shots"], "on_target": state["on_target"],
                  "possession": possession},
        "state": state,
    }


def round_robin(team_ids):
    """서클 방식으로 더블 라운드 로빈 일정을 만든다 (8팀 → 14라운드)."""
    ids = list(team_ids)
    n = len(ids)
    rounds = []
    for r in range(n - 1):
        pairs = []
        for i in range(n // 2):
            a, b = ids[i], ids[n - 1 - i]
            pairs.append((a, b) if (r + i) % 2 == 0 else (b, a))
        rounds.append(pairs)
        ids = [ids[0]] + [ids[-1]] + ids[1:-1]
    second = [[(b, a) for a, b in rnd] for rnd in rounds]
    return rounds + second
