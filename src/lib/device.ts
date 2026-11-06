/**
 * 터치 기기인지. 마우스가 없고 손가락으로 누르는 화면이면 true (폰·태블릿).
 * CSS 의 @media (hover: hover) and (pointer: fine) 과 같은 기준이라 화면 버튼과 품질 설정이 같이 바뀐다
 */
export const IS_TOUCH = typeof matchMedia === 'function' && !matchMedia('(hover: hover) and (pointer: fine)').matches
