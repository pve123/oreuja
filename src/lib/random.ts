/** 같은 시드면 같은 수열을 내는 난수 (숲·바위 배치가 매번 같게) */
export function seededRandom(seed: number) {
  const state = { seed }
  return () => {
    state.seed = (state.seed * 16807) % 2147483647
    return (state.seed - 1) / 2147483646
  }
}
