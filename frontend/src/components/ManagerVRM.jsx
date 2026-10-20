// VRoid(VRM) 감독 3D: 팔을 내린 대기 자세, 숨쉬기·눈 깜빡임·카메라 바라보기, 손 흔들기, 끌어서 회전, 썸네일
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'

const ManagerVRM = forwardRef(function ManagerVRM({ buffer, teamColor = '#7c5cff', height = 380, framing = 'full' }, ref) {
  const wrap = useRef(null)
  const st = useRef({})
  const [err, setErr] = useState('')

  useEffect(() => {
    const el = wrap.current
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x334, 1.4))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(1.5, 2.5, 2.5)
    scene.add(key)
    const rim = new THREE.DirectionalLight(new THREE.Color(teamColor), 1.6)
    rim.position.set(-2, 2, -2.5)
    scene.add(rim)
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 40), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28 }))
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = 0.002
    scene.add(shadow)
    const clock = new THREE.Clock()
    const s = st.current
    Object.assign(s, { renderer, scene, camera, rim, yaw: 0, drag: null, t: 0, wave: 0 })
    const resize = () => {
      const w = el.clientWidth || 300
      renderer.setSize(w, height)
      camera.aspect = w / height
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    let raf
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const dt = clock.getDelta()
      s.t += dt
      const v = s.vrm
      if (v) {
        v.scene.rotation.y += ((s.baseYaw || 0) + s.yaw - v.scene.rotation.y) * 0.15
        pose(v, s)
        v.update(dt)
      }
      renderer.render(scene, camera)
    }
    loop()
    const down = (e) => { s.drag = { x: e.clientX, yaw: s.yaw } }
    const move = (e) => { if (s.drag) s.yaw = s.drag.yaw + (e.clientX - s.drag.x) * 0.012 }
    const up = () => { s.drag = null }
    renderer.domElement.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [])

  // VRM 불러오기
  useEffect(() => {
    if (!buffer) return
    const s = st.current
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    setErr('')
    loader.parse(buffer, '', (gltf) => {
      const vrm = gltf.userData.vrm
      if (!vrm) { setErr('VRM 파일이 아닙니다. VRoid Studio에서 "VRM 내보내기"로 만든 파일을 올려 주세요.'); return }
      VRMUtils.removeUnnecessaryVertices(gltf.scene)
      VRMUtils.combineSkeletons?.(gltf.scene)
      if (s.vrm) { s.scene.remove(s.vrm.scene); VRMUtils.deepDispose(s.vrm.scene) }
      vrm.scene.traverse((o) => { o.frustumCulled = false })
      s.scene.add(vrm.scene)
      s.vrm = vrm
      // VRM 0.x는 뒤(-Z)를 보고 있어 180도 돌린다. VRM 1.0은 원래 카메라(+Z) 쪽
      s.baseYaw = vrm.meta?.metaVersion === '0' ? Math.PI : 0
      vrm.scene.rotation.y = s.baseYaw
      if (vrm.lookAt) vrm.lookAt.target = s.camera
      pose(vrm, s)
      vrm.update(0)
      frame(s, framing)
    }, (e) => setErr(`파일을 읽지 못했습니다: ${e.message || e}`))
  }, [buffer])

  useEffect(() => { if (st.current.vrm) frame(st.current, framing) }, [framing])
  useEffect(() => { if (st.current.rim) st.current.rim.color = new THREE.Color(teamColor) }, [teamColor])

  useImperativeHandle(ref, () => ({
    wave() { st.current.wave = 2.4 },
    turn(d) { st.current.yaw += d },
    capture(px = 160) {
      const s = st.current
      if (!s.vrm) return null
      const { renderer, camera } = s
      const prev = { w: renderer.domElement.width / renderer.getPixelRatio(), h: renderer.domElement.height / renderer.getPixelRatio(), aspect: camera.aspect, yaw: s.yaw }
      s.yaw = 0
      s.vrm.scene.rotation.y = s.baseYaw || 0
      renderer.setSize(px, px, false)
      camera.aspect = 1
      frame(s, 'face')
      renderer.render(s.scene, camera)
      const url = renderer.domElement.toDataURL('image/png')
      renderer.setSize(prev.w, prev.h)
      camera.aspect = prev.aspect
      s.yaw = prev.yaw
      frame(s, framing)
      return url
    },
  }))

  return (
    <div className="mgr3d" style={{ height, '--c': teamColor }} ref={wrap}>
      {err && <p className="vrm-err">{err}</p>}
    </div>
  )
})

// 대기 자세: T포즈에서 팔을 내리고, 숨쉬기·눈 깜빡임, 손 흔들기
function pose(vrm, s) {
  const h = vrm.humanoid
  if (!h) return
  const bone = (n) => h.getNormalizedBoneNode(n)
  const t = s.t
  const breathe = Math.sin(t * 1.6) * 0.02
  const set = (n, x = 0, y = 0, z = 0) => { const b = bone(n); if (b) b.rotation.set(x, y, z) }
  set('spine', breathe, 0, 0)
  set('chest', breathe * 0.6, 0, 0)
  set('neck', -breathe * 0.5, Math.sin(t * 0.5) * 0.06, 0)
  // 정규화 뼈대 기준(정면 +Z): 왼팔은 +X로 뻗어 있으므로 z를 음수로 돌려 내리고, 오른팔은 반대
  set('leftUpperArm', 0, 0, -1.2)
  set('leftLowerArm', 0, 0.2, -0.1)
  set('leftHand', 0, 0, -0.1)
  if (s.wave > 0) {
    s.wave -= 1 / 60
    const w = Math.sin(t * 9) * 0.3
    set('rightUpperArm', 0, 0, -0.25) // 어깨 높이보다 살짝 위로
    set('rightLowerArm', 0, 0, -1.3 + w) // 팔꿈치를 세워 손을 흔든다
    set('rightHand', 0, 0, 0)
  } else {
    set('rightUpperArm', 0, 0, 1.2)
    set('rightLowerArm', 0, -0.2, 0.1)
    set('rightHand', 0, 0, 0.1)
  }
  // 눈 깜빡임 (4초마다)
  const em = vrm.expressionManager
  if (em) {
    const phase = t % 4
    em.setValue('blink', phase < 0.12 ? Math.sin((phase / 0.12) * Math.PI) : 0)
  }
}

// 구도: 전신·상반신·얼굴(썸네일)
function frame(s, mode) {
  const head = s.vrm.humanoid?.getNormalizedBoneNode('head')
  const hp = new THREE.Vector3()
  head?.getWorldPosition(hp)
  const top = hp.y + 0.15
  const cy = mode === 'full' ? top * 0.52 : mode === 'bust' ? top - 0.32 : hp.y + 0.03
  const span = mode === 'full' ? top * 1.12 : mode === 'bust' ? 0.75 : 0.36
  const dist = span / 2 / Math.tan(THREE.MathUtils.degToRad(s.camera.fov / 2))
  s.camera.position.set(0, cy + 0.02, dist)
  s.camera.lookAt(0, cy, 0)
}

export default ManagerVRM
