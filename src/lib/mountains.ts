import type { TrailData } from './data'
import { readStored, writeStored } from './storage'
import { AUTOSTART_STORAGE_KEY, saveCourse } from './store'

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
    const saved = JSON.parse(readStored(MOUNTAIN_KEY) ?? 'null')
    if (saved && /^[a-z0-9-]+$/.test(saved.id) && typeof saved.name === 'string' && saved.elevation > 0) return saved
  } catch {
    // 값이 깨졌으면 기본값
  }
  return DEFAULT_MOUNTAIN
}

/**
 * 산을 바꾼다. 지형·물리·코스가 모두 바뀌므로 페이지를 새로 불러 첫 화면부터 다시 그린다.
 * courseId 를 주면 그 코스를 고른 채로 연다. autostart 면 베이스캠프를 건너뛰고 바로 출발한다
 * (친구 부르기 링크로 온 사람은 캐릭터를 고를 수 있게 베이스캠프에서 시작한다).
 */
export function switchMountain(mountain: Mountain, courseId?: string, autostart = true) {
  // 저장소를 못 쓰는 환경이면 바꿀 수 없다 (새로 불러도 기본 산이 뜬다)
  if (!writeStored(MOUNTAIN_KEY, JSON.stringify(mountain))) return
  if (courseId) {
    saveCourse(courseId)
    if (autostart) writeStored(AUTOSTART_STORAGE_KEY, '1', 'session')
  }
  location.reload()
}

/** 코스 id 는 「산 id-코스」 꼴이다 (예: bukhansan-baegundae). 앞부분이 산 id */
export const mountainOf = (courseId: string) => courseId.split('-')[0]

/** 고를 수 있는 산 목록 */
export async function loadMountains(): Promise<Mountain[]> {
  const res = await fetch('/data/mountains.json')
  if (!res.ok) throw new Error(`/data/mountains.json 을 받지 못했다 (${res.status})`)
  return res.json()
}

const coursesCache = new Map<string, Promise<TrailData[]>>()

/**
 * 다른 산의 코스 목록만 받는다. 베이스캠프에서 코스 카드를 미리 보여 줄 때 쓰고, 지형은 받지 않는다.
 * 한 번 받은 것은 기억해 두고, 받지 못했으면 지워서 다음에 다시 받게 한다
 */
export function loadCourses(mountainId: string): Promise<TrailData[]> {
  let pending = coursesCache.get(mountainId)
  if (!pending) {
    pending = fetch(`/data/${mountainId}/courses.json`).then((res) => {
      if (!res.ok) throw new Error(`/data/${mountainId}/courses.json 을 받지 못했다 (${res.status})`)
      return res.json() as Promise<TrailData[]>
    })
    pending.catch(() => coursesCache.delete(mountainId))
    coursesCache.set(mountainId, pending)
  }
  return pending
}
