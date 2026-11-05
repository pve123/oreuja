import { create } from 'zustand'

export type AvatarKind =
  | 'hiker'
  | 'uncle'
  | 'potato'
  | 'duck'
  | 'tofu'
  | 'mini-beard'
  | 'mini-girl'
  | 'mini-kid'
  | 'barbarian'
  | 'ranger'
  | 'knight'

/** 고를 수 있는 아바타 목록 (화면에 보이는 순서) */
export const AVATARS: { kind: AvatarKind; name: string; desc: string }[] = [
  { kind: 'hiker', name: '기본 등산객', desc: '빨간 점퍼의 평범한 등산객이에요' },
  { kind: 'uncle', name: '형광 아저씨', desc: '썬캡에 형광 점퍼, 콧수염은 덤이에요' },
  { kind: 'potato', name: '감자', desc: '싹 난 감자가 정상까지 굴러가요' },
  { kind: 'duck', name: '오리', desc: '뒤뚱뒤뚱, 배낭 멘 오리예요' },
  { kind: 'tofu', name: '두부', desc: '말랑한 두부가 국수 다리로 걸어요' },
  { kind: 'mini-beard', name: '꼬마 수염 아저씨', desc: '네모난 수염 아저씨가 종종걸음으로 올라요' },
  { kind: 'mini-girl', name: '꼬마 등산객', desc: '머리 질끈 묶은 꼬마 등산객이에요' },
  { kind: 'mini-kid', name: '꼬마 개구쟁이', desc: '정상까지 뛰어가고 싶은 개구쟁이예요' },
  { kind: 'barbarian', name: '곰탈 전사', desc: '곰 가죽 모자 하나 쓰고 맨몸으로 올라요' },
  { kind: 'ranger', name: '숲지기', desc: '초록 망토에 화살통을 멘 숲지기예요' },
  { kind: 'knight', name: '갑옷 기사', desc: '투구에 갑옷까지, 무거워도 정상은 가요' },
]

/**
 * GLB 모델로 그리는 캐릭터 (public/models/avatars, 둘 다 CC0).
 * 파일은 scripts/prepare-avatars.mjs 로 준비한다. 여기 없는 캐릭터는 Hiker.tsx 가 도형으로 그린다.
 * clips 는 쉬기·걷기·공중·만세 때 틀 동작 이름이다.
 */
export type AvatarModel = {
  url: string
  /** 동작이 캐릭터 파일 밖에 따로 있으면 그 파일 */
  animUrl?: string
  clips: { idle: string; walk: string; air: string; cheer: string }
}

const KENNEY_CLIPS = { idle: 'idle', walk: 'walk', air: 'fall', cheer: 'emote-yes' }
const KAYKIT_ANIMS = '/models/avatars/kaykit/animations.glb'
const KAYKIT_CLIPS = { idle: 'Idle_A', walk: 'Walking_A', air: 'Jump_Idle', cheer: 'Jump_Full_Short' }

export const AVATAR_MODELS: Partial<Record<AvatarKind, AvatarModel>> = {
  'mini-beard': { url: '/models/avatars/kenney/character-male-b.glb', clips: KENNEY_CLIPS },
  'mini-girl': { url: '/models/avatars/kenney/character-female-b.glb', clips: KENNEY_CLIPS },
  'mini-kid': { url: '/models/avatars/kenney/character-male-e.glb', clips: KENNEY_CLIPS },
  barbarian: { url: '/models/avatars/kaykit/Barbarian.glb', animUrl: KAYKIT_ANIMS, clips: KAYKIT_CLIPS },
  ranger: { url: '/models/avatars/kaykit/Ranger.glb', animUrl: KAYKIT_ANIMS, clips: KAYKIT_CLIPS },
  knight: { url: '/models/avatars/kaykit/Knight.glb', animUrl: KAYKIT_ANIMS, clips: KAYKIT_CLIPS },
}

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
