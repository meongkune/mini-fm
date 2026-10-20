// 팀 엠블럼 · 국기 · 유니폼 아이콘
// 엠블럼은 football-data.org가 제공하는 이미지(팀 ext ID), 못 불러오면 팀 색 + 약자로 대신한다.
// 국기는 flagcdn.com 이미지 (Windows는 국기 이모지를 표시하지 못해 이미지로 쓴다)
import { useState } from 'react'
import { ink } from '../store.jsx'

const crestUrls = (ext) => [`https://crests.football-data.org/${ext}.svg`, `https://crests.football-data.org/${ext}.png`]

export function Crest({ team, size = 22, className = '' }) {
  const [step, setStep] = useState(0)
  if (!team) return null
  const urls = team.ext ? crestUrls(team.ext) : []
  if (step < urls.length) {
    return (
      <img
        className={`crest-img ${className}`}
        src={urls[step]}
        alt={team.name}
        title={team.name}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setStep((t) => t + 1)}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span className={`crest-sm ${className}`} style={{ '--c': team.color, '--ink': ink(team.color), width: size, height: size, fontSize: Math.max(7, size * 0.3) }} title={team.name}>
      {team.id.slice(0, 3)}
    </span>
  )
}

// 국적 → [국기 코드(flagcdn), 한국어 이름]
const NATIONS = {
  Albania: ['al', '알바니아'], Algeria: ['dz', '알제리'], Argentina: ['ar', '아르헨티나'], Australia: ['au', '호주'], Austria: ['at', '오스트리아'],
  Belgium: ['be', '벨기에'], 'Bosnia-Herzegovina': ['ba', '보스니아'], Brazil: ['br', '브라질'], Bulgaria: ['bg', '불가리아'], 'Burkina Faso': ['bf', '부르키나파소'],
  Cameroon: ['cm', '카메룬'], Canada: ['ca', '캐나다'], Chile: ['cl', '칠레'], China: ['cn', '중국'], Colombia: ['co', '콜롬비아'], Comoros: ['km', '코모로'],
  'Congo DR': ['cd', 'DR콩고'], 'DR Congo': ['cd', 'DR콩고'], Congo: ['cg', '콩고'], 'Costa Rica': ['cr', '코스타리카'], Croatia: ['hr', '크로아티아'],
  'Czech Republic': ['cz', '체코'], Czechia: ['cz', '체코'], Denmark: ['dk', '덴마크'], Ecuador: ['ec', '에콰도르'], Egypt: ['eg', '이집트'],
  England: ['gb-eng', '잉글랜드'], Estonia: ['ee', '에스토니아'], Finland: ['fi', '핀란드'], France: ['fr', '프랑스'], Gabon: ['ga', '가봉'], Gambia: ['gm', '감비아'],
  Georgia: ['ge', '조지아'], Germany: ['de', '독일'], Ghana: ['gh', '가나'], Greece: ['gr', '그리스'], Guinea: ['gn', '기니'], 'Guinea-Bissau': ['gw', '기니비사우'],
  Haiti: ['ht', '아이티'], Hungary: ['hu', '헝가리'], Iceland: ['is', '아이슬란드'], Indonesia: ['id', '인도네시아'], Iran: ['ir', '이란'], Ireland: ['ie', '아일랜드'],
  Israel: ['il', '이스라엘'], Italy: ['it', '이탈리아'], 'Ivory Coast': ['ci', '코트디부아르'], "Côte d'Ivoire": ['ci', '코트디부아르'], Jamaica: ['jm', '자메이카'],
  Japan: ['jp', '일본'], Kosovo: ['xk', '코소보'], Latvia: ['lv', '라트비아'], Libya: ['ly', '리비아'], Lithuania: ['lt', '리투아니아'], Luxembourg: ['lu', '룩셈부르크'],
  Mali: ['ml', '말리'], Mexico: ['mx', '멕시코'], Montenegro: ['me', '몬테네그로'], Morocco: ['ma', '모로코'], Mozambique: ['mz', '모잠비크'], Netherlands: ['nl', '네덜란드'],
  'New Zealand': ['nz', '뉴질랜드'], Nigeria: ['ng', '나이지리아'], 'North Macedonia': ['mk', '북마케도니아'], 'Northern Ireland': ['gb-nir', '북아일랜드'], Norway: ['no', '노르웨이'],
  Paraguay: ['py', '파라과이'], Peru: ['pe', '페루'], Poland: ['pl', '폴란드'], Portugal: ['pt', '포르투갈'], Romania: ['ro', '루마니아'], Russia: ['ru', '러시아'],
  Scotland: ['gb-sct', '스코틀랜드'], Senegal: ['sn', '세네갈'], Serbia: ['rs', '세르비아'], Slovakia: ['sk', '슬로바키아'], Slovenia: ['si', '슬로베니아'],
  'South Africa': ['za', '남아공'], 'South Korea': ['kr', '대한민국'], 'Korea Republic': ['kr', '대한민국'], Spain: ['es', '스페인'], Suriname: ['sr', '수리남'],
  Sweden: ['se', '스웨덴'], Switzerland: ['ch', '스위스'], Togo: ['tg', '토고'], 'Trinidad & Tobago': ['tt', '트리니다드 토바고'], Tunisia: ['tn', '튀니지'],
  Turkey: ['tr', '튀르키예'], Türkiye: ['tr', '튀르키예'], USA: ['us', '미국'], 'United States': ['us', '미국'], Ukraine: ['ua', '우크라이나'], Uruguay: ['uy', '우루과이'],
  Uzbekistan: ['uz', '우즈베키스탄'], Angola: ['ao', '앙골라'], Panama: ['pa', '파나마'], Honduras: ['hn', '온두라스'], 'Equatorial Guinea': ['gq', '적도 기니'],
  'Dominican Republic': ['do', '도미니카공화국'], 'Cape Verde Islands': ['cv', '카보베르데'], 'Cape Verde': ['cv', '카보베르데'], Guadeloupe: ['gp', '과들루프'], Malaysia: ['my', '말레이시아'],
  'Faeroe Islands': ['fo', '페로 제도'], 'Faroe Islands': ['fo', '페로 제도'], Moldova: ['md', '몰도바'], Cyprus: ['cy', '키프로스'], Mauritania: ['mr', '모리타니'], Armenia: ['am', '아르메니아'], Belarus: ['by', '벨라루스'], Benin: ['bj', '베냉'], 'Central African Republic': ['cf', '중앙아프리카'], Curaçao: ['cw', '퀴라소'], Kenya: ['ke', '케냐'], Qatar: ['qa', '카타르'], 'Saudi Arabia': ['sa', '사우디'], 'Sierra Leone': ['sl', '시에라리온'], Syria: ['sy', '시리아'], Uganda: ['ug', '우간다'], Martinique: ['mq', '마르티니크'], 'French Guiana': ['gf', '프랑스령 기아나'], Bolivia: ['bo', '볼리비아'], Azerbaijan: ['az', '아제르바이잔'], Kazakhstan: ['kz', '카자흐스탄'], Philippines: ['ph', '필리핀'], 'New Caledonia': ['nc', '뉴칼레도니아'], 'Burundi': ['bi', '부룬디'], 'Madagascar': ['mg', '마다가스카르'], 'Liberia': ['lr', '라이베리아'], 'Montserrat': ['ms', '몬트세랫'], 'Grenada': ['gd', '그레나다'], 'Bermuda': ['bm', '버뮤다'], Venezuela: ['ve', '베네수엘라'], Wales: ['gb-wls', '웨일스'], Zambia: ['zm', '잠비아'], Zimbabwe: ['zw', '짐바브웨'],
}
export const nationName = (nation) => NATIONS[nation]?.[1] ?? nation ?? ''

export function Flag({ nation, size = 16 }) {
  const n = NATIONS[nation]
  const [failed, setFailed] = useState(false)
  if (!n || failed) return null
  return (
    <img
      className="flag"
      src={`https://flagcdn.com/w40/${n[0]}.png`}
      alt={n[1]}
      title={n[1]}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ width: size, height: Math.round(size * 0.72) }}
    />
  )
}

/** 팀 색 유니폼 + 등번호 */
export function Kit({ color = '#7c5cff', number, size = 26 }) {
  const fg = ink(color)
  return (
    <svg className="kit" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <path d="M11 3 L6 5 L1 11 L5 15 L8 12.5 L8 29 L24 29 L24 12.5 L27 15 L31 11 L26 5 L21 3 Q16 7 11 3 Z" fill={color} stroke="rgba(0,0,0,.35)" strokeWidth="1" strokeLinejoin="round" />
      <path d="M11 3 Q16 7 21 3" fill="none" stroke={fg} strokeOpacity=".5" strokeWidth="1.2" />
      {number !== undefined && <text x="16" y="23" textAnchor="middle" fontSize="11" fontWeight="900" fill={fg} fontFamily="system-ui, sans-serif">{number}</text>}
    </svg>
  )
}
