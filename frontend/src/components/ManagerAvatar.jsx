// 감독 캐릭터 (SVG 조합): 피부·헤어·수염·안경·표정·의상
// look = { skin, hair, hairColor, beard, glasses, face, outfit, outfitColor, tie }
export const SKINS = ['#f7dcc8', '#efc3a3', '#dba57f', '#bd845d', '#8f5b3c', '#5f3b25']
export const HAIR_COLORS = [['#1d1815', '검정'], ['#4a2e1e', '흑갈색'], ['#7a4f2c', '갈색'], ['#c9a15e', '금발'], ['#a8492a', '적갈색'], ['#8c8c8c', '회색'], ['#e3e3e3', '백발']]
export const HAIRS = [['short', '짧은 머리'], ['sidepart', '가르마'], ['slick', '올백'], ['buzz', '버즈컷'], ['curly', '곱슬'], ['long', '장발 묶음'], ['mohawk', '투블럭'], ['bald', '민머리']]
export const BEARDS = [['none', '없음'], ['stubble', '수염 자국'], ['mustache', '콧수염'], ['goatee', '염소수염'], ['chin', '턱수염'], ['full', '풀 수염']]
export const GLASSES = [['none', '없음'], ['round', '둥근 안경'], ['square', '사각 안경'], ['sun', '선글라스']]
export const FACES = [['smile', '미소'], ['calm', '차분'], ['serious', '진지']]
export const OUTFITS = [['suit', '정장'], ['tracksuit', '트레이닝복'], ['coat', '롱패딩'], ['knit', '니트']]
export const OUTFIT_COLORS = [['team', '팀 색'], ['#1f2430', '블랙'], ['#1e2f5c', '네이비'], ['#4b5260', '차콜'], ['#6b4a2f', '브라운'], ['#6e1f2a', '와인'], ['#d8d3c8', '베이지']]
export const TIES = [['team', '팀 색'], ['#b3202a', '레드'], ['#1f4fb0', '블루'], ['#111317', '블랙'], ['#a87b18', '골드'], ['#2f6b3a', '그린']]

export const DEFAULT_LOOK = { skin: SKINS[1], hair: 'sidepart', hairColor: HAIR_COLORS[1][0], beard: 'stubble', glasses: 'none', face: 'calm', outfit: 'suit', outfitColor: '#1e2f5c', tie: 'team' }

export function randomLook() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)]
  const key = (a) => pick(a)[0]
  return { skin: pick(SKINS), hair: key(HAIRS), hairColor: key(HAIR_COLORS), beard: key(BEARDS), glasses: Math.random() < 0.6 ? 'none' : key(GLASSES), face: key(FACES), outfit: key(OUTFITS), outfitColor: key(OUTFIT_COLORS), tie: key(TIES) }
}

const shade = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16)
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v + amt))))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export default function ManagerAvatar({ look = DEFAULT_LOOK, teamColor = '#7c5cff', size = 120, bg = true }) {
  const l = { ...DEFAULT_LOOK, ...look }
  const skin = l.skin
  const skinD = shade(skin, -28)
  const hc = l.hairColor
  const oc = l.outfitColor === 'team' ? teamColor : l.outfitColor
  const ocD = shade(oc, -30)
  const tie = l.tie === 'team' ? teamColor : l.tie
  return (
    <svg viewBox="0 0 120 140" width={size} height={(size * 140) / 120} className="mgr-avatar" aria-label="감독 캐릭터">
      {bg && <circle cx="60" cy="66" r="58" fill={teamColor} opacity=".22" />}
      {/* 뒷머리 (장발) */}
      {l.hair === 'long' && <path d="M32 52 Q30 88 44 96 L76 96 Q90 88 88 52 Z" fill={hc} />}

      {/* 몸·의상 */}
      {l.outfit === 'coat' && <path d="M8 140 Q10 104 38 96 L82 96 Q110 104 112 140 Z" fill={oc} />}
      {l.outfit !== 'coat' && <path d="M12 140 Q14 106 40 99 L80 99 Q106 106 108 140 Z" fill={oc} />}
      {/* 목 */}
      <path d="M50 84 L50 100 Q60 106 70 100 L70 84 Z" fill={skinD} />
      {l.outfit === 'suit' && (
        <g>
          <path d="M46 99 L60 124 L74 99 Z" fill="#f4f4f4" />
          <path d="M57 104 L63 104 L65 128 L60 134 L55 128 Z" fill={tie} />
          <path d="M57 101 L63 101 L64 106 L56 106 Z" fill={shade(tie, -25)} />
          <path d="M40 99 L58 132 L50 140 L28 140 Q30 112 40 99 Z" fill={ocD} opacity=".55" />
          <path d="M80 99 L62 132 L70 140 L92 140 Q90 112 80 99 Z" fill={ocD} opacity=".55" />
        </g>
      )}
      {l.outfit === 'tracksuit' && (
        <g>
          <path d="M46 98 Q60 108 74 98 L74 104 Q60 114 46 104 Z" fill={ocD} />
          <line x1="60" y1="108" x2="60" y2="140" stroke="#e5e7eb" strokeWidth="2" />
          <path d="M22 116 L34 104" stroke="#fff" strokeWidth="3" opacity=".8" />
          <path d="M98 116 L86 104" stroke="#fff" strokeWidth="3" opacity=".8" />
          <circle cx="78" cy="118" r="4" fill="#fff" opacity=".85" />
        </g>
      )}
      {l.outfit === 'coat' && (
        <g>
          <path d="M42 92 Q60 104 78 92 L80 104 Q60 116 40 104 Z" fill={ocD} />
          <line x1="60" y1="110" x2="60" y2="140" stroke={ocD} strokeWidth="2" />
          <path d="M20 122 Q60 130 100 122" stroke={ocD} strokeWidth="2" fill="none" />
        </g>
      )}
      {l.outfit === 'knit' && (
        <g>
          <path d="M48 99 L60 110 L72 99 L68 99 L60 106 L52 99 Z" fill="#f4f4f4" />
          <path d="M16 128 Q60 136 104 128" stroke={ocD} strokeWidth="1.5" fill="none" opacity=".6" />
          <path d="M18 134 Q60 142 102 134" stroke={ocD} strokeWidth="1.5" fill="none" opacity=".6" />
        </g>
      )}

      {/* 머리 */}
      <ellipse cx="35" cy="62" rx="5" ry="8" fill={skinD} />
      <ellipse cx="85" cy="62" rx="5" ry="8" fill={skinD} />
      <path d="M36 48 Q36 24 60 24 Q84 24 84 48 L84 64 Q84 90 60 92 Q36 90 36 64 Z" fill={skin} />

      {/* 수염 */}
      {l.beard === 'stubble' && <path d="M38 66 Q40 90 60 92 Q80 90 82 66 Q78 82 60 84 Q42 82 38 66 Z" fill={hc} opacity=".28" />}
      {l.beard === 'full' && <path d="M37 60 Q37 94 60 96 Q83 94 83 60 Q80 76 72 78 Q60 74 48 78 Q40 76 37 60 Z" fill={hc} />}
      {l.beard === 'chin' && <path d="M42 74 Q46 92 60 93 Q74 92 78 74 Q72 84 60 85 Q48 84 42 74 Z" fill={hc} />}
      {l.beard === 'goatee' && <path d="M53 80 Q54 91 60 92 Q66 91 67 80 Q60 84 53 80 Z" fill={hc} />}
      {(l.beard === 'mustache' || l.beard === 'goatee' || l.beard === 'full') && <path d="M49 73 Q54 69 60 72 Q66 69 71 73 Q66 76 60 74 Q54 76 49 73 Z" fill={hc} />}

      {/* 얼굴 */}
      <path d="M45 50 Q50 47 55 50" stroke={hc} strokeWidth="2.6" fill="none" strokeLinecap="round" transform={l.face === 'serious' ? 'rotate(8 50 49)' : undefined} />
      <path d="M65 50 Q70 47 75 50" stroke={hc} strokeWidth="2.6" fill="none" strokeLinecap="round" transform={l.face === 'serious' ? 'rotate(-8 70 49)' : undefined} />
      <ellipse cx="50" cy="57" rx="2.6" ry="3" fill="#1f1a17" />
      <ellipse cx="70" cy="57" rx="2.6" ry="3" fill="#1f1a17" />
      <path d="M60 58 Q57 67 61 68" stroke={skinD} strokeWidth="2" fill="none" strokeLinecap="round" />
      {l.face === 'smile' && <path d="M51 77 Q60 84 69 77" stroke="#7a2e2a" strokeWidth="2.4" fill="none" strokeLinecap="round" />}
      {l.face === 'calm' && <path d="M53 78 Q60 81 67 78" stroke="#7a2e2a" strokeWidth="2.2" fill="none" strokeLinecap="round" />}
      {l.face === 'serious' && <path d="M53 79 L67 79" stroke="#7a2e2a" strokeWidth="2.2" strokeLinecap="round" />}

      {/* 앞머리 */}
      {l.hair === 'short' && <path d="M35 50 Q34 22 60 21 Q86 22 85 50 Q80 34 60 33 Q40 34 35 50 Z" fill={hc} />}
      {l.hair === 'sidepart' && <path d="M35 52 Q32 20 62 20 Q88 22 85 50 Q82 36 72 32 Q58 38 44 36 Q38 40 35 52 Z" fill={hc} />}
      {l.hair === 'slick' && <path d="M36 46 Q34 18 60 18 Q86 18 84 46 Q80 30 60 29 Q40 30 36 46 Z" fill={hc} />}
      {l.hair === 'buzz' && <path d="M36 46 Q36 23 60 23 Q84 23 84 46 Q78 32 60 31 Q42 32 36 46 Z" fill={hc} opacity=".75" />}
      {l.hair === 'curly' && (
        <g fill={hc}>
          {[[40, 36], [48, 28], [58, 25], [68, 26], [77, 31], [82, 40], [36, 44], [45, 34], [56, 31], [66, 31], [75, 36]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="7" />)}
        </g>
      )}
      {l.hair === 'long' && <path d="M35 52 Q32 20 60 20 Q88 20 85 52 Q80 34 60 32 Q40 34 35 52 Z" fill={hc} />}
      {l.hair === 'mohawk' && (
        <g>
          <path d="M36 50 Q36 30 46 26 L74 26 Q84 30 84 50 Q80 38 74 36 L46 36 Q40 38 36 50 Z" fill={hc} opacity=".5" />
          <path d="M46 36 Q46 16 60 15 Q74 16 74 36 Q66 31 60 31 Q54 31 46 36 Z" fill={hc} />
        </g>
      )}
      {l.hair === 'bald' && <path d="M44 32 Q52 27 60 27" stroke="#fff" strokeOpacity=".35" strokeWidth="3" fill="none" strokeLinecap="round" />}

      {/* 안경 */}
      {l.glasses === 'round' && (
        <g stroke="#2a2420" strokeWidth="1.8" fill="none"><circle cx="50" cy="57" r="7" /><circle cx="70" cy="57" r="7" /><path d="M57 57 L63 57 M43 56 L37 54 M77 56 L83 54" /></g>
      )}
      {l.glasses === 'square' && (
        <g stroke="#2a2420" strokeWidth="1.8" fill="none"><rect x="42" y="51" width="15" height="11" rx="2" /><rect x="63" y="51" width="15" height="11" rx="2" /><path d="M57 56 L63 56 M42 55 L37 54 M78 55 L83 54" /></g>
      )}
      {l.glasses === 'sun' && (
        <g><path d="M41 52 L58 52 L57 61 Q50 65 43 61 Z M62 52 L79 52 L77 61 Q70 65 63 61 Z" fill="#14161b" /><path d="M58 53 L62 53 M41 53 L37 52 M79 53 L83 52" stroke="#14161b" strokeWidth="1.8" /></g>
      )}
    </svg>
  )
}
