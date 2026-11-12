/**
 * 같은 시드면 늘 같은 수열을 내는 난수. 숲·바위가 매번 같은 자리에 놓이게 한다.
 * 곱하는 수 16807 과 나누는 수 2147483647(2^31 - 1)은 파크-밀러 난수 생성기의 값이다
 */
export function seededRandom(seed: number) {
  let current = seed
  return () => {
    current = (current * 16807) % 2147483647
    return (current - 1) / 2147483646
  }
}
