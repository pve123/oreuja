import { useEffect, useState } from 'react'
import { shareInvite } from '../lib/invite'
import type { Trail } from '../lib/data'

/** 「복사했어요」 같은 결과 문구를 보여 주는 시간(ms) */
const RESULT_MS = 2200

/**
 * 친구 부르기 버튼. 지금 코스로 바로 들어오는 링크를 공유창으로 보내거나 복사한다.
 * className 으로 자리마다 모양을 바꾼다 (폰 같이하기 시트는 큰 버튼, 컴퓨터 같이하기 패널은 글자 버튼)
 */
export function InviteButton({ trail, className }: { trail: Trail; className: string }) {
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    if (!result) return
    const t = setTimeout(() => setResult(null), RESULT_MS)
    return () => clearTimeout(t)
  }, [result])

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        const how = await shareInvite(trail.data)
        if (how === 'copied') setResult('링크를 복사했어요')
        else if (how === 'failed') setResult('복사하지 못했어요')
      }}
    >
      <span aria-live="polite">{result ?? '🔗 친구 부르기'}</span>
    </button>
  )
}
