#!/usr/bin/env python3
"""
GPU 아레나 서버 — 로비 · 방 · 중계  (파이썬 표준 라이브러리만 사용, 설치 불필요)

  python3 arena_server.py           (기본 포트 8000)
  python3 arena_server.py 9000      (포트 지정)

교사 PC에서 이 파일과 arena.html 을 같은 폴더에 두고 실행하세요.
  · 모든 화면 :  http://<내IP>:8000/

흐름
  닉네임 입력 → 로비(방 목록 · 접속자 · 채팅) → 방(진영/빌드 선택 · 준비) → 방장이 시작 → 경기 → 방으로 복귀
  로비의 [무한 아레나 참가] → 방 없이 바로 들어가는 상시 개인전 (이것만은 이 서버가 직접 계산: arena_infinite.py)

게임 규칙 계산은 각 방의 **방장 브라우저**에서만 합니다. 이 서버는 방을 관리하고
메시지를 중계할 뿐이라, 규칙을 고칠 때는 arena.html 만 바꾸면 됩니다.
"""
import base64, hashlib, json, os, re, shutil, socket, struct, sys, threading, time, glob, unicodedata
from arena_infinite import Arena
# 로그를 파일/파이프로 돌리면 출력이 cp949 가 되어 '↩' 같은 기호에서 print 가 예외 → 그 학생 연결이 끊긴다. 못 쓰는 글자는 ? 로.
if sys.stdout: sys.stdout.reconfigure(errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
SUB_DIR = os.path.join(HERE, "submissions")
BOT_DIR = os.path.join(HERE, "bots")
os.makedirs(SUB_DIR, exist_ok=True)
os.makedirs(BOT_DIR, exist_ok=True)
# 방마다 폴더: rooms/<001_방제목>/submissions · bots — 방이 사라지면 rooms/_지난방/ 으로 옮긴다
# 맨 위 bots/ 는 모든 방이 함께 쓰는 공용 봇 (기준봇·공격형 같은 샘플)
ROOMS_DIR = os.path.join(HERE, "rooms")
ARCHIVE_DIR = os.path.join(ROOMS_DIR, "_지난방")
os.makedirs(ROOMS_DIR, exist_ok=True)

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOM_MAX = 10          # 5대5 (host.js 의 "경기서버" 계정은 세지 않음)
HOST_BOT = "경기서버"

def team_count(r, team):
    return sum(1 for c in r["members"] if users.get(c, {}).get("name") != HOST_BOT
               and not r["slots"].get(c, {}).get("watch") and r["slots"].get(c, {}).get("team") == team)


def pick_team(r):
    return "cpu" if team_count(r, "cpu") <= team_count(r, "gpu") else "gpu"


def seat_count(r):
    return sum(1 for c in r["members"] if users.get(c, {}).get("name") != HOST_BOT
               and not r["slots"].get(c, {}).get("watch"))

lock = threading.RLock()
users = {}             # cid -> {"sock","name","room","gone"}
GHOST_SEC = 60         # 연결이 끊긴 뒤 자리를 지켜주는 시간
rooms = {}             # rid -> {"id","title","pw","host","members":[cid],"spect":[cid],"state","slots":{cid:{"b","ready"}},"map"}
next_cid = 1
next_rid = 1

# 방장 → 다른 멤버에게 그대로 전달되는 경기 메시지
HOST_RELAY = {"init", "s", "res"}
# 멤버 → 방장에게 전달되는 입력 메시지
MEMBER_RELAY = {"in", "th"}


# ----------------------------------------------------------------- 파일
def safe_name(name):
    name = unicodedata.normalize("NFC", str(name))[:24].strip()
    name = re.sub(r"[^\w가-힣 .-]", "", name).strip() or "이름없음"
    return name.replace(" ", "_")


def make_room_dir(rid, title):
    d = "%03d_%s" % (rid, safe_name(title))
    for sub in ("submissions", "bots"):
        os.makedirs(os.path.join(ROOMS_DIR, d, sub), exist_ok=True)
    return d


def archive_room_dir(d):
    """방이 사라짐 → 폴더를 rooms/_지난방/ 으로 옮긴다 (학생 작업물 보존). 아무 파일도 없으면 그냥 지운다."""
    src = os.path.join(ROOMS_DIR, d or "")
    if not d or not os.path.isdir(src):
        return
    if not any(files for _, _, files in os.walk(src)):
        shutil.rmtree(src, ignore_errors=True)
        return
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    dst = os.path.join(ARCHIVE_DIR, "%s_%s" % (d, time.strftime("%Y%m%d-%H%M%S")))
    shutil.move(src, dst)
    print("  · 방 폴더 보관:", os.path.relpath(dst, HERE))


def room_bot_dirs():
    try:
        return [os.path.join(ROOMS_DIR, d, "bots") for d in os.listdir(ROOMS_DIR)
                if d != os.path.basename(ARCHIVE_DIR) and os.path.isdir(os.path.join(ROOMS_DIR, d, "bots"))]
    except OSError:
        return []


def save_submission(name, text, build, rules=None, sub_dir=SUB_DIR):
    name = unicodedata.normalize("NFC", str(name))
    fn = os.path.join(sub_dir, safe_name(name) + ".txt")
    extra = "".join("# 직접규칙 %d: %s → %s%s\n" % (i + 1, r["when"], r["do"], " %s" % r["value"] if "value" in r else "")
                    for i, r in enumerate(rules or []))
    with open(fn, "w", encoding="utf-8") as f:
        f.write("# 학생: %s\n# 빌드: %s\n# 제출: %s\n%s\n%s\n"
                % (name, json.dumps(build, ensure_ascii=False), time.strftime("%H:%M:%S"), extra, text))
    return fn


# 규칙표 검증 — arena.html ENGINE 구간(parseCond · RULE_ACTS · SPEC)과 같은 규칙
RULE_VARS = {"체력", "탄약", "적거리", "부채꼴적", "보이는적", "아군", "재장전", "시간", "아군거리", "적체력", "목숨", "남은시간", "내처치",
             "hp", "ammo", "dist", "cone", "enemies", "allies", "reload", "time", "allyDist", "enemyHp", "lives", "left", "kills"}
RULE_ACTS = {"접근", "후퇴", "거리유지", "탄약수집", "던지기", "좌우회피", "대기", "중앙이동", "아군따라가기", "엄폐", "순찰"}
BUILD_COST = {"render": [0, 4, 9, 16, 26, 37], "lane": [3, 8, 16, 28, 44], "clock": [0, 3, 8, 15, 24, 35], "mem": [0, 2, 6, 11, 18, 26]}
BUILD_MIN = {"render": 1, "lane": 0, "clock": 1, "mem": 1}
CHAR_IDS = {"dao", "bazzi", "marid", "su", "kephi", "mos", "dizni", "uni", "ethi"}
SAMPLE_BOTS = {"기준봇", "공격형"}          # 학생 제출로 덮어쓰지 않는 샘플 봇
TERM_RE = re.compile(r"^([^\s<>=!]+)\s*(<=|>=|==|!=|<|>)\s*(-?\d+(?:\.\d+)?)$")


def cond_ok(s):
    s = str(s or "").strip()
    if re.fullmatch(r"(?i)always|항상|기본", s):
        return True
    is_or = bool(re.search(r"(?i)\s(or|또는)\s|\|\|", s))
    is_and = bool(re.search(r"(?i)\s(and|그리고)\s|&&|,", s))
    if is_or and is_and:
        return False
    parts = re.split(r"(?i)\s+(?:or|또는)\s+|\s*\|\|\s*" if is_or else r"(?i)\s+(?:and|그리고)\s+|\s*&&\s*|\s*,\s*", s)
    for p in filter(None, parts):
        m = TERM_RE.match(p.strip())
        if not m or m.group(1) not in RULE_VARS:
            return False
    return True


def clean_bot(name, build, rules):
    """학생이 [규칙 직접 만들기]로 보낸 규칙표를 검증·정리. (봇 dict, None) 또는 (None, 오류문)"""
    if not isinstance(build, dict):
        return None, "빌드 정보가 없습니다"
    b = {}
    for k, cost in BUILD_COST.items():
        v = build.get(k)
        if not isinstance(v, int) or isinstance(v, bool) or not BUILD_MIN[k] <= v < len(cost):
            return None, "빌드 %s 값이 잘못되었습니다" % k
        b[k] = v
    if sum(BUILD_COST[k][b[k]] for k in b) > 90:
        return None, "빌드 예산 90 을 넘었습니다"
    if build.get("ch") in CHAR_IDS:
        b["ch"] = build["ch"]
    if not isinstance(rules, list) or not 1 <= len(rules) <= 12:
        return None, "규칙은 1~12개여야 합니다"
    out = []
    for i, r in enumerate(rules, 1):
        if not isinstance(r, dict):
            return None, "%d번 규칙 형식이 잘못되었습니다" % i
        when, act = str(r.get("when", ""))[:80], r.get("do")
        if not cond_ok(when):
            return None, "%d번 규칙의 조건을 해석할 수 없습니다: %s" % (i, when)
        if act not in RULE_ACTS:
            return None, "%d번 규칙의 행동이 없는 행동입니다" % i
        rule = {"when": when, "do": act}
        if act == "거리유지":
            try:
                rule["value"] = max(40, min(600, int(float(r.get("value", 300)))))
            except (TypeError, ValueError):
                rule["value"] = 300
        out.append(rule)
    return {"name": name, "build": b, "rules": out,
            "note": "[규칙 직접 만들기]로 학생이 직접 만든 규칙표입니다 (에이전트 변환 없음)."}, None


def make_direct_bot(name, build, rules):
    """bots/<이름>.json 으로 저장할 규칙봇을 만든다. (봇 dict, None) 또는 (None, 오류문)"""
    stem = safe_name(name)
    if stem in SAMPLE_BOTS:
        return None, "샘플 봇 이름(%s)으로는 저장할 수 없습니다" % stem
    return clean_bot(stem, build, rules)


def bots_signature():
    sig = []
    for d in [BOT_DIR] + room_bot_dirs():
        try:
            sig += [(d, f, os.path.getmtime(os.path.join(d, f))) for f in os.listdir(d) if f.endswith(".json")]
        except OSError:
            pass
    return tuple(sorted(sig))


def watch_bots():
    """bots/ 가 바뀌면(학생 규칙표 제출 · 에이전트 변환 · 삭제) 방장들에게 새 목록을 보낸다.
    → 경기 시작 전까지는 몇 번을 다시 내도 마지막 제출이 방장 화면의 규칙봇에 반영된다."""
    last = bots_signature()
    while True:
        time.sleep(2)
        with lock:
            rs = list(rooms.items())
        for rid_, r in rs:   # 선생님 PC 의 에이전트가 쓰는 변환 상태 (rooms/<방>/status.json)
            try:
                with open(os.path.join(ROOMS_DIR, r.get("dir", ""), "status.json"), encoding="utf-8") as f:
                    st = json.load(f)
            except (OSError, ValueError):
                continue
            if st != r.get("convert"):
                r["convert"] = st
                broadcast_room(rid_)
        sig = bots_signature()
        if sig == last:
            continue
        last = sig
        with lock:   # 방마다 그 방 목록을: 방장 + 규칙봇을 켠 방의 참가자·관전자 (학생 화면에도 규칙봇 자리가 보이도록)
            plan = []
            for r in rooms.values():
                targets = {r["host"]}
                if r.get("botsOn"):
                    targets |= set(r["members"]) | set(r.get("spect", []))
                plan.append((dict(r), targets))
        for r, targets in plan:
            bots = load_bots(r)
            for c in targets:
                send_to(c, {"t": "bots", "list": bots})


def load_bots(room=None):
    """공용 bots/ + (방이 주어지면) 그 방 폴더의 bots/. 같은 이름이면 방 봇이 이긴다."""
    out, seen = [], {}
    dirs = [BOT_DIR] + ([os.path.join(ROOMS_DIR, room["dir"], "bots")] if room and room.get("dir") else [])
    for fn in [f for d in dirs for f in sorted(glob.glob(os.path.join(d, "*.json")))]:
        try:
            with open(fn, encoding="utf-8") as f:
                b = json.load(f)
            if isinstance(b, dict) and b.get("rules"):
                # Mac 은 한글 파일명을 NFD 로 돌려줄 수 있어 이름은 NFC 로 맞춘다
                b["name"] = unicodedata.normalize("NFC", str(b.get("name") or os.path.splitext(os.path.basename(fn))[0]))
                if b["name"] in seen:
                    out[seen[b["name"]]] = b
                else:
                    seen[b["name"]] = len(out)
                    out.append(b)
        except Exception as e:
            print("  ! 봇 파일 오류:", os.path.basename(fn), e)
    return out


# ----------------------------------------------------------------- WebSocket
def ws_handshake(sock, headers):
    key = headers.get("sec-websocket-key")
    if not key:
        return False
    accept = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
    sock.sendall(b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                 b"Sec-WebSocket-Accept: " + accept.encode() + b"\r\n\r\n")
    return True


def ws_send(sock, text):
    data = text.encode()
    n = len(data)
    if n < 126:
        head = struct.pack("!BB", 0x81, n)
    elif n < 65536:
        head = struct.pack("!BBH", 0x81, 126, n)
    else:
        head = struct.pack("!BBQ", 0x81, 127, n)
    sock.sendall(head + data)


def recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError
        buf += chunk
    return buf


def ws_recv(sock):
    b1, b2 = struct.unpack("!BB", recv_exact(sock, 2))
    op = b1 & 0x0F
    masked = b2 & 0x80
    ln = b2 & 0x7F
    if ln == 126:
        ln = struct.unpack("!H", recv_exact(sock, 2))[0]
    elif ln == 127:
        ln = struct.unpack("!Q", recv_exact(sock, 8))[0]
    mask = recv_exact(sock, 4) if masked else None
    payload = recv_exact(sock, ln) if ln else b""
    if mask:
        payload = bytes(payload[i] ^ mask[i % 4] for i in range(len(payload)))
    if op == 0x8:
        raise ConnectionError
    if op == 0x9:
        sock.sendall(struct.pack("!BB", 0x8A, 0))
        return None
    if op != 0x1:
        return None
    return payload.decode("utf-8", "replace")


def send_raw(cid, text):
    with lock:
        u = users.get(cid)
    if not u:
        return
    try:
        with u["wl"]:      # 여러 스레드(방 중계·무한 아레나)가 한 소켓에 동시에 쓰면 프레임이 섞인다
            ws_send(u["sock"], text)
    except Exception:
        pass


def send_to(cid, obj):
    send_raw(cid, json.dumps(obj, ensure_ascii=False))


arena = Arena(send_raw)   # 무한 아레나 (서버 권위 · 계산 스레드는 사람이 있을 때만 돈다)


# ----------------------------------------------------------------- 상태 전파
def lobby_view():
    inf = arena.human_count()
    with lock:
        rs = [{"id": r["id"], "title": r["title"], "locked": bool(r["pw"]),
               "host": users.get(r["host"], {}).get("name", "?"),
               "players": seat_count(r), "max": ROOM_MAX, "state": r["state"], "spect": len(r.get("spect", [])),
               "mode": r.get("mode", "people")}
              for r in rooms.values()]
        us = [{"id": c, "name": u["name"], "room": u["room"], "inf": bool(u.get("inf"))} for c, u in users.items() if u["name"]]
    return {"t": "lobby", "rooms": rs, "users": us, "inf": inf}


def broadcast_lobby():
    v = lobby_view()
    with lock:
        targets = [c for c, u in users.items() if u["room"] is None and u["name"]]
    for c in targets:
        send_to(c, v)


def room_view(r):
    return {"t": "room", "id": r["id"], "title": r["title"], "host": r["host"], "state": r["state"], "map": r.get("map", "snow"),
            "dir": r.get("dir", ""), "mode": r.get("mode", "people"), "convert": r.get("convert"), "fill": r.get("fill", {"cpu": 0, "gpu": 0}),
            "botsOn": r.get("botsOn", False),
            "members": [{"id": c, "name": users.get(c, {}).get("name", "?"), "gone": users.get(c, {}).get("gone", False),
                         "b": r["slots"].get(c, {}).get("b"), "ready": r["slots"].get(c, {}).get("ready", False),
                         "watch": r["slots"].get(c, {}).get("watch", False),
                         "team": r["slots"].get(c, {}).get("team", "cpu")}
                        for c in r["members"]],
            "spect": [users.get(c, {}).get("name", "?") for c in r.get("spect", [])]}


def broadcast_room(rid):
    with lock:
        r = rooms.get(rid)
        if not r:
            return
        v = room_view(r)
        members = list(r["members"]) + list(r.get("spect", []))
    for c in members:
        send_to(c, v)


def room_chat(rid, text, frm="시스템"):
    with lock:
        r = rooms.get(rid)
        members = (list(r["members"]) + list(r.get("spect", []))) if r else []
    for c in members:
        send_to(c, {"t": "chat", "from": frm, "text": text, "sys": frm == "시스템"})


def leave_room(cid, quiet=False):
    """방에서 나가기. 방장이면 위임, 비면 삭제. 경기 중 방장이 나가면 경기 중단."""
    with lock:
        u = users.get(cid)
        if not u or u["room"] is None:
            return
        rid = u["room"]
        u["room"] = None
        r = rooms.get(rid)
        if not r:
            return
        was_spect = cid in r.get("spect", [])
        if was_spect:
            r["spect"].remove(cid)
        if cid in r["members"]:
            r["members"].remove(cid)
        r["slots"].pop(cid, None)
        name = u["name"]
        if was_spect:
            send_to(cid, {"t": "left_room"})
            broadcast_room(rid)
            return
        if not r["members"]:
            del rooms[rid]
            print(f"  · 방 {rid} 삭제 (빈 방)")
            archive_room_dir(r.get("dir"))
            rid = None
        else:
            if r["host"] == cid:
                r["host"] = r["members"][0]
                stopped = r["state"] == "playing"
                r["state"] = "waiting"
                for s in r["slots"].values():
                    s["ready"] = False
                new_host = users.get(r["host"], {}).get("name", "?")
            else:
                stopped = False
                new_host = None
                if r["state"] == "playing":
                    # 경기 중 멤버 이탈 → 방장에게 알림(그 자리는 봇이 됨)
                    send_to(r["host"], {"t": "left", "id": cid})
    send_to(cid, {"t": "left_room"})
    if rid is not None:
        if new_host:
            room_chat(rid, f"{name} 님이 나가서 {new_host} 님이 방장이 되었습니다." + (" 경기가 중단되었습니다." if stopped else ""))
        elif not quiet:
            room_chat(rid, f"{name} 님이 나갔습니다.")
        broadcast_room(rid)
    broadcast_lobby()


def drop_user(cid):
    """연결 끊김. 방에 있던 사람은 GHOST_SEC 동안 자리를 지켜준다 (같은 닉네임으로 재접속하면 복귀)."""
    arena.leave(cid)   # 무한 아레나는 자리를 지켜 주지 않는다 (다시 들어오면 새로 태어남)
    with lock:
        u = users.get(cid)
        rr = rooms.get(u["room"]) if u and u["room"] is not None else None
        # 경기 중 방장은 바로 위임 (경기 계산이 사라지므로). 대기 중이면 방장도 새로고침에 대비해 자리를 지켜 준다
        in_room = bool(rr and cid in rr["members"] and (rr["host"] != cid or rr["state"] != "playing"))
    if in_room:
        with lock:
            u["gone"] = True
            u["gone_n"] = n = u.get("gone_n", 0) + 1   # 끊길 때마다 번호를 올려, 예전 타이머가 새 유령을 지우지 않게
            try:
                u["sock"].close()
            except Exception:
                pass
        print(f"  ~ 연결 끊김: #{cid} {u['name']}  ({GHOST_SEC}초 동안 자리 유지)")
        if rr["state"] == "playing":
            send_to(rr["host"], {"t": "away", "id": cid})
        broadcast_room(u["room"])
        threading.Timer(GHOST_SEC, expire_ghost, args=(cid, n)).start()
        return
    leave_room(cid, quiet=False)
    with lock:
        u = users.pop(cid, None)
    if u:
        try:
            u["sock"].close()
        except Exception:
            pass
        print(f"  - 퇴장: #{cid} {u['name']}  (접속 {len(users)}명)")
        broadcast_lobby()


def expire_ghost(cid, n):
    with lock:
        u = users.get(cid)
        if not u or not u.get("gone") or u.get("gone_n") != n:
            return
    leave_room(cid)
    with lock:
        u = users.pop(cid, None)
    if u:
        print(f"  - 퇴장(시간 초과): #{cid} {u['name']}")
        broadcast_lobby()


# ----------------------------------------------------------------- 메시지 처리
def handle_msg(cid, raw):
    try:
        obj = json.loads(raw)
    except Exception:
        return
    t = obj.get("t")
    with lock:
        u = users.get(cid)
        if not u:
            return
        rid = u["room"]
        r = rooms.get(rid) if rid is not None else None

    # ---- 무한 아레나 (입력이 가장 잦으므로 맨 먼저) ----
    if t and t.startswith("inf_"):
        if t == "inf_join":
            if r:
                leave_room(cid, quiet=False)
            u["inf"] = True
            arena.join(cid, u["name"] or "이름없음", str(obj.get("ch", ""))[:12])
            broadcast_lobby()
        elif t == "inf_leave":
            u["inf"] = False
            arena.leave(cid)
            send_to(cid, lobby_view())
            broadcast_lobby()
        else:
            arena.on_msg(cid, obj)
        return

    # ---- 경기 중계 (가장 잦은 메시지라 먼저) ----
    if t == "quit":           # 학생이 경기 중 스스로 나감 → 방장에게 알려 그 자리를 봇으로
        if r and r["state"] == "playing" and r["host"] != cid:
            send_to(r["host"], {"t": "away", "id": cid})
        return
    if t in MEMBER_RELAY:
        if r and r["state"] == "playing" and r["host"] != cid:
            obj["id"] = cid
            send_to(r["host"], obj)
        return
    if t in HOST_RELAY:
        if r and r["host"] == cid:
            with lock:
                others = [c for c in r["members"] if c != cid] + list(r.get("spect", []))
            for c in others:
                send_raw(c, raw)
        return

    if t == "hello":
        name = str(obj.get("name", "")).strip()[:12] or "이름없음"
        with lock:
            ghost = next((c for c, x in users.items() if x.get("gone") and x["name"] == name), None)
            if ghost is not None:
                # 끊겼던 사람이 돌아옴: 옛 cid 를 그대로 쓴다 (방·자리·호스트의 world 모두 유지)
                g = users[ghost]
                g["sock"], g["gone"] = u["sock"], False
                users.pop(cid, None)
                rid2 = g["room"]
                r2 = rooms.get(rid2)
            else:
                u["name"] = name
        if ghost is not None:
            send_to(ghost, {"t": "welcome", "id": ghost, "name": name})
            print(f"  ↩ 복귀: #{ghost} {name}")
            if r2:
                broadcast_room(rid2)
                room_chat(rid2, f"{name} 님이 다시 들어왔습니다.")
                if r2["state"] == "playing" and r2["host"] != ghost:
                    send_to(r2["host"], {"t": "rejoin", "id": ghost})
            return ghost
        send_to(cid, {"t": "welcome", "id": cid, "name": name})
        print(f"  + 입장: #{cid} {name}  (접속 {len(users)}명)")
        broadcast_lobby()
        return

    if t == "create_room":
        global next_rid
        if u.get("inf"):
            u["inf"] = False
            arena.leave(cid)
        if r:
            leave_room(cid)
        title = str(obj.get("title", "")).strip()[:20] or f"{u['name']}님의 방"
        mode = "bots" if obj.get("mode") == "bots" else "people"   # 방 기능: 학생 대전(people) / 봇전(bots)
        pw = str(obj.get("pw", ""))[:16]
        with lock:
            rid = next_rid
            next_rid += 1
            rooms[rid] = {"id": rid, "title": title, "pw": pw, "host": cid, "members": [cid], "spect": [], "state": "waiting",
                          "map": "snow", "slots": {cid: {"b": obj.get("b"), "ready": False, "team": "cpu"}},
                          "dir": make_room_dir(rid, title), "mode": mode, "botsOn": mode == "bots",
                          "fill": {"cpu": 0, "gpu": 0}}   # 빈자리에 방장이 [+] 로 넣은 봇 수 (자동으로 채우지 않음)
            u["room"] = rid
        print(f"  · 방 {rid} 생성: {title} [{'봇전' if mode == 'bots' else '학생 대전'}] (방장 {u['name']})")
        broadcast_room(rid)
        broadcast_lobby()
        return

    if t == "join_room":
        if u.get("inf"):
            u["inf"] = False
            arena.leave(cid)
        if r:
            leave_room(cid)
        rid2 = obj.get("rid")
        if obj.get("spectate"):
            with lock:
                r2 = rooms.get(rid2)
                if r2:
                    r2.setdefault("spect", []).append(cid)
                    u["room"] = rid2
            if not r2:
                send_to(cid, {"t": "err", "msg": "없는 방입니다"})
                return
            print(f"  · 관전: #{cid} {u['name']} → 방 {rid2}")
            broadcast_room(rid2)
            broadcast_lobby()
            send_to(r2["host"], {"t": "rejoin", "id": cid})   # 호스트가 init 을 다시 보내준다
            return
        with lock:
            r2 = rooms.get(rid2)
            if not r2:
                err = "없는 방입니다"
            elif r2["state"] == "playing":
                err = "경기 중인 방입니다"
            elif seat_count(r2) >= ROOM_MAX:
                err = "방이 꽉 찼습니다"
            elif r2["pw"] and r2["pw"] != str(obj.get("pw", "")):
                err = "비밀번호가 틀렸습니다"
            else:
                err = None
                r2["members"].append(cid)
                r2["slots"][cid] = {"b": obj.get("b"), "ready": False, "team": pick_team(r2)}
                u["room"] = rid2
        if err:
            send_to(cid, {"t": "err", "msg": err})
            return
        room_chat(rid2, f"{u['name']} 님이 들어왔습니다.")
        broadcast_room(rid2)
        broadcast_lobby()
        return

    if t == "leave_room":
        leave_room(cid)
        return

    if t == "pick":           # 빌드(진영) 변경
        if not r or cid not in r["members"]:
            return
        with lock:
            s = r["slots"].setdefault(cid, {"b": None, "ready": False})
            s["b"] = obj.get("b")
            if r["state"] == "waiting" and r["host"] != cid:
                s["ready"] = False
        broadcast_room(rid)
        return

    if t == "fill":          # 방장이 팀 빈자리에 [+] 봇 추가 / [−] 빼기
        side = obj.get("side")
        if not r or r["host"] != cid or r["state"] != "waiting" or side not in ("cpu", "gpu"):
            return
        with lock:
            fill = r.setdefault("fill", {"cpu": 0, "gpu": 0})
            room_left = 5 - team_count(r, side)
            fill[side] = max(0, min(room_left, fill.get(side, 0) + (1 if obj.get("d", 1) > 0 else -1)))
        broadcast_room(rid)
        return

    if t == "convert":       # 봇전 방장이 [봇 만들기] → rooms/<방>/request.json → 선생님 PC 의 /봇대기 가 바로 /봇생성
        if not r or r["host"] != cid or r.get("mode") != "bots" or r["state"] != "waiting":
            return
        d = os.path.join(ROOMS_DIR, r["dir"])
        try:
            os.remove(os.path.join(d, "status.json"))   # 이전 변환 결과는 지우고 새 요청으로
        except OSError:
            pass
        now = time.strftime("%H:%M:%S")
        with open(os.path.join(d, "request.json"), "w", encoding="utf-8") as f:
            json.dump({"room": r["dir"], "by": u["name"], "time": now}, f, ensure_ascii=False)
        with lock:
            r["convert"] = {"state": "요청됨", "time": now}
        print(f"  ⚙ 봇 만들기 요청: {r['dir']} (방장 {u['name']})")
        broadcast_room(rid)
        room_chat(rid, "방장이 [봇 만들기]를 눌렀습니다 — 선생님 PC가 제출된 전략을 봇으로 바꿉니다.")
        return

    if t == "map":
        if not r or r["host"] != cid:
            return
        with lock:
            r["map"] = str(obj.get("id", "snow"))[:16]
        broadcast_room(rid)
        return

    if t == "team":           # A팀(cpu) / B팀(gpu) 선택 — 캐릭터와 무관
        if not r or cid not in r["members"] or r["state"] != "waiting":
            return
        team = "gpu" if obj.get("team") == "gpu" else "cpu"
        with lock:
            sl = r["slots"].setdefault(cid, {"b": None, "ready": False})
            already = sl.get("team") == team and not sl.get("watch")
            if not already and team_count(r, team) >= 5:
                err = "그 팀은 5명이 꽉 찼습니다"
            elif sl.get("watch") and seat_count(r) >= ROOM_MAX:
                err = "자리가 꽉 찼습니다"
            else:
                err = None
                sl["team"], sl["watch"] = team, False
                if r["host"] != cid:
                    sl["ready"] = False
        if err:
            send_to(cid, {"t": "err", "msg": err})
            return
        broadcast_room(rid)
        broadcast_lobby()
        return

    if t == "watch":          # 방 안에서 참가 ↔ 관전 전환 (선생님도 가능)
        if not r or cid not in r["members"] or r["state"] != "waiting":
            return
        on = bool(obj.get("on"))
        with lock:
            sl = r["slots"].setdefault(cid, {"b": None, "ready": False})
            if not on and seat_count(r) >= ROOM_MAX:
                err = "자리가 꽉 차서 참가로 바꿀 수 없습니다"
            else:
                err = None
                sl["watch"] = on
                sl["ready"] = False
                if not on:
                    sl["team"] = pick_team(r)
        if err:
            send_to(cid, {"t": "err", "msg": err})
            return
        broadcast_room(rid)
        broadcast_lobby()
        return

    if t == "ready":
        if not r or r["state"] != "waiting" or cid not in r["members"]:
            return
        with lock:
            r["slots"].setdefault(cid, {"b": None, "ready": False})["ready"] = bool(obj.get("on"))
        broadcast_room(rid)
        return

    if t == "start":
        if not r or r["host"] != cid or r["state"] == "playing":
            return
        with lock:
            r["state"] = "playing"
        print(f"  ▶ 방 {rid} 경기 시작 ({len(r['members'])}명)")
        broadcast_room(rid)
        broadcast_lobby()
        return

    if t == "end":            # 방장이 결과 화면을 닫음 → 대기 상태로
        if not r or r["host"] != cid:
            return
        with lock:
            r["state"] = "waiting"
            for s in r["slots"].values():
                s["ready"] = False
        broadcast_room(rid)
        broadcast_lobby()
        return

    if t == "chat":
        text = str(obj.get("text", "")).strip()[:200]
        if not text:
            return
        msg = {"t": "chat", "from": u["name"], "text": text, "sys": False, "id": cid}
        if r:
            with lock:
                targets = list(r["members"])
        else:
            with lock:
                targets = [c for c, x in users.items() if x["room"] is None]
        for c in targets:
            send_to(c, msg)
        return

    if t == "submit":
        name = obj.get("name") or u["name"]
        if not r or not r.get("dir"):
            send_to(cid, {"t": "submitok", "name": name, "bot": False, "botErr": "방에 들어간 뒤 제출하세요"})
            return
        rdir = os.path.join(ROOMS_DIR, r["dir"])
        rules = obj.get("rules")
        # 규칙표 제출: 형식은 지금 검사하지만(틀리면 바로 알려 줌) 봇 파일은 만들지 않는다.
        # 제출문 머리에 '# 직접규칙 N:' 줄로 적어 두고, 선생님이 /봇생성 을 칠 때 에이전트가 그대로 옮긴다.
        bot, err = make_direct_bot(name, obj.get("build"), rules) if rules is not None else (None, None)
        if err:   # 규칙표가 잘못되면 제출문도 남기지 않는다 (고쳐서 다시 내게)
            print("  ↓ 전략 제출 거부:", safe_name(name), "-", err)
            send_to(cid, {"t": "submitok", "name": name, "bot": False, "botErr": err})
            return
        text = str(obj.get("text", ""))[:2000] or "(규칙 직접 만들기로 제출)"
        fn = save_submission(name, text, obj.get("build"), bot["rules"] if bot else None, os.path.join(rdir, "submissions"))
        print("  ↓ 전략 제출:", os.path.relpath(fn, HERE), "(규칙표)" if bot else "")
        send_to(cid, {"t": "submitok", "name": name, "bot": False, "queued": True, "direct": bool(bot), "rules": len(bot["rules"]) if bot else 0})
        return

    if t == "getbots":
        bots = load_bots(r)
        send_to(cid, {"t": "bots", "list": bots})
        return


def handle_ws(sock):
    global next_cid
    with lock:
        cid = next_cid
        next_cid += 1
        users[cid] = {"sock": sock, "name": "", "room": None, "wl": threading.Lock()}
    try:
        while True:
            msg = ws_recv(sock)
            if msg is None:
                continue
            new_cid = handle_msg(cid, msg)
            if isinstance(new_cid, int):
                cid = new_cid
    except Exception:
        pass
    finally:
        drop_user(cid)


# ----------------------------------------------------------------- HTTP
def serve_file(sock, path):
    from urllib.parse import unquote
    rel = "arena.html" if path in ("/", "/index.html") else unquote(path).lstrip("/")
    full = os.path.normpath(os.path.join(HERE, rel))
    fname = os.path.basename(full)
    if not full.startswith(HERE + os.sep) or not os.path.isfile(full):
        sock.sendall(b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\n\r\nnot found")
        return
    ctype = {"html": "text/html; charset=utf-8", "js": "text/javascript", "css": "text/css", "json": "application/json",
             "png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "ico": "image/x-icon"}.get(fname.rsplit(".", 1)[-1], "application/octet-stream")
    with open(full, "rb") as f:
        body = f.read()
    sock.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: " + ctype.encode() +
                 b"\r\nContent-Length: " + str(len(body)).encode() +
                 b"\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n" + body)


def handle(sock, addr):
    try:
        sock.settimeout(20)
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = sock.recv(4096)
            if not chunk:
                return
            data += chunk
            if len(data) > 65536:
                return
        head, _, _ = data.partition(b"\r\n\r\n")
        lines = head.decode("latin1").split("\r\n")
        m = re.match(r"(\w+)\s+(\S+)", lines[0])
        if not m:
            return
        method, target = m.group(1), m.group(2)
        headers = {}
        for ln in lines[1:]:
            if ":" in ln:
                k, v = ln.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        path = target.split("?")[0]
        if headers.get("upgrade", "").lower() == "websocket":
            if not ws_handshake(sock, headers):
                return
            sock.settimeout(None)
            handle_ws(sock)
            return
        if method == "GET":
            serve_file(sock, path)
    except Exception:
        pass
    finally:
        try:
            sock.close()
        except Exception:
            pass


def lan_ips():
    out = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        out.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127.") and ip not in out:
                out.append(ip)
    except Exception:
        pass
    return out or ["127.0.0.1"]


def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("0.0.0.0", PORT))
    srv.listen(64)
    print("=" * 58)
    print("  GPU 아레나 서버 시작")
    print("=" * 58)
    for ip in lan_ips():
        print(f"  접속 주소 :  http://{ip}:{PORT}/")
    print("=" * 58)
    print("  칠판에 접속 주소를 적어주세요. 종료는 Ctrl+C.")
    print("  전략 제출 → rooms/<방>/submissions   (방마다 폴더, 방이 사라지면 rooms/_지난방/ 으로)")
    print("  규칙봇    → rooms/<방>/bots   (Claude Code 가 여기에 JSON 을 씁니다) · 공용 봇 → bots/")
    for d in os.listdir(ROOMS_DIR):   # 서버가 새로 켜지면 이전 방은 모두 사라진 것 → 보관
        if d != os.path.basename(ARCHIVE_DIR) and os.path.isdir(os.path.join(ROOMS_DIR, d)):
            archive_room_dir(d)
    print("  접속이 안 되면 방화벽에서 이 포트의 인바운드를 허용해야 합니다.")
    print()
    # Windows 에서는 accept() 로 기다리는 동안 Ctrl+C 가 전달되지 않으므로
    # 1초마다 깨어나서 Ctrl+C 를 확인할 수 있게 한다.
    srv.settimeout(1.0)

    def console():   # 서버 창에 q 입력 + 엔터 → 종료
        while True:
            try:
                line = input()
            except (EOFError, OSError):
                return
            if line.strip().lower() in ("q", "quit", "exit", "종료", "끄기"):
                print("서버 종료")
                srv.close()
                os._exit(0)
    threading.Thread(target=console, daemon=True).start()
    threading.Thread(target=watch_bots, daemon=True).start()
    print("  끄려면 이 창에 q 입력 후 엔터 (또는 Ctrl+C)")
    try:
        while True:
            try:
                c, a = srv.accept()
            except socket.timeout:
                continue
            c.settimeout(None)
            threading.Thread(target=handle, args=(c, a), daemon=True).start()
    except KeyboardInterrupt:
        print("\n서버 종료")
    finally:
        srv.close()
        os._exit(0)   # 접속 중인 학생 연결(스레드)까지 바로 정리


if __name__ == "__main__":
    main()
