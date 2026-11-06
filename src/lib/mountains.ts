/**
 * 산 목록과 고른 산. 산마다 지형 한 장과 코스들이 public/data/<산 id>/ 에 따로 있다 (scripts/prepare-data.mjs).
 * 고른 산은 브라우저에 기억해 두고, 첫 화면(index.html)이 JS 를 받기 전에 읽어 그 산의 데이터를 미리 받는다.
 */

export type Mountain = {
  id: string
  name: string
  /** 가장 높은 봉우리 해발(m). 첫 화면에서 진행만큼 고도가 올라가는 데 쓴다 */
  elevation: number
  /** 코스 수 */
  courses: number
}

/** index.html 의 첫 화면 스크립트도 이 키를 읽는다. 바꾸면 거기도 같이 바꾼다 */
const MOUNTAIN_KEY = 'hiking-metaverse:mountain'
export const DEFAULT_MOUNTAIN: Mountain = { id: 'bukhansan', name: '북한산', elevation: 836, courses: 4 }

/** 기억해 둔 산. 없거나 읽지 못하면 북한산 */
export function loadMountain(): Mountain {
  try {
    const saved = JSON.parse(localStorage.getItem(MOUNTAIN_KEY) ?? 'null')
    if (saved && /^[a-z0-9-]+$/.test(saved.id) && typeof saved.name === 'string' && saved.elevation > 0) return saved
  } catch {
    // 저장소를 못 쓰거나 값이 깨졌으면 기본값
  }
  return DEFAULT_MOUNTAIN
}

/** 산을 바꾼다. 지형·물리·코스가 모두 바뀌므로 페이지를 새로 불러 첫 화면부터 다시 그린다 */
export function switchMountain(m: Mountain) {
  try {
    localStorage.setItem(MOUNTAIN_KEY, JSON.stringify(m))
  } catch {
    // 저장소를 못 쓰는 환경이면 바꿀 수 없다 (새로 불러도 기본 산이 뜬다)
    return
  }
  location.reload()
}

export async function loadMountains(): Promise<Mountain[]> {
  const r = await fetch('/data/mountains.json')
  if (!r.ok) throw new Error(`/data/mountains.json 을 받지 못했다 (${r.status})`)
  return r.json()
}
