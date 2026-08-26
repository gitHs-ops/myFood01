# onban vault

myFood01 프로젝트("온반/오늘의 반찬" 반찬 주문 서비스)의 매뉴얼·설계 지식을 모으는 개인 지식 wiki. `/ingest`로 이 프로젝트의 문서를 처리할 때 기본 vault로 사용.

## 기본 domain 태그
`onban`

## 컨벤션
- 서비스 자체를 가리키는 entity 페이지는 `onban-service.md`로 통일 (별칭: "오늘의 반찬", "온반(溫飯)")
- 매뉴얼류 source-note는 `<페이지영역>-manual.md` 형식 (예: onban-admin-manual, onban-customer-manual). 같은 문서의 구버전이 있으면 `-v1`, `-v2` 접미사로 구분하고 최신 문서에서 `related`로 상호 링크
- 이 vault는 myFood01 앱 코드와 같은 git 저장소 안에 있음 — 매뉴얼 문서(HTML 원본)와 실제 코드 동작이 어긋나는 경우가 있으므로, 위키에 "현재 동작"을 적을 때는 가능하면 코드를 직접 대조하고 시점을 명시할 것 (예: [[realtime-autosave]] 사례)
- raw/ 밑에는 원본 HTML을 그대로 복사하지 않고, 읽기 쉬운 마크다운으로 정리해서 저장한다(스타일/스크립트 코드는 제외, 표·목록·팁박스 내용은 보존)
