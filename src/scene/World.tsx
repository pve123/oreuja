import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Sky } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Terrain as TerrainData, Trail } from '../lib/data'
import { Terrain } from './Terrain'
import { TrailPath } from './TrailPath'
import { Forest } from './Forest'

const SUN = new THREE.Vector3(-0.5, 0.55, 0.65).normalize() // 남서쪽 하늘의 해

type Props = { terrain: TerrainData; trail: Trail }

/** 하늘 상자가 카메라를 따라다니게 해서 높은 곳에서도 하늘이 보이게 한다 */
function SkyDome() {
  const group = useRef<THREE.Group>(null!)
  useFrame(({ camera }) => group.current.position.copy(camera.position))
  return (
    <group ref={group}>
      <Sky distance={5000} sunPosition={SUN.toArray()} turbidity={6} rayleigh={1.2} />
    </group>
  )
}

export function World({ terrain, trail }: Props) {
  const controls = useRef<OrbitControlsImpl>(null!)
  const sun = useRef<THREE.DirectionalLight>(null!)
  const camera = useThree((s) => s.camera)

  // 처음 카메라 위치: 출발점 뒤쪽 위
  useEffect(() => {
    const start = trail.positionAt(0)
    const h = trail.headingAt(0)
    camera.position.set(start.x - Math.sin(h) * 18, start.y + 9, start.z - Math.cos(h) * 18)
    controls.current.target.copy(start).setY(start.y + 1.5)
    controls.current.update()

    // 그림자가 출발점 주변에서 선명하도록 태양을 옮김
    sun.current.position.copy(start).addScaledVector(SUN, 300)
    sun.current.target.position.copy(start)
    sun.current.target.updateMatrixWorld()
  }, [camera, trail])

  return (
    <>
      <SkyDome />
      <fog attach="fog" args={['#c9d6e3', 800, 6000]} />
      <hemisphereLight args={['#dfefff', '#4a5d3a', 0.6]} />
      <directionalLight
        ref={sun}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-camera-far={800}
        shadow-bias={-0.0005}
      />
      <Terrain terrain={terrain} />
      <Forest terrain={terrain} trail={trail} />
      <TrailPath trail={trail} />
      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        minDistance={4}
        maxDistance={400}
        maxPolarAngle={Math.PI * 0.49}
      />
    </>
  )
}
