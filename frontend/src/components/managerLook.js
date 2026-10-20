// 3D 감독 외형 옵션 (three.js 없이 쓸 수 있게 따로 둔다)
export const OUTFITS_3D = [['suit', '정장'], ['casual', '캐주얼'], ['hoodie', '후드']]
export const HAIRS_3D = [['suit', '포마드'], ['casual', '댄디'], ['hoodie', '숏컷'], ['bald', '민머리']]
export const SKINS_3D = ['#f3d2bd', '#e8b896', '#d29a70', '#b07a52', '#8a5636', '#5b3622']
export const HAIR_COLORS_3D = [['#1b1512', '검정'], ['#3f2717', '흑갈색'], ['#6e4526', '갈색'], ['#c7a063', '금발'], ['#9b4424', '적갈색'], ['#8b8b8b', '회색'], ['#e6e6e6', '백발']]
export const BEARDS_3D = [['none', '없음'], ['stubble', '수염 자국'], ['mustache', '콧수염'], ['goatee', '염소수염'], ['full', '풀 수염']]
export const GLASSES_3D = [['none', '없음'], ['round', '둥근 안경'], ['square', '사각 안경'], ['sun', '선글라스']]
export const TOP_COLORS = [['team', '팀 색'], ['#1c2230', '블랙'], ['#1d2d5a', '네이비'], ['#4a505d', '차콜'], ['#6b4a2f', '브라운'], ['#6e1f2a', '와인'], ['#d6d0c4', '베이지'], ['#f2f2f2', '화이트']]
export const BOTTOM_COLORS = [['#1c2230', '블랙'], ['#1d2d5a', '네이비'], ['#4a505d', '차콜'], ['#6b4a2f', '브라운'], ['#c8bfae', '베이지'], ['#3f6fb0', '데님']]
export const TIE_COLORS = [['team', '팀 색'], ['#b3202a', '레드'], ['#1f4fb0', '블루'], ['#111317', '블랙'], ['#a87b18', '골드'], ['#2f6b3a', '그린']]

export const DEFAULT_LOOK_3D = { outfit: 'suit', hair: 'suit', skin: SKINS_3D[1], hairColor: '#3f2717', beard: 'stubble', glasses: 'none', top: '#1d2d5a', bottom: '#1c2230', tie: 'team', height: 1, build: 1, headSize: 1 }

/** 예전(2D) 감독 설정 → 3D 설정 */
export function toLook3D(look = {}) {
  if (look.v === 3) return { ...DEFAULT_LOOK_3D, ...look }
  const outfit = look.outfit === 'suit' ? 'suit' : look.outfit === 'coat' ? 'casual' : look.outfit ? 'hoodie' : 'suit'
  const hair = look.hair === 'bald' ? 'bald' : look.hair === 'slick' || look.hair === 'sidepart' ? 'suit' : look.hair === 'buzz' || look.hair === 'mohawk' ? 'hoodie' : look.hair ? 'casual' : 'suit'
  const beard = ['stubble', 'mustache', 'goatee', 'full'].includes(look.beard) ? look.beard : look.beard === 'chin' ? 'full' : 'none'
  return { ...DEFAULT_LOOK_3D, outfit, hair, beard, skin: look.skin || DEFAULT_LOOK_3D.skin, hairColor: look.hairColor || DEFAULT_LOOK_3D.hairColor, glasses: look.glasses || 'none', top: look.outfitColor || DEFAULT_LOOK_3D.top, tie: look.tie || 'team', v: 3 }
}

export function randomLook3D() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)]
  const k = (a) => pick(a)[0]
  return { v: 3, outfit: k(OUTFITS_3D), hair: k(HAIRS_3D), skin: pick(SKINS_3D), hairColor: k(HAIR_COLORS_3D), beard: k(BEARDS_3D), glasses: Math.random() < 0.65 ? 'none' : k(GLASSES_3D), top: k(TOP_COLORS), bottom: k(BOTTOM_COLORS), tie: k(TIE_COLORS), height: 0.94 + Math.random() * 0.12, build: 0.9 + Math.random() * 0.3, headSize: 0.95 + Math.random() * 0.1 }
}

