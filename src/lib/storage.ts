/**
 * 브라우저 저장소 읽기·쓰기. 사생활 보호 창이나 저장소를 막은 환경에서는 접근만 해도 오류가 나서, 실패하면 조용히 넘어간다.
 * 'session' 을 주면 탭을 닫을 때 지워지는 sessionStorage 를 쓴다
 */
type Area = 'local' | 'session'
const storageOf = (where: Area) => (where === 'session' ? sessionStorage : localStorage)

/** 저장된 값. 없거나 저장소를 못 쓰면 null */
export function readStored(key: string, where: Area = 'local'): string | null {
  try {
    return storageOf(where).getItem(key)
  } catch {
    return null
  }
}

/** 값을 저장한다. 저장소를 못 쓰면 false (이번 접속에만 쓰고 기억하지 않는다) */
export function writeStored(key: string, value: string, where: Area = 'local'): boolean {
  try {
    storageOf(where).setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** 값을 지운다 */
export function removeStored(key: string, where: Area = 'local') {
  try {
    storageOf(where).removeItem(key)
  } catch {
    // 저장소를 못 쓰면 지울 것도 없다
  }
}
