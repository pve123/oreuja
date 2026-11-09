import { useEffect } from 'react'

/**
 * on 인 동안 화면이 저절로 꺼지지 않게 한다 (Screen Wake Lock API). 조이스틱을 놓고 풍경을 보는 사이 폰 화면이 꺼지지 않게 한다.
 * 다른 앱으로 갔다 오면 브라우저가 잠금을 풀어 버리므로 화면이 다시 보일 때 새로 건다. 지원하지 않는 브라우저에서는 아무것도 하지 않는다
 */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !('wakeLock' in navigator)) return
    const state = { lock: null as WakeLockSentinel | null, done: false }
    const request = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        .request('screen')
        .then((lock) => {
          if (state.done) void lock.release()
          else state.lock = lock
        })
        .catch(() => {
          // 배터리 절약 모드 등으로 거절되면 그냥 둔다
        })
    }
    request()
    document.addEventListener('visibilitychange', request)
    return () => {
      state.done = true
      document.removeEventListener('visibilitychange', request)
      void state.lock?.release()
    }
  }, [on])
}
