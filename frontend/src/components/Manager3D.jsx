// 3D 감독 (three.js): Quaternius 모듈형 캐릭터(CC0)에 의상·헤어·피부색·수염·안경·체형을 입힌다
// - 의상(몸통·다리·신발)은 고른 모델에서, 머리(헤어)는 다른 모델의 머리를 같은 뼈대에 붙여 섞는다
// - 수염·안경은 얼굴 크기에 맞춰 만든 3D 도형을 머리 뼈에 붙여 애니메이션을 따라가게 한다
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { DEFAULT_LOOK_3D } from './managerLook.js'
export * from './managerLook.js'

const cache = {}
const loadModel = (key) => (cache[key] ??= new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/manager-${key}.glb`))

const shade = (hex, f) => new THREE.Color(hex).multiplyScalar(f)

/** 캐릭터 조립 */
async function buildCharacter(look, teamColor) {
  const l = { ...DEFAULT_LOOK_3D, ...look }
  const [outfitGltf, headGltf] = await Promise.all([loadModel(l.outfit), loadModel(l.hair === 'bald' ? l.outfit : l.hair)])
  const root = cloneSkinned(outfitGltf.scene)
  const groups = {}
  root.traverse((o) => {
    const m = o.name.match(/_(Body|Feet|Head|Legs)$/)
    if (m) groups[m[1]] = o
  })
  let baseSkeleton = null
  root.traverse((o) => { if (o.isSkinnedMesh && !baseSkeleton) baseSkeleton = o.skeleton })
  const bones = Object.fromEntries(baseSkeleton.bones.map((b) => [b.name, b]))

  // 머리 바꿔 끼우기: 다른 모델의 머리를 이 모델의 뼈대에 다시 묶는다
  if (l.hair !== 'bald' && l.hair !== l.outfit && groups.Head) {
    const other = cloneSkinned(headGltf.scene)
    let head = null
    other.traverse((o) => { if (/_Head$/.test(o.name)) head = o })
    if (head) {
      const parent = groups.Head.parent
      parent.remove(groups.Head)
      head.traverse((o) => {
        if (!o.isSkinnedMesh) return
        const sk = new THREE.Skeleton(o.skeleton.bones.map((b) => bones[b.name]), o.skeleton.boneInverses)
        o.bind(sk, o.bindMatrix)
      })
      parent.add(head)
      groups.Head = head
    }
  }

  // 색 입히기
  const team = new THREE.Color(teamColor || '#7c5cff')
  const col = (v) => (v === 'team' ? team.clone() : new THREE.Color(v))
  root.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = true
    o.frustumCulled = false
    const name = o.material.name
    const mat = o.material.clone()
    o.material = mat
    const part = o.parent?.name?.match(/_(Body|Feet|Head|Legs)$/)?.[1] || o.name.match(/_(Body|Feet|Head|Legs)$/)?.[1]
    if (name === 'Skin') mat.color = new THREE.Color(l.skin)
    else if (name === 'Skin_Darker') mat.color = shade(l.skin, 0.8)
    else if (name === 'Hair') { mat.color = new THREE.Color(l.hairColor); if (l.hair === 'bald') o.visible = false }
    else if (name === 'Eyebrows') mat.color = shade(l.hairColor, 0.75)
    else if (name === 'Tie') mat.color = col(l.tie)
    else if (name === 'White') mat.color = new THREE.Color('#e9e9e9')
    else if (name === 'Eye') { /* 그대로 */ }
    else if (part === 'Legs') mat.color = col(l.bottom)
    else if (part === 'Body') mat.color = col(l.top)
    mat.roughness = name === 'Hair' ? 0.6 : 0.75
    mat.metalness = 0
  })

  // 체형: 키(전체), 체격(허리·가슴 폭), 머리 크기
  root.scale.setScalar(l.height)
  const widen = (b, f) => { if (bones[b]) { bones[b].scale.x *= f; bones[b].scale.z *= f } }
  widen('Hips', l.build)
  widen('Abdomen', l.build)
  if (bones.Neck) { bones.Neck.scale.x /= l.build; bones.Neck.scale.z /= l.build }
  if (bones.Head) bones.Head.scale.multiplyScalar(l.headSize)
  return { root, bones, groups, animations: outfitGltf.animations, look: l }
}

// 수염·안경: 눈 위치와 머리 크기를 기준으로 만든 뒤 머리 뼈에 붙인다 (머리 메시의 피부는 목까지 포함돼 있어 눈을 기준점으로 쓴다)
function addAccessories(ch) {
  const { look, bones, groups } = ch
  if (!groups.Head || !bones.Head) return
  ch.root.updateMatrixWorld(true)
  const boxes = {}
  const v = new THREE.Vector3()
  groups.Head.traverse((o) => {
    if (!o.isSkinnedMesh) return
    const b = boxes[o.material.name] || (boxes[o.material.name] = new THREE.Box3())
    const pos = o.geometry.attributes.position
    for (let i = 0; i < pos.count; i++) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); b.expandByPoint(v) }
  })
  const skin = boxes.Skin
  const eye = boxes.Eye
  if (!skin || !eye) return
  const E = (eye.min.y + eye.max.y) / 2 // 눈 높이
  const F = eye.max.z // 눈 앞면
  const W = (skin.max.x - skin.min.x) / 2 // 얼굴 반폭
  const u = skin.max.y - E // 눈~정수리 (머리 크기 단위)
  const ex = (eye.max.x - eye.min.x) / 4 // 눈 하나의 중심 x
  const cx = (skin.max.x + skin.min.x) / 2
  const hairMat = new THREE.MeshStandardMaterial({ color: look.hairColor, roughness: 0.95, flatShading: true })
  const items = []
  const lowerHalf = (rx, ry, rz, mat) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), mat)
    m.scale.set(rx, ry, rz)
    return m
  }
  if (look.beard === 'full') {
    const m = lowerHalf(W * 1.0, u * 0.42, u * 0.9, hairMat)
    m.position.set(cx, E - u * 0.6, F - u * 0.72)
    items.push(m)
  }
  if (look.beard === 'stubble') {
    const m = lowerHalf(W * 1.0, u * 0.4, u * 0.9, new THREE.MeshStandardMaterial({ color: look.hairColor, roughness: 1, transparent: true, opacity: 0.32 }))
    m.position.set(cx, E - u * 0.6, F - u * 0.73)
    items.push(m)
  }
  if (look.beard === 'goatee') {
    const m = new THREE.Mesh(new THREE.ConeGeometry(W * 0.28, u * 0.42, 10), hairMat)
    m.rotation.x = Math.PI
    m.position.set(cx, E - u * 0.98, F - u * 0.02)
    items.push(m)
  }
  if (look.beard === 'mustache' || look.beard === 'goatee' || look.beard === 'full') {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(u * 0.06, W * 0.6, 4, 8), hairMat)
    m.rotation.z = Math.PI / 2
    m.position.set(cx, E - u * 0.56, F + u * 0.08)
    items.push(m)
  }
  if (look.glasses !== 'none') {
    const r = W * 0.32
    const z = F + u * 0.12
    const frame = new THREE.MeshStandardMaterial({ color: look.glasses === 'sun' ? '#0f0f10' : '#2a2420', roughness: 0.35, metalness: 0.4 })
    for (const sx of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.14, 8, look.glasses === 'square' ? 4 : 24), frame)
      if (look.glasses === 'square') { ring.rotation.z = Math.PI / 4; ring.scale.set(1.15, 0.85, 1) }
      ring.position.set(cx + sx * ex * 1.1, E, z)
      items.push(ring)
      if (look.glasses === 'sun') {
        const lens = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 24), new THREE.MeshStandardMaterial({ color: '#0d0f14', roughness: 0.15, metalness: 0.7 }))
        lens.position.set(cx + sx * ex * 1.1, E, z + 0.001)
        items.push(lens)
      }
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.09, r * 0.09, u * 1.1, 6), frame)
      arm.rotation.x = Math.PI / 2
      arm.position.set(cx + sx * (W * 1.0), E + r * 0.2, z - u * 0.55)
      items.push(arm)
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.09, r * 0.09, Math.max(0.001, ex * 2.2 - r * 2), 6), frame)
    bridge.rotation.z = Math.PI / 2
    bridge.position.set(cx, E + r * 0.25, z)
    items.push(bridge)
  }
  for (const m of items) { m.castShadow = true; bones.Head.attach(m) }
}

/**
 * <Manager3D look teamColor framing="bust"|"full" />
 * ref.capture() → 썸네일 PNG data URL (상반신)
 */
const Manager3D = forwardRef(function Manager3D({ look, teamColor, height = 320, framing = 'full', interactive = true }, ref) {
  const wrap = useRef(null)
  const state = useRef({})

  // 렌더러·장면은 한 번만
  useEffect(() => {
    const el = wrap.current
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2440, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.set(2.5, 4, 4)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    scene.add(key)
    const rim = new THREE.DirectionalLight(new THREE.Color(teamColor || '#7c5cff'), 2.2)
    rim.position.set(-3, 3, -4)
    scene.add(rim)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.ShadowMaterial({ opacity: 0.35 }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)
    const clock = new THREE.Clock()
    const s = state.current
    Object.assign(s, { renderer, scene, camera, rim, clock, yaw: 0, drag: null })

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
      s.mixer?.update(dt)
      if (s.char) s.char.root.rotation.y += ((s.yaw) - s.char.root.rotation.y) * 0.15
      renderer.render(scene, camera)
    }
    loop()

    // 끌어서 돌리기
    const down = (e) => { s.drag = { x: e.clientX, yaw: s.yaw } }
    const move = (e) => { if (s.drag) s.yaw = s.drag.yaw + (e.clientX - s.drag.x) * 0.012 }
    const up = () => { s.drag = null }
    if (interactive) {
      renderer.domElement.addEventListener('pointerdown', down)
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [])

  // 외형이 바뀌면 캐릭터를 다시 조립
  useEffect(() => {
    let alive = true
    const s = state.current
    buildCharacter(look, teamColor).then((ch) => {
      if (!alive) return
      if (s.char) s.scene.remove(s.char.root)
      s.scene.add(ch.root)
      s.char = ch
      s.rim.color = new THREE.Color(teamColor || '#7c5cff')
      s.mixer = new THREE.AnimationMixer(ch.root)
      const idle = ch.animations.find((a) => a.name === 'Idle_Neutral') || ch.animations.find((a) => a.name === 'Idle')
      if (idle) s.mixer.clipAction(idle).play()
      s.mixer.update(0.01)
      addAccessories(ch)
      if (import.meta.env.DEV) window.__mgr = { ch, THREE } // 개발 중 디버깅용
      frame(s, framing)
    }).catch((e) => console.error('3D 감독 로딩 실패', e))
    return () => { alive = false }
  }, [JSON.stringify(look), teamColor])

  useEffect(() => { if (state.current.char) frame(state.current, framing) }, [framing])

  useImperativeHandle(ref, () => ({
    /** 상반신 정면 썸네일 */
    capture(px = 160) {
      const s = state.current
      if (!s.char) return null
      const { renderer, camera } = s
      const prev = { w: renderer.domElement.width / renderer.getPixelRatio(), h: renderer.domElement.height / renderer.getPixelRatio(), yaw: s.char.root.rotation.y, aspect: camera.aspect, pos: camera.position.clone(), q: camera.quaternion.clone() }
      s.char.root.rotation.y = 0
      renderer.setSize(px, px, false)
      camera.aspect = 1
      frame(s, 'face')
      renderer.render(s.scene, camera)
      const url = renderer.domElement.toDataURL('image/png')
      renderer.setSize(prev.w, prev.h)
      camera.aspect = prev.aspect
      frame(s, framing)
      s.char.root.rotation.y = prev.yaw
      return url
    },
    wave() {
      const s = state.current
      const clip = s.char?.animations.find((a) => a.name === 'Wave')
      if (!clip || !s.mixer) return
      const a = s.mixer.clipAction(clip)
      a.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.2).play()
      a.clampWhenFinished = false
    },
    turn(d) { state.current.yaw += d },
  }))

  return <div ref={wrap} className="mgr3d" style={{ height }} />
})

// 카메라 구도: full(전신) · bust(상반신) · face(얼굴 썸네일)
function frame(s, mode) {
  const box = new THREE.Box3().setFromObject(s.char.root)
  const h = box.max.y - box.min.y
  const cy = mode === 'full' ? box.min.y + h * 0.52 : mode === 'bust' ? box.min.y + h * 0.8 : box.min.y + h * 0.88
  const span = mode === 'full' ? h * 1.12 : mode === 'bust' ? h * 0.46 : h * 0.26
  const dist = span / 2 / Math.tan(THREE.MathUtils.degToRad(s.camera.fov / 2))
  s.camera.position.set(0, cy + span * 0.05, dist)
  s.camera.lookAt(0, cy, 0)
  s.camera.updateProjectionMatrix()
}

export default Manager3D
