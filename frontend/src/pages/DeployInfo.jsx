import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'

function Row({ label, value, mono }) {
  return (
    <div className="kv">
      <span>{label}</span>
      <strong className={mono ? 'mono' : ''}>{value ?? '—'}</strong>
    </div>
  )
}

function Tile({ label, value, sub }) {
  return (
    <div className="tile">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  )
}

function uptime(sec) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d) return `${d}일 ${h}시간`
  if (h) return `${h}시간 ${m}분`
  return `${m}분 ${sec % 60}초`
}

// 이미지 URI → { repo, tag } (레지스트리 호스트는 숨김)
function imageParts(uri = '') {
  const path = uri.split('/').slice(1).join('/') || uri
  const [repo, tag] = path.split(':')
  return { repo, tag: tag || 'latest' }
}

export default function DeployInfo() {
  const [meta, setMeta] = useState(null)
  const [latency, setLatency] = useState(null)
  const [error, setError] = useState('')
  const [checkedAt, setCheckedAt] = useState(null)

  const load = useCallback(async () => {
    try {
      const t0 = performance.now()
      await fetch('/api/health', { cache: 'no-store' })
      setLatency(Math.round(performance.now() - t0))
      setMeta(await api.meta())
      setCheckedAt(new Date())
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 15000) // 15초마다 상태 갱신
    return () => clearInterval(t)
  }, [load])

  if (error && !meta) return <div className="card error">상태 조회 실패: {error}</div>
  if (!meta) return <div className="card muted">상태를 확인하는 중…</div>

  const ecs = meta.ecs && !meta.ecs.error ? meta.ecs : null
  const onEcs = meta.environment === 'ecs'
  const container = ecs?.containers?.[0]
  const img = imageParts(container?.image)

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>시스템 상태</h1>
          <p className="muted">{checkedAt ? `마지막 확인 ${checkedAt.toLocaleTimeString('ko-KR')} · 15초마다 자동 갱신` : ''}</p>
        </div>
        <button className="btn ghost small" onClick={load}>↻ 새로고침</button>
      </div>

      <div className={`card status-hero ${error ? 'down' : 'up'}`}>
        <span className="pulse" />
        <div>
          <strong>{error ? '응답 지연' : '정상 운영 중'}</strong>
          <p>{onEcs ? 'AWS ECS · Fargate' : '로컬 개발 환경'} · API 응답 {latency ?? '—'}ms</p>
        </div>
        <span className="env-badge">{onEcs ? 'PRODUCTION' : 'LOCAL'}</span>
      </div>

      <div className="tiles">
        <Tile label="버전" value={meta.app_version} sub="이미지 태그 = 커밋 SHA" />
        <Tile label="가동 시간" value={uptime(meta.uptime_seconds)} sub={`시작 ${new Date(meta.started_at).toLocaleString('ko-KR')}`} />
        <Tile label="리전" value={meta.region || (onEcs ? '—' : 'local')} sub={ecs?.availability_zone ? `AZ ${ecs.availability_zone}` : '단일 호스트'} />
        <Tile label="리소스" value={ecs ? `${ecs.limits?.CPU} vCPU` : '—'} sub={ecs ? `메모리 ${ecs.limits?.Memory} MiB` : '로컬 프로세스'} />
      </div>

      <div className="card">
        <h3>요청 경로</h3>
        <div className="flow">
          <span>📱 Client</span><i>→</i>
          <span>{onEcs ? '🌐 Public IP :80' : '🌐 localhost'}</span><i>→</i>
          <span>{onEcs ? '📦 Fargate Task' : '💻 Process'}</span><i>→</i>
          <span>🐍 {(meta.runtime?.server || 'WSGI').split('/')[0]} · Flask</span>
        </div>
        {onEcs && <p className="small muted">로그: stdout → CloudWatch Logs (awslogs 드라이버)</p>}
      </div>

      {onEcs && meta.ecs?.error && <div className="card error">ECS 메타데이터 조회 오류: {meta.ecs.error}</div>}

      {ecs && (
        <div className="card">
          <h3>인프라 (ECS 작업 메타데이터 v4)</h3>
          <Row label="클러스터" value={ecs.cluster} mono />
          <Row label="작업 정의" value={`${ecs.family}:${ecs.revision}`} mono />
          <Row label="Task ID" value={ecs.task_id} mono />
          <Row label="시작 유형" value={ecs.launch_type} />
          <Row label="상태" value={`${ecs.known_status} / 목표 ${ecs.desired_status}`} />
          <Row label="프라이빗 IP" value={ecs.private_ip} mono />
        </div>
      )}

      {container && (
        <div className="card">
          <h3>컨테이너</h3>
          <Row label="이름" value={container.name} mono />
          <Row label="이미지" value={img.repo} mono />
          <Row label="태그" value={img.tag} mono />
          <Row label="다이제스트" value={container.image_digest?.slice(0, 19)} mono />
          <Row label="상태" value={container.status} />
          <Row label="시작" value={container.started_at && new Date(container.started_at).toLocaleString('ko-KR')} />
        </div>
      )}

      <div className="card">
        <h3>런타임</h3>
        <Row label="Python" value={meta.runtime?.python} mono />
        <Row label="Flask" value={meta.runtime?.flask} mono />
        <Row label="WSGI 서버" value={meta.runtime?.server} mono />
        <Row label="OS / 아키텍처" value={meta.runtime?.os} mono />
        <Row label="호스트" value={meta.hostname} mono />
      </div>
    </section>
  )
}
