---
description: 봇전 방장의 [봇 만들기] 요청을 기다렸다가, 오면 바로 그 방만 /봇생성 (방어 모드)으로 변환한다. 수업 동안 켜 둔다
---

수업 동안 이 창을 열어 두고 방장들의 요청을 처리한다. 방장이 [봇 만들기]를 누르면 서버가
`rooms/<방폴더>/request.json` 을 만든다. 이것을 **Monitor 도구**로 지켜보다가 오는 즉시 처리한다.

## 1. 감시 켜기

Monitor 도구로 이 폴더(프로젝트 루트)에서 아래 명령을 실행한다 (timeout 은 최대값).
같은 요청을 두 번 알리지 않도록 찾은 파일은 `request.taken` 으로 이름을 바꾼다.

```bash
while true; do
  for f in rooms/*/request.json; do
    [ -f "$f" ] || continue
    d=$(dirname "$f"); case "$d" in *_지난방*) continue;; esac
    mv "$f" "$d/request.taken" && echo "REQUEST $(basename "$d")"
  done
  sleep 2
done
```

감시를 켰으면 "봇 만들기 요청을 기다리는 중" 이라고 한 줄만 말하고 기다린다.

## 2. 요청이 오면 (`REQUEST <방폴더>` 알림)

1. `rooms/<방폴더>/status.json` 에 `{"state":"변환 중","total":<그 방 submissions 수>,"done":0}` 를 쓴다.
2. 그 방만 `/봇생성 --room <방폴더>` 의 절차대로 처리한다. **항상 방어 모드(보안 규칙 적용)** 로 한다.
   `--무방비` 로는 절대 처리하지 않는다 — 공격 라운드는 선생님이 이 창에 직접 입력한다.
3. 끝나면 `rooms/<방폴더>/status.json` 에
   `{"state":"완료","time":"<HH:MM:SS>","bots":<그 방 bots/*.json 수>,"note":"[의심] N명"}` 를 쓴다
   (`[의심]` 이 없으면 note 는 빈 문자열). 처리 중 오류가 나면 `{"state":"실패","note":"<짧은 이유>"}`.
4. `rooms/<방폴더>/request.taken` 을 지운다.
5. 처리 결과를 `/봇생성` 과 같은 표로 짧게 보여 주고 다시 기다린다.

## 3. 유지 · 멈춤

- Monitor 는 최대 30분이면 끝난다. 끝났다는 알림이 오면 **같은 명령으로 다시 켠다.**
- 여러 방 요청이 한꺼번에 오면 방마다 차례로 처리한다 (방끼리 파일이 섞이지 않게 각 방 폴더 안에서만).
- 선생님이 "대기 멈춰" 라고 하면 Monitor 를 멈추고 끝낸다.
