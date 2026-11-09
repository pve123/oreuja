/**
 * 터치 기기인지. 마우스가 없고 손가락으로 누르는 화면이면 true (폰·태블릿).
 * CSS 의 @media (hover: hover) and (pointer: fine) 과 같은 기준이라 화면 버튼과 품질 설정이 같이 바뀐다
 */
export const IS_TOUCH = typeof matchMedia === 'function' && !matchMedia('(hover: hover) and (pointer: fine)').matches

/**
 * 아이폰·아이패드인지. 아이폰 사파리는 웹에서 받은 파일을 사진 앱이 아니라 파일 앱에 넣어서, 기념사진 저장은 공유 창의 「이미지 저장」으로 보낸다.
 * 아이패드는 컴퓨터용 사파리처럼 Mac 으로 알려서 터치 지점 수로 가린다
 */
export const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
