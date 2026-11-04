# 북한산 등산 메타버스 (MVP)

브라우저에서 북한산 백운대 코스를 걸어 올라가는 웹 3D 앱이다. 정상에 닿으면 인증 배지를 받고 기념사진을 저장할 수 있다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
```

| 입력 | 동작 |
|---|---|
| `W` 또는 `↑` | 앞으로 걷기 |
| `S` 또는 `↓` | 뒤로 걷기 |
| `A`/`D` 또는 `←`/`→` | 등산로 좌우 18m 안에서 옆으로 걷기 |
| `Shift` | 빨리 걷기 |
| `Space` | 점프 (걸으면서 누르면 앞으로 나아가며 뛴다) |
| 마우스 드래그 | 시점 회전 |
| 화면 오른쪽 아래 「걷기」 버튼 | 터치 화면에서 누르고 있는 동안 걷기 |
| 화면 오른쪽 아래 「점프」 버튼 | 터치 화면에서 점프 |
| 화면 왼쪽 아래 ◀ ▶ 버튼 | 터치 화면에서 옆으로 걷기 |

개발 모드에서는 주소에 값을 붙여 원하는 지점부터 확인할 수 있다. `?d=1700` 을 붙이면 출발점에서 1700m 떨어진 곳에서 시작하고, `?d=1790&photo` 를 붙이면 정상에 도착하자마자 기념사진까지 자동으로 찍는다.

## 구성

| 영역 | 사용 기술 |
|---|---|
| 3D | Three.js, React Three Fiber, drei |
| 상태 | zustand (`src/lib/store.ts`) |
| 지형 | AWS Terrain Tiles(Terrarium, 약 30m 해상도)로 만든 `public/data/terrain.bin` |
| 등산로 | OpenStreetMap 데이터로 만든 `public/data/trail.json` |
| 기록 | 지금은 `localStorage` 에 저장하고, 다음 단계에서 Supabase로 옮긴다 |

| 파일 | 하는 일 |
|---|---|
| `scripts/prepare-data.mjs` | 지형과 등산로 데이터를 만든다 (`npm run data`) |
| `src/lib/data.ts` | 데이터를 불러오고, 등산로 위 위치와 실제 소요 시간을 계산한다 |
| `src/scene/World.tsx` | 이동, 카메라, 정상 판정, 사진 촬영을 맡는다 |
| `src/scene/Terrain.tsx` | 지형 메시를 고도와 경사에 따라 칠한다 |
| `src/scene/Forest.tsx` | 나무를 `InstancedMesh` 로 심는다 |
| `src/scene/Hiker.tsx` | 도형으로 만든 임시 아바타다. GLB 캐릭터로 바꿀 예정이다 |
| `src/ui/Hud.tsx` | 코스 정보, 진행률, 정상 배지와 사진 창을 그린다 |

## 지형과 등산로 데이터

```bash
npm run data
```

원본 다운로드는 `scripts/raw/` 에 캐시하고 git에는 올리지 않는다. 이 폴더를 지우고 다시 실행하면 새로 받는다.

| 파일 | 내용 |
|---|---|
| `terrain.bin` | 높이 값(Float32, 북쪽 행부터) |
| `terrain.json` | 격자 크기와 로컬 좌표 범위 |
| `trail.json` | 등산로 점(로컬 미터 좌표), 길이, 누적 오르막 |

등산로를 찾을 때는 출입금지(`access=no`) 구간과 비법정탐방로, 암벽 구간을 빼고 정식 등산로를 먼저 고른다. 지금 코스는 백운대탐방지원센터에서 백운대까지 2.07km이고 누적 오르막은 544m다. 가는 길에 하루재, 인수암, 깔딱고개, 백운산장, 백운봉암문(위문) 이정표를 두는데, 좌표는 OpenStreetMap의 같은 이름 지점에서 가져와 등산로에서 40m 안에 있을 때만 쓴다.

## 데이터 출처

| 데이터 | 출처 | 비고 |
|---|---|---|
| 등산로 | © OpenStreetMap contributors | ODbL 라이선스라 화면 오른쪽 아래에 출처를 꼭 표시해야 한다 |
| 지형 | AWS Terrain Tiles | SRTM 같은 공개 DEM을 바탕으로 한다 |
