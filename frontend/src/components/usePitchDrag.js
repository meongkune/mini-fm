// 경기장 드래그: 자리(선발) → 다른 자리 = 맞바꾸기, 벤치 선수 → 자리 = 투입. 마우스·터치 모두 (Pointer Events)
// 짧게 누르고 떼면(6px 미만 이동) 드래그가 아니라 탭으로 처리해 기존 '선수 고르기'가 열린다.
import { useEffect, useRef, useState } from 'react'

const MOVE_PX = 6

/**
 * onMove(fromSlot, toSlot) · onPlace(playerId, toSlot) · onTap(slot)
 * 반환: { drag, startSlot(i, playerId, e), startBench(playerId, e), wasDrag() }
 *   drag = { id, x, y, over } (드래그 중일 때만) → 따라다니는 아이콘·놓을 자리 강조에 쓴다
 */
export default function usePitchDrag({ onMove, onPlace, onTap }) {
  const [drag, setDrag] = useState(null)
  const ref = useRef(null) // { kind, from, id, x0, y0, moved }
  const lastDrag = useRef(0)

  useEffect(() => {
    const slotAt = (x, y) => {
      const el = document.elementFromPoint(x, y)?.closest('[data-slot]')
      return el ? Number(el.dataset.slot) : null
    }
    const move = (e) => {
      const d = ref.current
      if (!d) return
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < MOVE_PX) return
      d.moved = true
      e.preventDefault()
      setDrag({ id: d.id, x: e.clientX, y: e.clientY, over: slotAt(e.clientX, e.clientY) })
    }
    const up = (e) => {
      const d = ref.current
      if (!d) return
      ref.current = null
      setDrag(null)
      if (!d.moved) { if (d.kind === 'slot') onTap?.(d.from); return }
      lastDrag.current = Date.now()
      const to = slotAt(e.clientX, e.clientY)
      if (to === null) return
      if (d.kind === 'slot' && to !== d.from) onMove?.(d.from, to)
      if (d.kind === 'bench') onPlace?.(d.id, to)
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up) }
  }, [onMove, onPlace, onTap])

  return {
    drag,
    startSlot: (i, id, e) => { if (e.button > 0) return; ref.current = { kind: 'slot', from: i, id, x0: e.clientX, y0: e.clientY, moved: false } },
    startBench: (id, e) => { if (e.button > 0) return; ref.current = { kind: 'bench', id, x0: e.clientX, y0: e.clientY, moved: false } },
    /** 방금 드래그가 끝났으면 true (드래그 직후 생기는 click 무시용) */
    wasDrag: () => Date.now() - lastDrag.current < 300,
  }
}
