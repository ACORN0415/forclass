"""
무한 아레나 — 로비에서 [참가하기] 를 누르면 바로 들어가는 상시 개인전 (방 없음)

  · 방장 브라우저가 아니라 **이 서버가 직접** 계산합니다 (누가 나가도 계속 돌아감).
  · 기본 무기는 칼(짧은 사거리). 상자를 부수면 총(권총·소총·기관총·산탄총·바주카)·탄약·구급상자가 나옵니다.
  · 탄약은 상자를 부수거나 사람을 쓰러뜨려 얻습니다. 쓰러진 사람은 그 자리에 총·탄약을 떨어뜨립니다.
  · 쓰러지면 5초 뒤 맵 아무 곳에서나 다시 태어납니다. 처치 수로 순위를 매깁니다.

arena_server.py 가 Arena 하나를 만들어 메시지를 넘겨 줍니다. 네트워크 전송은 send_raw(cid, text) 로만 합니다.
"""
import json, math, random, threading, time

W, H = 3200, 2000            # 기존 맵(960×600)의 약 11배 넓이
TICK = 1 / 30                # 계산 30Hz
SEND_EVERY = 2               # 스냅샷 15Hz
PR = 14                      # 캐릭터 반지름
SPEED = 200
MAX_HP = 100
RESPAWN = 5.0
PROTECT = 2.0                # 부활 직후 무적 시간
VIEW_X, VIEW_Y = 1000, 700   # 이 범위 안의 것만 보내 준다 (화면보다 조금 넓게)
CRATE_N = 70
CRATE_HP = 60
CRATE_S = 34
MIN_PLAYERS = 6              # 사람이 이보다 적으면 봇으로 채운다 (사람이 0명이면 계산도 멈춤)
ITEM_TTL = 60
ITEM_MAX = 260
PICK_R = 40

WEAPONS = {
    "knife":   dict(name="칼", melee=True, dmg=34, cd=0.45, range=58, arc=1.1),
    "pistol":  dict(name="권총", dmg=22, cd=0.30, spd=950, spread=0.04, n=1, life=0.70, start=24, max=60, pick=12),
    "rifle":   dict(name="소총", dmg=45, cd=0.60, spd=1500, spread=0.008, n=1, life=0.75, start=10, max=30, pick=8),
    "mg":      dict(name="기관총", dmg=12, cd=0.075, spd=1050, spread=0.11, n=1, life=0.60, start=80, max=200, pick=50),
    "shotgun": dict(name="산탄총", dmg=11, cd=0.85, spd=900, spread=0.42, n=8, life=0.33, start=8, max=24, pick=6),
    "bazooka": dict(name="바주카", dmg=95, cd=1.5, spd=560, spread=0.0, n=1, life=1.6, start=3, max=8, pick=2, splash=100),
}
GUN_ODDS = [("pistol", 30), ("shotgun", 20), ("mg", 18), ("rifle", 17), ("bazooka", 8)]
CHARS = ["dao", "bazzi", "marid", "su", "kephi", "mos", "dizni", "uni", "ethi"]
BOT_NAMES = ["눈사람", "펭귄", "북극곰", "얼음왕", "썰매", "고드름", "눈토끼", "빙하"]
CELL = 160


def rect_hit(x, y, r, o):
    cx = min(max(x, o[0]), o[0] + o[2])
    cy = min(max(y, o[1]), o[1] + o[3])
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy < r * r


def cells(x0, y0, x1, y1):
    for gx in range(int(x0 // CELL), int(x1 // CELL) + 1):
        for gy in range(int(y0 // CELL), int(y1 // CELL) + 1):
            yield gx, gy


def gen_map(seed=20261018):
    rnd = random.Random(seed)
    shapes = [(26, 170), (170, 26), (150, 26), (26, 150), (56, 140), (140, 56), (120, 24), (24, 120),
              (48, 48), (40, 40), (230, 24), (24, 230)]
    walls = []
    tries = 0
    while len(walls) < 130 and tries < 6000:
        tries += 1
        w, h = rnd.choice(shapes)
        x, y = rnd.randint(60, W - 60 - w), rnd.randint(60, H - 60 - h)
        if any(x < o[0] + o[2] + 60 and x + w + 60 > o[0] and y < o[1] + o[3] + 60 and y + h + 60 > o[1] for o in walls):
            continue
        walls.append((x, y, w, h))
    trees = []
    while len(trees) < 90:
        x, y = rnd.randint(30, W - 30), rnd.randint(30, H - 30)
        if not any(rect_hit(x, y, 30, o) for o in walls):
            trees.append((x, y))
    return walls, trees


class Arena:
    def __init__(self, send_raw):
        self.send_raw = send_raw
        self.lock = threading.Lock()
        self.walls, self.trees = gen_map()
        self.wgrid = {}
        for i, o in enumerate(self.walls):
            for c in cells(o[0], o[1], o[0] + o[2], o[1] + o[3]):
                self.wgrid.setdefault(c, []).append(o)
        self.players = {}        # id → dict (사람은 cid, 봇은 음수)
        self.crates = {}         # id → [x, y, hp]  (x,y = 왼쪽 위)
        self.cgrid = {}
        self.items = {}          # id → dict(k, w, a, x, y, ttl)
        self.bullets = []
        self.fx = []             # 이번 전송 사이의 사건
        self.senders = {}        # cid → [event, latest_text]
        self.seq = 0
        self.n = 0
        self.t = 0.0
        self.crate_timer = 0.0
        self.bot_no = 0
        for _ in range(CRATE_N):
            self.spawn_crate()
        threading.Thread(target=self.run, daemon=True).start()

    # ------------------------------------------------------------ 공용
    def nid(self):
        self.seq += 1
        return self.seq

    def humans(self):
        return [p for p in self.players.values() if not p["bot"]]

    def human_count(self):
        with self.lock:
            return len(self.humans())

    def blocked(self, x, y, r, crates=True):
        if x < r or y < r or x > W - r or y > H - r:
            return True
        for c in cells(x - r, y - r, x + r, y + r):
            for o in self.wgrid.get(c, ()):
                if rect_hit(x, y, r, o):
                    return True
            if crates:
                for cid in self.cgrid.get(c, ()):
                    k = self.crates.get(cid)
                    if k and rect_hit(x, y, r, (k[0], k[1], CRATE_S, CRATE_S)):
                        return True
        return False

    def crate_at(self, x, y, r):
        for c in cells(x - r, y - r, x + r, y + r):
            for cid in self.cgrid.get(c, ()):
                k = self.crates.get(cid)
                if k and rect_hit(x, y, r, (k[0], k[1], CRATE_S, CRATE_S)):
                    return cid
        return None

    def wall_at(self, x, y, r):
        for c in cells(x - r, y - r, x + r, y + r):
            for o in self.wgrid.get(c, ()):
                if rect_hit(x, y, r, o):
                    return True
        return x < 0 or y < 0 or x > W or y > H

    def line_blocked(self, x1, y1, x2, y2):
        d = math.hypot(x2 - x1, y2 - y1)
        n = max(1, int(d // 24))
        for i in range(1, n):
            t = i / n
            if self.wall_at(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, 3):
                return True
        return False

    def free_spot(self, r, away=0):
        for k in range(200):
            x, y = random.uniform(80, W - 80), random.uniform(80, H - 80)
            if self.blocked(x, y, r + 6):
                continue
            if away and k < 150 and any(not p["dead"] and math.hypot(p["x"] - x, p["y"] - y) < away for p in self.players.values()):
                continue
            return x, y
        return W / 2, H / 2

    def spawn_crate(self):
        x, y = self.free_spot(CRATE_S, away=300)
        x, y = x - CRATE_S / 2, y - CRATE_S / 2
        cid = self.nid()
        self.crates[cid] = [x, y, CRATE_HP]
        for c in cells(x, y, x + CRATE_S, y + CRATE_S):
            self.cgrid.setdefault(c, []).append(cid)

    def remove_crate(self, cid):
        k = self.crates.pop(cid, None)
        if not k:
            return
        for c in cells(k[0], k[1], k[0] + CRATE_S, k[1] + CRATE_S):
            lst = self.cgrid.get(c)
            if lst and cid in lst:
                lst.remove(cid)
        cx, cy = k[0] + CRATE_S / 2, k[1] + CRATE_S / 2
        self.fx.append(["break", round(cx), round(cy)])
        roll = random.random()
        if roll < 0.55:
            w = self.random_gun()
            self.drop("gun", cx, cy, w, WEAPONS[w]["start"])
        elif roll < 0.85:
            self.drop("ammo", cx, cy)
        else:
            self.drop("hp", cx, cy)
        if random.random() < 0.35:
            self.drop("ammo", cx + random.uniform(-14, 14), cy + random.uniform(-14, 14))

    def random_gun(self):
        tot = sum(w for _, w in GUN_ODDS)
        r = random.uniform(0, tot)
        for k, w in GUN_ODDS:
            r -= w
            if r <= 0:
                return k
        return "pistol"

    def drop(self, k, x, y, w=None, a=0):
        if len(self.items) >= ITEM_MAX:
            oldest = min(self.items, key=lambda i: self.items[i]["ttl"])
            del self.items[oldest]
        self.items[self.nid()] = {"k": k, "w": w, "a": a, "x": x, "y": y, "ttl": ITEM_TTL}

    # ------------------------------------------------------------ 참가자
    def new_player(self, pid, name, ch, bot=False):
        x, y = self.free_spot(PR, away=250)
        p = {"id": pid, "name": name, "ch": ch if ch in CHARS else random.choice(CHARS), "bot": bot,
             "x": x, "y": y, "aim": 0.0, "hp": MAX_HP, "gun": None, "ammo": 0, "use": "knife", "cd": 0.0,
             "dead": False, "rt": 0.0, "prot": PROTECT, "kills": 0, "deaths": 0, "swing": 0.0,
             "inp": {"mx": 0, "my": 0, "f": 0}, "by": "", "think": 0.0, "goal": None, "wander": random.uniform(0, 6.28)}
        self.players[pid] = p
        return p

    def join(self, cid, name, ch):
        with self.lock:
            if cid not in self.players:
                self.new_player(cid, name, ch)
                print(f"  ⚔ 무한 아레나 입장: #{cid} {name}  (사람 {len(self.humans())}명)")
            sd = self.senders.get(cid)
            if not sd:
                sd = self.senders[cid] = [threading.Event(), None]
                threading.Thread(target=self.sender, args=(cid, sd), daemon=True).start()
            init = {"t": "inf_init", "id": cid, "W": W, "H": H, "walls": self.walls, "trees": self.trees,
                    "speed": SPEED, "pr": PR, "crate": CRATE_S, "respawn": RESPAWN, "hp": MAX_HP,
                    "wpn": {k: {"name": v["name"], "max": v.get("max", 0)} for k, v in WEAPONS.items()}}
        self.send_raw(cid, json.dumps(init, ensure_ascii=False))

    def leave(self, cid):
        with self.lock:
            p = self.players.pop(cid, None)
            sd = self.senders.pop(cid, None)
            if p and not p["dead"]:
                self.drop_loot(p)
        if sd:
            sd[1] = None
            sd[0].set()
        if p:
            print(f"  ⚔ 무한 아레나 퇴장: #{cid} {p['name']}")
        return bool(p)

    def has(self, cid):
        with self.lock:
            return cid in self.players

    def sender(self, cid, sd):
        """사람마다 하나. 가장 최근 스냅샷만 보낸다 → 느린 학생 PC 때문에 서버 계산이 멈추지 않음."""
        while True:
            sd[0].wait()
            sd[0].clear()
            with self.lock:
                if self.senders.get(cid) is not sd:
                    return
                text, sd[1] = sd[1], None
            if text:
                self.send_raw(cid, text)

    def on_msg(self, cid, obj):
        t = obj.get("t")
        with self.lock:
            p = self.players.get(cid)
            if not p:
                return
            if t == "inf_in":
                try:
                    mx, my = float(obj.get("mx", 0)), float(obj.get("my", 0))
                    p["inp"] = {"mx": max(-1, min(1, mx)), "my": max(-1, min(1, my)), "f": 1 if obj.get("f") else 0}
                    p["aim"] = float(obj.get("aim", 0))
                except (TypeError, ValueError):
                    pass
            elif t == "inf_sw":
                w = obj.get("w")
                p["use"] = "knife" if w == "knife" else ("gun" if w == "gun" else ("knife" if p["use"] == "gun" else "gun"))
            elif t == "inf_pick":
                self.pick_gun(p)

    # ------------------------------------------------------------ 무기
    def cur_weapon(self, p):
        return p["gun"] if (p["use"] == "gun" and p["gun"] and p["ammo"] > 0) else "knife"

    def pick_gun(self, p):
        best, bd = None, PICK_R + 6
        for iid, it in self.items.items():
            if it["k"] != "gun":
                continue
            d = math.hypot(it["x"] - p["x"], it["y"] - p["y"])
            if d < bd:
                best, bd = iid, d
        if best is None:
            return False
        it = self.items.pop(best)
        if p["gun"]:
            self.drop("gun", p["x"], p["y"], p["gun"], p["ammo"])
        p["gun"], p["ammo"], p["use"] = it["w"], it["a"], "gun"
        return True

    def fire(self, p):
        w = self.cur_weapon(p)
        W_ = WEAPONS[w]
        p["cd"] = W_["cd"]
        a = p["aim"]
        if W_.get("melee"):
            p["swing"] = 0.22
            self.fx.append(["slash", round(p["x"]), round(p["y"]), round(a, 2)])
            for q in self.players.values():
                if q is p or q["dead"]:
                    continue
                d = math.hypot(q["x"] - p["x"], q["y"] - p["y"])
                if d > W_["range"] + PR:
                    continue
                da = (math.atan2(q["y"] - p["y"], q["x"] - p["x"]) - a + math.pi) % (2 * math.pi) - math.pi
                if abs(da) <= W_["arc"] / 2 or d < PR * 1.6:
                    self.damage(q, W_["dmg"], p, w, q["x"], q["y"])
            hx, hy = p["x"] + math.cos(a) * 34, p["y"] + math.sin(a) * 34
            cid = self.crate_at(hx, hy, 26)
            if cid:
                self.hit_crate(cid, W_["dmg"])
            return
        p["ammo"] -= 1
        n = W_["n"]
        for k in range(n):
            off = ((k / (n - 1) - 0.5) * W_["spread"] if n > 1 else 0) + random.uniform(-0.5, 0.5) * (W_["spread"] if n == 1 else 0.06)
            ang = a + off
            sp = W_["spd"] * (random.uniform(0.92, 1.05) if n > 1 else 1)
            self.bullets.append({"id": self.nid(), "x": p["x"] + math.cos(a) * 18, "y": p["y"] + math.sin(a) * 18,
                                 "vx": math.cos(ang) * sp, "vy": math.sin(ang) * sp, "life": W_["life"], "w": w, "src": p["id"]})
        self.fx.append(["shot", round(p["x"]), round(p["y"]), w])
        if p["ammo"] <= 0:
            p["use"] = "knife"

    def hit_crate(self, cid, dmg):
        k = self.crates.get(cid)
        if not k:
            return
        k[2] -= dmg
        if k[2] <= 0:
            self.remove_crate(cid)

    def damage(self, q, dmg, src, w, x, y):
        if q["dead"] or q["prot"] > 0:
            return
        q["hp"] -= dmg
        self.fx.append(["hit", round(x), round(y)])
        if q["hp"] <= 0:
            q["hp"] = 0
            q["dead"] = True
            q["rt"] = RESPAWN
            q["deaths"] += 1
            q["by"] = src["name"] if src else ""
            if src and src is not q:
                src["kills"] += 1
            self.fx.append(["kill", src["name"] if src else "?", q["name"], w, src["id"] if src else 0, q["id"]])
            self.drop_loot(q)
            q["gun"], q["ammo"], q["use"] = None, 0, "knife"

    def drop_loot(self, q):
        if q["gun"]:
            self.drop("gun", q["x"] - 10, q["y"], q["gun"], max(q["ammo"], WEAPONS[q["gun"]]["pick"]))
        self.drop("ammo", q["x"] + 10, q["y"] + 6)

    def explode(self, x, y, src):
        R = WEAPONS["bazooka"]["splash"]
        self.fx.append(["boom", round(x), round(y)])
        for q in list(self.players.values()):
            if q["dead"] or q["id"] == src:
                continue
            d = math.hypot(q["x"] - x, q["y"] - y)
            if d < R + PR:
                self.damage(q, WEAPONS["bazooka"]["dmg"] * (1 - 0.6 * min(1, d / R)), self.players.get(src), "bazooka", q["x"], q["y"])
        for cid in {c for cell in cells(x - R, y - R, x + R, y + R) for c in self.cgrid.get(cell, ())}:
            k = self.crates.get(cid)
            if k and math.hypot(k[0] + CRATE_S / 2 - x, k[1] + CRATE_S / 2 - y) < R + CRATE_S / 2:
                self.hit_crate(cid, 999)

    # ------------------------------------------------------------ 봇
    def bot_think(self, p):
        tgt, td = None, 1e9
        for q in self.players.values():
            if q is p or q["dead"]:
                continue
            d = math.hypot(q["x"] - p["x"], q["y"] - p["y"])
            if d < td:
                tgt, td = q, d
        if tgt and (td > 650 or self.line_blocked(p["x"], p["y"], tgt["x"], tgt["y"])):
            tgt = None
        if p["gun"] and p["ammo"] > 0:
            p["use"] = "gun"
        w = self.cur_weapon(p)
        fire, mx, my = 0, 0.0, 0.0
        p["wander"] += 0.3
        if tgt and (w != "knife" or td < 200):
            lead = 0.0 if w == "knife" else td / WEAPONS[w]["spd"]
            ti = tgt["inp"]
            ax = tgt["x"] + ti["mx"] * SPEED * lead - p["x"]
            ay = tgt["y"] + ti["my"] * SPEED * lead - p["y"]
            p["aim"] = math.atan2(ay, ax) + random.uniform(-0.15, 0.15)   # 봇은 일부러 조금 빗맞힌다
            if w == "knife":
                mx, my = ax, ay
                fire = 1 if td < WEAPONS["knife"]["range"] + 8 else 0
            else:
                rng = WEAPONS[w]["spd"] * WEAPONS[w]["life"]
                want = rng * 0.5
                push = (td - want) / max(60, want)
                mx = ax / td * push + math.cos(p["wander"]) * 0.6
                my = ay / td * push + math.sin(p["wander"]) * 0.6
                fire = 1 if td < rng * 0.95 else 0
        else:
            goal = None
            if not p["gun"]:
                gd = 800
                for it in self.items.values():
                    if it["k"] == "gun":
                        d = math.hypot(it["x"] - p["x"], it["y"] - p["y"])
                        if d < gd:
                            goal, gd = (it["x"], it["y"]), d
            if not goal and (not p["gun"] or p["ammo"] < WEAPONS[p["gun"]]["pick"]):
                cd_ = 900
                for k in self.crates.values():
                    cx, cy = k[0] + CRATE_S / 2, k[1] + CRATE_S / 2
                    d = math.hypot(cx - p["x"], cy - p["y"])
                    if d < cd_:
                        goal, cd_ = (cx, cy), d
                if goal and cd_ < 46:
                    p["aim"] = math.atan2(goal[1] - p["y"], goal[0] - p["x"])
                    fire = 1
                    goal = None
            if goal:
                mx, my = goal[0] - p["x"], goal[1] - p["y"]
            elif not fire:
                if not p["goal"] or math.hypot(p["goal"][0] - p["x"], p["goal"][1] - p["y"]) < 40:
                    p["goal"] = self.free_spot(PR)
                mx, my = p["goal"][0] - p["x"], p["goal"][1] - p["y"]
        if mx or my:
            mx, my = self.steer(p, mx, my)
        p["inp"] = {"mx": mx, "my": my, "f": fire}

    def steer(self, p, ax, ay):
        a = math.atan2(ay, ax)
        sd = p.setdefault("sd", 1)
        for o in (0, sd * 0.5, sd * 1.0, sd * 1.5, -sd * 0.5, -sd * 1.0, -sd * 1.5, sd * 2.2, math.pi):
            b = a + o
            if not self.blocked(p["x"] + math.cos(b) * 30, p["y"] + math.sin(b) * 30, PR):
                if o == 0 and random.random() < 0.02:
                    p["sd"] = -sd
                return math.cos(b), math.sin(b)
        return ax, ay

    def fill_bots(self):
        hs = len(self.humans())
        bots = [p for p in self.players.values() if p["bot"]]
        want = max(0, MIN_PLAYERS - hs) if hs else 0
        while len(bots) < want:
            self.bot_no += 1
            self.bot_no %= 10000
            p = self.new_player(-self.bot_no - 1, "봇 " + BOT_NAMES[self.bot_no % len(BOT_NAMES)], None, bot=True)
            bots.append(p)
        while len(bots) > want:
            b = bots.pop()
            self.players.pop(b["id"], None)

    # ------------------------------------------------------------ 계산
    def run(self):
        nxt = time.perf_counter()
        while True:
            nxt += TICK
            try:
                with self.lock:
                    if self.players or self.senders:
                        self.step(TICK)
                        self.n += 1
                        if self.n % SEND_EVERY == 0:
                            self.broadcast()
            except Exception as e:     # 계산 오류로 아레나 전체가 멈추지 않게
                print("  ! 무한 아레나 오류:", repr(e))
            sl = nxt - time.perf_counter()
            if sl > 0:
                time.sleep(sl)
            else:
                nxt = time.perf_counter()

    def step(self, dt):
        self.t += dt
        self.fill_bots()
        if not self.players:
            return
        self.crate_timer -= dt
        if self.crate_timer <= 0:
            self.crate_timer = 1.5
            if len(self.crates) < CRATE_N:
                self.spawn_crate()
        for iid in list(self.items):
            it = self.items[iid]
            it["ttl"] -= dt
            if it["ttl"] <= 0:
                del self.items[iid]
        for p in list(self.players.values()):
            if p["dead"]:
                p["rt"] -= dt
                if p["rt"] <= 0:
                    p["x"], p["y"] = self.free_spot(PR, away=300)
                    p.update(dead=False, hp=MAX_HP, prot=PROTECT, cd=0.0, gun=None, ammo=0, use="knife", goal=None)
                continue
            if p["bot"]:
                p["think"] -= dt
                if p["think"] <= 0:
                    p["think"] = 0.15
                    self.bot_think(p)
            if p["prot"] > 0:
                p["prot"] -= dt
            if p["swing"] > 0:
                p["swing"] -= dt
            if p["cd"] > 0:
                p["cd"] -= dt
            mx, my = p["inp"]["mx"], p["inp"]["my"]
            ln = math.hypot(mx, my)
            if ln > 0.01:
                s = SPEED * dt / max(1.0, ln)
                nx, ny = p["x"] + mx * s, p["y"] + my * s
                if not self.blocked(nx, p["y"], PR):
                    p["x"] = nx
                if not self.blocked(p["x"], ny, PR):
                    p["y"] = ny
            if p["inp"]["f"] and p["cd"] <= 0:
                if p["prot"] > 0:
                    p["prot"] = 0      # 공격하면 무적이 풀린다
                self.fire(p)
            # 아이템 줍기 — 탄약·구급상자는 밟으면, 총은 빈손일 때만 자동 (총이 있으면 E)
            for iid, it in list(self.items.items()):
                if abs(it["x"] - p["x"]) > PICK_R or abs(it["y"] - p["y"]) > PICK_R:
                    continue
                if math.hypot(it["x"] - p["x"], it["y"] - p["y"]) > PICK_R:
                    continue
                if it["k"] == "ammo" and p["gun"] and p["ammo"] < WEAPONS[p["gun"]]["max"]:
                    p["ammo"] = min(WEAPONS[p["gun"]]["max"], p["ammo"] + WEAPONS[p["gun"]]["pick"])
                    if p["use"] == "knife" and not p["bot"]:
                        p["use"] = "gun"
                    del self.items[iid]
                elif it["k"] == "hp" and p["hp"] < MAX_HP:
                    p["hp"] = min(MAX_HP, p["hp"] + 35)
                    del self.items[iid]
                elif it["k"] == "gun" and (not p["gun"] or (p["bot"] and p["ammo"] <= 0)):
                    if p["gun"]:
                        self.drop("gun", p["x"], p["y"], p["gun"], p["ammo"])
                    p["gun"], p["ammo"], p["use"] = it["w"], it["a"], "gun"
                    del self.items[iid]
        self.step_bullets(dt)

    def step_bullets(self, dt):
        alive = []
        live = [q for q in self.players.values() if not q["dead"]]
        for b in self.bullets:
            b["life"] -= dt
            if b["life"] <= 0:
                if b["w"] == "bazooka":
                    self.explode(b["x"], b["y"], b["src"])
                continue
            dx, dy = b["vx"] * dt, b["vy"] * dt
            dist = math.hypot(dx, dy)
            mx, my = b["x"] + dx / 2, b["y"] + dy / 2
            near = [q for q in live if q["id"] != b["src"] and abs(q["x"] - mx) < dist / 2 + PR + 6 and abs(q["y"] - my) < dist / 2 + PR + 6]
            steps = max(1, int(math.ceil(dist / 12)))
            gone = False
            for i in range(1, steps + 1):
                x, y = b["x"] + dx * i / steps, b["y"] + dy * i / steps
                hitq = next((q for q in near if not q["dead"] and (q["x"] - x) ** 2 + (q["y"] - y) ** 2 < (PR + 3) ** 2), None)
                if hitq:
                    if b["w"] == "bazooka":
                        self.explode(x, y, b["src"])
                        self.damage(hitq, WEAPONS["bazooka"]["dmg"] * 0.4, self.players.get(b["src"]), "bazooka", x, y)
                    else:
                        self.damage(hitq, WEAPONS[b["w"]]["dmg"], self.players.get(b["src"]), b["w"], x, y)
                    gone = True
                    break
                if self.wall_at(x, y, 3):
                    if b["w"] == "bazooka":
                        self.explode(x, y, b["src"])
                    else:
                        self.fx.append(["spark", round(x), round(y)])
                    gone = True
                    break
                cid = self.crate_at(x, y, 3)
                if cid:
                    if b["w"] == "bazooka":
                        self.explode(x, y, b["src"])
                    else:
                        self.hit_crate(cid, WEAPONS[b["w"]]["dmg"])
                        self.fx.append(["spark", round(x), round(y)])
                    gone = True
                    break
            if gone:
                continue
            b["x"] += dx
            b["y"] += dy
            alive.append(b)
        self.bullets = alive

    # ------------------------------------------------------------ 전송
    def broadcast(self):
        ranked = sorted(self.players.values(), key=lambda p: (-p["kills"], p["deaths"], p["name"]))
        rk = [[p["id"], p["name"], p["kills"]] for p in ranked[:5]]
        rank_of = {p["id"]: i + 1 for i, p in enumerate(ranked)}
        fx, self.fx = self.fx, []
        total = len(self.players)
        for cid, sd in self.senders.items():
            p = self.players.get(cid)
            if not p:
                continue
            cx, cy = p["x"], p["y"]
            inv = lambda x, y, m=0: abs(x - cx) < VIEW_X + m and abs(y - cy) < VIEW_Y + m
            ps = [[q["id"], round(q["x"]), round(q["y"]), round(q["aim"], 2), round(q["hp"]), self.cur_weapon(q),
                   (1 if q["prot"] > 0 else 0) | (2 if q["swing"] > 0 else 0) | (4 if q["inp"]["mx"] or q["inp"]["my"] else 0),
                   q["name"], q["ch"]]
                  for q in self.players.values() if not q["dead"] and q is not p and inv(q["x"], q["y"])]
            bs = [[b["id"], round(b["x"]), round(b["y"]), round(b["vx"]), round(b["vy"]), b["w"]]
                  for b in self.bullets if inv(b["x"], b["y"], 200)]
            cs = [[k, round(c[0]), round(c[1]), round(c[2])] for k, c in self.crates.items() if inv(c[0], c[1], 60)]
            its = [[k, it["k"], it["w"] or "", round(it["x"]), round(it["y"])] for k, it in self.items.items() if inv(it["x"], it["y"], 60)]
            ev = [e for e in fx if e[0] == "kill" or inv(e[1], e[2], 100)]
            me = [round(p["x"], 1), round(p["y"], 1), round(p["hp"]), p["gun"] or "", p["ammo"], self.cur_weapon(p),
                  1 if p["dead"] else 0, round(max(0, p["rt"]), 1), p["kills"], p["deaths"], 1 if p["prot"] > 0 else 0,
                  p["by"], round(p["cd"], 2), p["ch"]]
            sd[1] = json.dumps({"t": "inf_s", "me": me, "p": ps, "b": bs, "c": cs, "i": its, "fx": ev,
                                "rk": rk, "mr": rank_of.get(cid, 0), "n": total}, ensure_ascii=False, separators=(",", ":"))
            sd[0].set()
