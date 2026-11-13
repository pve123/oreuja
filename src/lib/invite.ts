import type { TrailData } from './data'
import { IS_TOUCH } from './device'

/**
 * 친구 부르기: 지금 코스로 바로 들어오는 링크(예: https://www.oreuja.com/?c=bukhansan-baegundae)를 공유하고,
 * 그 링크로 들어온 사람은 베이스캠프에서 그 산과 코스가 골라진 채로 시작한다 (src/App.tsx).
 * 코스 id 는 「산 id-코스」 꼴이라 앞부분으로 산을 안다.
 */

/** 링크에 코스를 싣는 주소 이름. 짧게 둔다 */
const PARAM = 'c'
const COURSE_ID = /^[a-z0-9]+-[a-z0-9-]+$/

/** 이 코스로 들어오는 링크 */
export function inviteUrl(courseId: string) {
  const url = new URL('/', location.origin)
  url.searchParams.set(PARAM, courseId)
  return url.toString()
}

/** 초대 코스 id 에서 산 id */
export const mountainOf = (courseId: string) => courseId.split('-')[0]

/**
 * 주소에 실려 온 초대 코스를 꺼내고 주소에서 지운다. 새로 고치거나 산을 바꿔 다시 불러도 또 적용되지 않게 한다.
 * 형식이 맞지 않으면 null
 */
export function takeInvitedCourse(): string | null {
  const url = new URL(location.href)
  const course = url.searchParams.get(PARAM)
  if (course === null) return null
  url.searchParams.delete(PARAM)
  history.replaceState(history.state, '', url.pathname + url.search + url.hash)
  return COURSE_ID.test(course) ? course : null
}

/**
 * 친구에게 링크를 보낸다. 폰·태블릿은 공유창(카카오톡 등)을 열고, 컴퓨터나 공유창이 없는 브라우저는 링크를 복사한다.
 * 컴퓨터 크롬·사파리에도 공유창이 있지만 메신저로 이어지지 않아 복사가 더 쓸모 있다. 공유창을 닫은 것은 실패로 치지 않는다
 */
export async function shareInvite(course: TrailData): Promise<'shared' | 'copied' | 'failed'> {
  const url = inviteUrl(course.id)
  const text = `${course.mountain} ${course.name} 같이 오르자! ⛰️`
  if (IS_TOUCH && navigator.share) {
    try {
      await navigator.share({ title: '오르자', text, url })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'shared'
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`)
    return 'copied'
  } catch {
    return 'failed'
  }
}
