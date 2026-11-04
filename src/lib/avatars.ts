import { create } from 'zustand'

export type AvatarKind = 'hiker' | 'uncle' | 'potato' | 'duck' | 'tofu'

/** 고를 수 있는 아바타 목록 (화면에 보이는 순서) */
export const AVATARS: { kind: AvatarKind; name: string; desc: string }[] = [
  { kind: 'hiker', name: '기본 등산객', desc: '빨간 점퍼의 평범한 등산객이에요' },
  { kind: 'uncle', name: '형광 아저씨', desc: '썬캡에 형광 점퍼, 콧수염은 덤이에요' },
  { kind: 'potato', name: '감자', desc: '싹 난 감자가 정상까지 굴러가요' },
  { kind: 'duck', name: '오리', desc: '뒤뚱뒤뚱, 배낭 멘 오리예요' },
  { kind: 'tofu', name: '두부', desc: '말랑한 두부가 국수 다리로 걸어요' },
]

const AVATAR_KEY = 'hiking-metaverse:avatar'

export function loadAvatar(): AvatarKind {
  try {
    const saved = localStorage.getItem(AVATAR_KEY)
    if (AVATARS.some((a) => a.kind === saved)) return saved as AvatarKind
  } catch {
    // 저장소를 못 쓰는 환경이면 기본값
  }
  return 'hiker'
}

export function saveAvatar(kind: AvatarKind) {
  try {
    localStorage.setItem(AVATAR_KEY, kind)
  } catch {
    // 저장소를 못 쓰는 환경이면 무시
  }
}

/** 캐릭터별 모습 그림(데이터 URL). AvatarThumbnails 가 앱이 뜰 때 한 번 찍어 채운다 */
export const useAvatarThumbs = create<{ thumbs: Partial<Record<AvatarKind, string>>; done: boolean }>(() => ({
  thumbs: {},
  done: false,
}))
