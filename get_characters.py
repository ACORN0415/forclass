#!/usr/bin/env python3
"""
crazy 저장소(ACORN0415/crazy)의 캐릭터 그림을 이 폴더의 characters/ 로 복사합니다.
  python 캐릭터_가져오기.py                  (git 으로 받아서 복사)
  python 캐릭터_가져오기.py <crazy 폴더 경로>  (이미 받아둔 저장소에서 복사)
git 이 없으면 저장소를 zip 으로 받아 풀고 두 번째 방법을 쓰세요.
"""
import os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DST = os.path.join(HERE, "characters")
IDS = ["dao", "bazzi", "marid", "su", "kephi", "mos", "dizni", "uni", "ethi"]

def copy_from(repo):
    src = os.path.join(repo, "web", "public", "characters")
    if not os.path.isdir(src):
        sys.exit("characters 폴더를 찾지 못했습니다: " + src)
    os.makedirs(DST, exist_ok=True)
    n = 0
    for cid in IDS:
        s = os.path.join(src, cid)
        if os.path.isdir(s):
            d = os.path.join(DST, cid)
            if os.path.isdir(d):
                shutil.rmtree(d)
            shutil.copytree(s, d)
            n += 1
            print("  +", cid)
    print(f"완료: {n}개 캐릭터 → {DST}")
    print("arena_server.py 를 다시 켜고 새로고침하면 반영됩니다.")

if len(sys.argv) > 1:
    copy_from(sys.argv[1])
else:
    tmp = tempfile.mkdtemp()
    print("저장소 받는 중…")
    r = subprocess.run(["git", "clone", "--depth", "1", "https://github.com/ACORN0415/crazy.git", tmp])
    if r.returncode != 0:
        sys.exit("git clone 실패. 저장소를 직접 받은 뒤:  python 캐릭터_가져오기.py <폴더경로>")
    copy_from(tmp)
    shutil.rmtree(tmp, ignore_errors=True)
