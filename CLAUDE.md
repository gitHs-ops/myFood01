# CLAUDE.md — myFood01

온반(溫飯) "오늘의 반찬" 반찬 주문 서비스. 고객 페이지(onban01.html) · 관리자 페이지(menu-manager.html) · 이미지 갤러리(온반_메뉴_이미지갤러리.html) + 백엔드(server/server.js, Express+MySQL, Railway 호스팅).

## LLM 위키 (외부 통합 vault, domain: onban)
이 프로젝트에 대한 지식 위키는 `C:\Users\user\vaults\llm-wiki\`(이 저장소 밖, 별도 git 저장소)에 domain `onban`으로 들어있다 — 이 프로젝트 자체에는 vault를 두지 않는다(2026-08-26 이전엔 `vaults/onban/`에 있었으나, 프로젝트별 분리보다 하나의 통합 vault로 모으기로 하고 이전함 — 개인 조사 내용이 이 저장소의 GitHub 원격에 같이 올라가는 걸 피하기 위함이기도 함). 진입점은 `C:\Users\user\vaults\llm-wiki\wiki\index.md`, vault 컨벤션은 그 vault의 `CLAUDE.md` 참고.

**작업을 마칠 때마다 다음에 해당하면 llm-wiki(domain: onban) 반영을 검토할 것** (사용자가 매번 요청하지 않아도):
- 코드 동작이 바뀌었는데 그 동작이 이미 위키/매뉴얼에 문서화되어 있던 경우 (예: 저장 방식, API, 판별 로직 변경) → 관련 wiki 페이지 갱신
- 문서(매뉴얼·상세설계서)와 실제 코드가 어긋난 걸 발견한 경우 → 원본 문서 수정 여부는 사용자에게 확인하되, 위키에는 "코드가 최신"임을 반드시 기록
- 새로운 기능·화면·API가 추가된 경우 → 해당 entity/concept 페이지 생성 또는 기존 페이지에 추가
- 죽은 코드·미해결 이슈를 발견/해결한 경우 → onban-backend-api 또는 관련 페이지에 기록

사소한 오탈자·스타일 수정, 위키에 이미 안 다뤄지는 내부 리팩터링은 대상 아님 — 과잉 반영으로 위키를 어지럽히지 말 것.

갱신 후에는 llm-wiki의 `log.md`에 한 줄 기록하고 그 vault(별도 git 저장소, 로컬 전용·원격 없음)에서 커밋. myFood01 쪽 코드 변경은 이 저장소에서 별도로 커밋(로컬 커밋은 확인 없이 진행, push는 사용자 확인 후).
