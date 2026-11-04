# 북한산 등산 메타버스 (MVP)

브라우저에서 북한산 백운대 코스를 걸어 올라가는 웹 3D 앱이다.

## 실행

```bash
npm install
npm run dev      # http://localhost:5173
```

## 지형과 등산로 데이터

```bash
npm run data
```

`scripts/prepare-data.mjs` 가 지형 타일과 등산로를 받아 `public/data/` 에 정적 파일로 만든다. 원본 다운로드는 `scripts/raw/` 에 캐시하고 git에는 올리지 않는다. 이 폴더를 지우고 다시 실행하면 새로 받는다.

| 파일 | 내용 |
|---|---|
| `terrain.bin` | 높이 값(Float32, 북쪽 행부터) |
| `terrain.json` | 격자 크기와 로컬 좌표 범위 |
| `trail.json` | 등산로 점(로컬 미터 좌표), 길이, 누적 오르막 |

등산로를 찾을 때는 출입금지(`access=no`) 구간과 비법정탐방로, 암벽 구간을 빼고 정식 등산로를 먼저 고른다. 지금 코스는 백운대탐방지원센터에서 백운대까지 1.79km이고 누적 오르막은 471m다.

## 데이터 출처

| 데이터 | 출처 | 비고 |
|---|---|---|
| 등산로 | © OpenStreetMap contributors | ODbL 라이선스라 화면에 출처를 꼭 표시해야 한다 |
| 지형 | AWS Terrain Tiles | SRTM 같은 공개 DEM을 바탕으로 한다 |
