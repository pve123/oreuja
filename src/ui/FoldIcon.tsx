/** 접기·펼치기 화살표. 펼치면 아래, 접으면 CSS 가 돌려 오른쪽을 본다 (코스·캐릭터 패널, 베이스캠프 설정) */
export function FoldIcon() {
  return (
    <svg className="fold-icon" width="14" height="14" viewBox="0 0 14 14" aria-hidden>
      <path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
