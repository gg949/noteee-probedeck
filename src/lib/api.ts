import { useEffect, useMemo, useState } from "react"

const MB = 1024 * 1024
const KEEP = 60
const REFRESH_MS = 15_000
const HEARTBEAT_MS = 30_000
const ALLOWED_HOURS = [0.167, 0.5, 1, 6, 12, 24, 48, 96, 168, 336, 720] as const

export type ProbeMeta = { id: string; name: string }

export type Metrics = {
  uptime: number
  cpu: number
  load: [number, number, number]
  mem_total: number
  mem_used: number
  swap_total: number
  swap_used: number
  disk_total: number
  disk_used: number
  net_rx: number
  net_tx: number
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  tcp: number
  udp: number
  procs: number
}

export type NodeProbe = ProbeMeta & { ping: number | null; loss: number | null }

export type Node = {
  id: string
  name: string
  sort: number
  public: boolean
  online: boolean
  country: string
  last_seen: number
  metrics: Metrics | null
  os: string
  kernel: string
  arch: string
  virt: string
  cpu_name: string
  cpu_cores: number
  mem_total: number
  swap_total: number
  disk_total: number
  agent_version: string
  price: number
  currency: string
  billing_cycle: string
  expires_at: string | null
  traffic_limit: number
  traffic_mode: string
  traffic_reset_day: number
  total_rx: number
  total_tx: number
  month_rx: number
  month_tx: number
  month_start: string
  day_rx: number
  day_tx: number
  probes: NodeProbe[]
  show_price?: boolean
  show_expire?: boolean
  show_traffic?: boolean
  hostname?: string
  ip?: string
  remark?: string
}

export type SiteConfig = {
  version?: string
  authorization: boolean
  is_public: boolean
  online_threshold_seconds: number
  public_history_hours: number
  frontend_ws_timeout_minutes: number
  max_history_hours: number
  theme_options?: Record<string, unknown>
  [key: string]: unknown
}

const DEFAULTS: SiteConfig = {
  authorization: false,
  is_public: true,
  online_threshold_seconds: 300,
  public_history_hours: 24,
  frontend_ws_timeout_minutes: 0,
  max_history_hours: 168,
  theme_options: {},
}

let runtimeConfig: SiteConfig = DEFAULTS

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: init?.body ? { "content-type": "application/json", ...init?.headers } : init?.headers,
  })
  if (!res.ok) throw new ApiError(res.status, (await res.text()) || res.statusText)
  return res.status === 204 ? (undefined as T) : res.json()
}

export async function loadSiteConfig(): Promise<SiteConfig> {
  try {
    const raw = await api<Partial<SiteConfig>>("/api/config")
    const isProbeDeck = Object.prototype.hasOwnProperty.call(raw, "public_history_hours")
    runtimeConfig = { ...DEFAULTS, ...raw, max_history_hours: isProbeDeck ? 720 : 168 }
  } catch {
    runtimeConfig = DEFAULTS
  }
  return runtimeConfig
}

export const speedHistory: { rx: number; tx: number }[] = []

const finite = (value: unknown, fallback = 0): number => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

function parseLoad(value: unknown): [number, number, number] {
  const values = String(value ?? "").trim().split(/\s+/).map(Number)
  return [finite(values[0]), finite(values[1]), finite(values[2])]
}

export function parseTrafficLimit(value: unknown): number {
  const raw = String(value ?? "").trim().toLowerCase()
  if (!raw || raw === "-1") return 0
  const match = raw.match(/^([\d.]+)\s*(b|kb|mb|gb|tb|pb)?(?:\/mo(?:nth)?|\/月)?$/)
  if (!match) return 0
  const units: Record<string, number> = { b: 1, kb: 1024, mb: MB, gb: 1024 ** 3, tb: 1024 ** 4, pb: 1024 ** 5 }
  // ProbeDeck 后台的纯数字流量上限单位是 GB；无单位字符串也按 GB 处理。
  const unit = match[2] ?? "gb"
  return finite(Number(match[1])) * units[unit]
}

function normalizeCycle(value: unknown): string {
  return ({
    month: "monthly",
    quarter: "quarterly",
    half_year: "semiannual",
    year: "yearly",
    two_years: "biennial",
    three_years: "triennial",
    four_years: "biennial",
    five_years: "triennial",
    monthly: "monthly",
    quarterly: "quarterly",
    semiannual: "semiannual",
    yearly: "yearly",
    biennial: "biennial",
    triennial: "triennial",
  } as Record<string, string>)[String(value ?? "")] ?? "monthly"
}

function normalizeTrafficMode(value: unknown): string {
  const mode = String(value ?? "total")
  if (mode === "ul" || mode === "up") return "up"
  if (mode === "dl" || mode === "down") return "down"
  if (mode === "max") return "max"
  return "sum"
}

function normalizeCurrency(value: unknown): string {
  const raw = String(value ?? "USD").trim()
  return ({ "¥": "CNY", "￥": "CNY", "$": "USD", "€": "EUR", "£": "GBP" } as Record<string, string>)[raw] ?? raw
}

function parseExtraProbes(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== "string" || !raw.trim()) return {}
  try {
    const value = JSON.parse(raw)
    return value && typeof value === "object" && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

const PROBE_SLOTS = [
  { id: "ct", hostField: "custom_ct", nameField: "custom_ct_name", defaultName: "电信" },
  { id: "cu", hostField: "custom_cu", nameField: "custom_cu_name", defaultName: "联通" },
  { id: "cm", hostField: "custom_cm", nameField: "custom_cm_name", defaultName: "移动" },
  { id: "bd", hostField: "custom_bd", nameField: "custom_bd_name", defaultName: "BGP" },
  { id: "node_1", hostField: "node_1", nameField: "node_1_name", defaultName: "Node 1" },
  { id: "node_2", hostField: "node_2", nameField: "node_2_name", defaultName: "Node 2" },
  { id: "node_3", hostField: "node_3", nameField: "node_3_name", defaultName: "Node 3" },
  { id: "node_4", hostField: "node_4", nameField: "node_4_name", defaultName: "Node 4" },
  ...Array.from({ length: 16 }, (_, index) => {
    const n = index + 5
    return { id: `node_${n}`, hostField: `node_${n}`, nameField: `node_${n}_name`, defaultName: `Node ${n}` }
  }),
]

function hostIsHidden(value: unknown): boolean {
  return value !== undefined && (String(value).trim() === "" || String(value).trim() === "0")
}

function normalizeProbes(raw: Record<string, unknown>): NodeProbe[] {
  const extra = parseExtraProbes(raw.extra_probes)
  const configured = Array.isArray(raw.probes)
    ? new Map((raw.probes as Record<string, unknown>[]).map((item) => [String(item.id ?? ""), item]))
    : new Map<string, Record<string, unknown>>()

  return PROBE_SLOTS.flatMap((slot) => {
    const item = configured.get(slot.id)
    const hostValue = item?.host ?? raw[slot.hostField]
    if (hostIsHidden(hostValue)) return []
    const pingValue = item?.ping ?? raw[`ping_${slot.id}`] ?? extra[`ping_${slot.id}`]
    const lossValue = item?.loss ?? raw[`loss_${slot.id}`] ?? extra[`loss_${slot.id}`]
    const disabled = pingValue === false || pingValue === "false"
    const hasValue = pingValue !== undefined && !disabled
    if (!item && !hasValue) return []

    const ping = disabled ? null : Number(pingValue)
    const loss = lossValue === false || lossValue === "false" ? null : Number(lossValue)
    return [{
      id: slot.id,
      name: String(item?.name ?? raw[slot.nameField] ?? runtimeConfig[slot.nameField] ?? slot.defaultName),
      ping: Number.isFinite(ping) ? ping : null,
      loss: Number.isFinite(loss) ? loss : null,
    }]
  })
}

function normalizeBootTime(raw: unknown): number {
  const number = Number(raw)
  if (!Number.isFinite(number) || number <= 0) return 0
  return number < 10_000_000_000 ? number * 1000 : number
}

export function normalizeServer(raw: Record<string, unknown>, onlineThresholdSeconds = runtimeConfig.online_threshold_seconds): Node {
  const now = Date.now()
  const lastUpdated = finite(raw.last_updated || raw.timestamp)
  const online = lastUpdated > 0 && now - lastUpdated < finite(onlineThresholdSeconds, 300) * 1000
  const ramTotal = finite(raw.ram_total) * MB
  const ramUsed = finite(raw.ram_used) * MB
  const diskTotal = finite(raw.disk_total) * MB
  const swapTotal = finite(raw.swap_total) * MB
  const swapUsed = finite(raw.swap_used) * MB
  const diskUsed = finite(raw.disk_used) * MB
  const netRx = finite(raw.net_rx)
  const netTx = finite(raw.net_tx)
  const monthRx = finite(raw.net_rx_monthly)
  const monthTx = finite(raw.net_tx_monthly)
  const price = finite(raw.price === "-1" ? 0 : raw.price)
  const bootTime = normalizeBootTime(raw.boot_time)
  const probes = normalizeProbes(raw)
  const deployed = ramTotal > 0 || diskTotal > 0 || finite(raw.cpu_cores) > 0

  const metrics: Metrics | null = online && deployed ? {
    uptime: bootTime > 0 ? Math.max(0, Math.floor((now - bootTime) / 1000)) : 0,
    cpu: finite(raw.cpu),
    load: parseLoad(raw.load ?? raw.load_avg),
    mem_total: ramTotal,
    mem_used: ramUsed,
    swap_total: swapTotal,
    swap_used: swapUsed,
    disk_total: diskTotal,
    disk_used: diskUsed,
    net_rx: finite(raw.net_in_speed),
    net_tx: finite(raw.net_out_speed),
    total_rx: netRx,
    total_tx: netTx,
    month_rx: monthRx,
    month_tx: monthTx,
    tcp: finite(raw.tcp_conn),
    udp: finite(raw.udp_conn),
    procs: finite(raw.processes),
  } : null

  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? "未命名节点"),
    sort: finite(raw.sort_order),
    public: raw.is_hidden !== "1",
    online,
    country: String(raw.region ?? "").toUpperCase(),
    last_seen: Math.floor(lastUpdated / 1000),
    metrics,
    os: String(raw.os ?? ""),
    kernel: String(raw.kernel_version ?? ""),
    arch: String(raw.arch ?? ""),
    virt: "",
    cpu_name: String(raw.cpu_info ?? ""),
    cpu_cores: finite(raw.cpu_cores),
    mem_total: ramTotal,
    swap_total: swapTotal,
    disk_total: diskTotal,
    agent_version: String(raw.agent_version ?? ""),
    price,
    currency: normalizeCurrency(raw.currency),
    billing_cycle: normalizeCycle(raw.billing_cycle),
    expires_at: String(raw.expire_date ?? "").trim() || null,
    traffic_limit: parseTrafficLimit(raw.traffic_limit),
    traffic_mode: normalizeTrafficMode(raw.traffic_calc_type),
    traffic_reset_day: finite(raw.reset_day, 1),
    total_rx: netRx,
    total_tx: netTx,
    month_rx: monthRx,
    month_tx: monthTx,
    month_start: "",
    day_rx: 0,
    day_tx: 0,
    probes,
    show_price: raw.show_price !== false,
    show_expire: raw.show_expire !== false,
    show_traffic: raw.show_traffic !== false,
  }
}

function sample(nodes: Node[]) {
  const live = nodes.filter((node) => node.online && node.metrics)
  speedHistory.push({
    rx: live.reduce((sum, node) => sum + node.metrics!.net_rx, 0),
    tx: live.reduce((sum, node) => sum + node.metrics!.net_tx, 0),
  })
  if (speedHistory.length > KEEP) speedHistory.shift()
}

export function safeNodes(nodes: Node[]): Node[] {
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0
  const fields = ["uptime", "cpu", "mem_total", "mem_used", "swap_total", "swap_used", "disk_total", "disk_used",
    "net_rx", "net_tx", "total_rx", "total_tx", "month_rx", "month_tx", "tcp", "udp", "procs"] as const
  return nodes.map((node) => {
    const metrics = node.metrics
    return !metrics || (Array.isArray(metrics.load) && metrics.load.length === 3 && fields.every((key) => number(metrics[key])) && metrics.load.every(number))
      ? node
      : { ...node, metrics: null }
  })
}

export function applyBatchUpdate(current: Node, patch: Record<string, unknown>, ts: number, threshold: number): Node {
  const currentMetrics = current.metrics
  const nowForPatch = () => ts
  const next: Record<string, unknown> = {
    ...current,
    ...patch,
    id: current.id,
    name: current.name,
    sort: current.sort,
    region: patch.region ?? current.country,
    boot_time: patch.boot_time ?? (currentMetrics?.uptime ? nowForPatch() - currentMetrics.uptime * 1000 : 0),
    os: patch.os ?? current.os,
    kernel_version: patch.kernel_version ?? current.kernel,
    arch: patch.arch ?? current.arch,
    cpu_info: patch.cpu_info ?? current.cpu_name,
    cpu_cores: patch.cpu_cores ?? current.cpu_cores,
    agent_version: patch.agent_version ?? current.agent_version,
    reset_day: patch.reset_day ?? current.traffic_reset_day,
    last_updated: patch.last_updated ?? patch.timestamp ?? current.last_seen * 1000,
    cpu: patch.cpu ?? currentMetrics?.cpu ?? 0,
    load_avg: patch.load_avg ?? patch.load ?? currentMetrics?.load.join(" ") ?? "0 0 0",
    ram_total: patch.ram_total ?? current.mem_total / MB,
    ram_used: patch.ram_used ?? (currentMetrics ? currentMetrics.mem_used / MB : 0),
    swap_total: patch.swap_total ?? current.swap_total / MB,
    swap_used: patch.swap_used ?? (currentMetrics ? currentMetrics.swap_used / MB : 0),
    disk_total: patch.disk_total ?? current.disk_total / MB,
    disk_used: patch.disk_used ?? (currentMetrics ? currentMetrics.disk_used / MB : 0),
    net_in_speed: patch.net_in_speed ?? currentMetrics?.net_rx ?? 0,
    net_out_speed: patch.net_out_speed ?? currentMetrics?.net_tx ?? 0,
    net_rx: patch.net_rx ?? current.total_rx,
    net_tx: patch.net_tx ?? current.total_tx,
    net_rx_monthly: patch.net_rx_monthly ?? current.month_rx,
    net_tx_monthly: patch.net_tx_monthly ?? current.month_tx,
    tcp_conn: patch.tcp_conn ?? currentMetrics?.tcp ?? 0,
    udp_conn: patch.udp_conn ?? currentMetrics?.udp ?? 0,
    processes: patch.processes ?? currentMetrics?.procs ?? 0,
  }
  if (!patch.last_updated && !patch.timestamp) next.last_updated = ts
  const probeValues = patch.probes
    ? patch.probes
    : current.probes.map((probe) => ({
        ...probe,
        ping: patch[`ping_${probe.id}`] ?? patch[probe.id] ?? probe.ping,
        loss: patch[`loss_${probe.id}`] ?? probe.loss,
      }))
  const normalized = normalizeServer({ ...next, probes: probeValues }, threshold)
  return {
    ...normalized,
    name: current.name,
    sort: current.sort,
    country: current.country,
    price: current.price,
    currency: current.currency,
    billing_cycle: current.billing_cycle,
    expires_at: current.expires_at,
    traffic_limit: current.traffic_limit,
    traffic_mode: current.traffic_mode,
    traffic_reset_day: current.traffic_reset_day,
    day_rx: current.day_rx,
    day_tx: current.day_tx,
    show_price: current.show_price,
    show_expire: current.show_expire,
    show_traffic: current.show_traffic,
    hostname: current.hostname,
    ip: current.ip,
    remark: current.remark,
  }
}

export function useNodes() {
  const [nodes, setNodes] = useState<Node[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)

  useEffect(() => {
    let socket: WebSocket | null = null
    let poll: ReturnType<typeof setInterval> | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let heartbeat: ReturnType<typeof setInterval> | null = null
    let stopped = false
    let closeCount = 0
    let map = new Map<string, Node>()

    const receive = (list: Node[]) => {
      const safe = safeNodes(list)
      map = new Map(safe.map((node) => [node.id, node]))
      sample(safe)
      setNodes(safe)
      setError(null)
      setClosed(false)
      setUpdatedAt(Date.now())
    }

    const fetchOnce = async () => {
      try {
        const config = await loadSiteConfig()
        const data = await api<{ servers: Record<string, unknown>[]; sysConfig?: Record<string, boolean> }>("/api/servers")
        const flags = data.sysConfig ?? {}
        receive(data.servers.map((server) => normalizeServer({
          ...server,
          show_price: flags.show_price !== false,
          show_expire: flags.show_expire !== false,
          show_traffic: flags.show_tf !== false,
        }, config.online_threshold_seconds)))
      } catch (cause) {
        const err = cause as Error
        setError(err.message)
        if (err instanceof ApiError && err.status === 401) setClosed(true)
      }
    }

    const connect = () => {
      if (stopped || map.size === 0) return
      try {
        const url = new URL(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/ws`)
        url.searchParams.set("subscribe", "all")
        socket = new WebSocket(url.toString())
      } catch {
        poll ??= setInterval(fetchOnce, REFRESH_MS)
        retry = setTimeout(connect, 5000)
        return
      }

      socket.onopen = () => {
        closeCount = 0
        if (poll) clearInterval(poll)
        poll = null
        socket?.send(JSON.stringify({ type: "subscribe", scope: "all", ids: [...map.keys()] }))
        heartbeat = setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping", ts: Date.now() }))
        }, HEARTBEAT_MS)
      }
      socket.onmessage = (event) => {
        let message: { type?: string; updates?: Array<{ serverId: string; samples: Array<{ ts: number; data?: Record<string, unknown>; payload?: Record<string, unknown>; metrics?: Record<string, unknown> }> }> }
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.type !== "batchUpdate" || !Array.isArray(message.updates)) return
        for (const update of message.updates) {
          const current = map.get(update.serverId)
          if (!current) continue
          let next = current
          for (const item of update.samples ?? []) {
            next = applyBatchUpdate(next, item.data ?? item.payload ?? item.metrics ?? {}, item.ts, runtimeConfig.online_threshold_seconds)
          }
          if (next !== current) map.set(update.serverId, next)
        }
        const list = safeNodes([...map.values()])
        sample(list)
        setNodes(list)
        setError(null)
        setClosed(false)
        setUpdatedAt(Date.now())
      }
      socket.onerror = () => socket?.close()
      socket.onclose = () => {
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = null
        if (stopped) return
        poll ??= setInterval(fetchOnce, REFRESH_MS)
        closeCount += 1
        retry = setTimeout(connect, closeCount === 1 ? 250 : Math.min(30_000, 1000 * 2 ** Math.min(closeCount - 1, 5)))
      }
    }

    void loadSiteConfig().then(fetchOnce).then(() => {
      poll ??= setInterval(fetchOnce, REFRESH_MS)
      connect()
    })

    return () => {
      stopped = true
      socket?.close()
      if (poll) clearInterval(poll)
      if (retry) clearTimeout(retry)
      if (heartbeat) clearInterval(heartbeat)
    }
  }, [])

  return { nodes, error, closed, updatedAt }
}

export type MetricPoint = { ts: number; cpu: number; mem_used: number; disk_used: number; net_rx: number; net_tx: number }
export type PingPoint = { task_id: number; ts: number; latency: number | null; band?: [number, number]; loss?: number }
export type History = {
  metrics: MetricPoint[]
  ping: PingPoint[]
  probes: Record<string, string>
  loss?: Record<string, number>
  dayRx?: number | null
  dayTx?: number | null
}

function nearestAllowedHours(hours: number): number {
  return ALLOWED_HOURS.find((allowed) => hours <= allowed) ?? 720
}

/**
 * 今日流量：面板历史表里的 net_rx / net_tx 是累计计数器，今日用量 = 今天第一条与最后一条的差值。
 * 注意当前面板的 /api/history/all 默认不返回这两列，需要服务端把 'net_rx','net_tx' 加进
 * HISTORY_ALL_QUERY_COLUMNS（见 ProbeDeck src/utils/historyFields.js）才会有数据；
 * 取不到行或字段时返回 null，调用方退回占位文案。跨月重置导致差值为负时退回最后一条（重置后累计）。
 */
function todayTrafficDelta(rows: Record<string, unknown>[], field: "net_rx" | "net_tx"): number | null {
  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const from = dayStart.getTime()
  let first: number | null = null
  let last: number | null = null
  for (const row of rows) {
    const ts = Number(row.timestamp)
    const value = Number(row[field])
    if (!Number.isFinite(ts) || !Number.isFinite(value) || ts < from) continue
    if (first === null) first = value
    last = value
  }
  if (first === null || last === null) return null
  const delta = last - first
  return delta >= 0 ? delta : last
}

function historyRowsToPing(rows: Record<string, unknown>[], probes: ProbeMeta[], current: NodeProbe[]): History {
  const selected = probes.length ? probes : current.map((probe) => ({ id: probe.id, name: probe.name }))
  const points: PingPoint[] = []
  const loss: Record<string, number> = {}
  selected.forEach((probe, index) => {
    const currentProbe = current.find((item) => item.id === probe.id)
    for (const row of rows) {
      const raw = row[`ping_${probe.id}`] ?? parseExtraProbes(row.extra_probes)[`ping_${probe.id}`]
      if (raw === undefined || raw === false || raw === "false") continue
      const value = Number(raw)
      points.push({ task_id: index + 1, ts: Math.floor(Number(row.timestamp) / 1000), latency: Number.isFinite(value) ? value : null, loss: 0 })
      const rowLoss = Number(row[`loss_${probe.id}`] ?? parseExtraProbes(row.extra_probes)[`loss_${probe.id}`])
      if (Number.isFinite(rowLoss)) loss[String(index + 1)] = rowLoss
    }
    if (!points.some((point) => point.task_id === index + 1) && currentProbe) {
      points.push({ task_id: index + 1, ts: Math.floor(Date.now() / 1000), latency: currentProbe.ping, loss: currentProbe.loss ?? 0 })
      if (currentProbe.loss !== null) loss[String(index + 1)] = currentProbe.loss
    }
  })
  return {
    metrics: [],
    ping: points,
    probes: Object.fromEntries(selected.map((probe, index) => [String(index + 1), probe.name])),
    loss,
  }
}

export const HISTORY_RANGES = [
  { hours: 0.167, label: "10 分钟" },
  { hours: 0.5, label: "30 分钟" },
  { hours: 1, label: "1 小时" },
  { hours: 6, label: "6 小时" },
  { hours: 12, label: "12 小时" },
  { hours: 24, label: "24 小时" },
  { hours: 48, label: "2 天" },
  { hours: 96, label: "4 天" },
  { hours: 168, label: "7 天" },
  { hours: 336, label: "14 天" },
  { hours: 720, label: "30 天" },
] as const

export function availableHistoryRanges(publicOnly: boolean): typeof HISTORY_RANGES[number][] {
  const max = publicOnly ? finite(runtimeConfig.public_history_hours, 24) : finite(runtimeConfig.max_history_hours, 168)
  return HISTORY_RANGES.filter((range) => range.hours <= max)
}

export async function fetchHistory(
  id: string,
  hours: number,
  series: "metrics" | "ping",
  _points = 240,
  probes: ProbeMeta[] = [],
  current: NodeProbe[] = [],
): Promise<History> {
  const safeHours = nearestAllowedHours(hours)
  const rows = await api<Record<string, unknown>[]>(`/api/history/all?id=${encodeURIComponent(id)}&hours=${safeHours}`)
  if (series === "ping") {
    return {
      ...historyRowsToPing(rows, probes, current),
      dayRx: todayTrafficDelta(rows, "net_rx"),
      dayTx: todayTrafficDelta(rows, "net_tx"),
    }
  }
  return {
    metrics: rows.map((row) => ({
      ts: Math.floor(Number(row.timestamp) / 1000),
      cpu: finite(row.cpu),
      mem_used: finite(row.ram_used) * MB,
      disk_used: finite(row.disk_used) * MB,
      net_rx: finite(row.net_in_speed),
      net_tx: finite(row.net_out_speed),
    })),
    ping: [],
    probes: {},
  }
}

export type LatencyHour = { ts: number; latency: number | null; loss: number | null }
export type ProbeStat = { id: number; name: string; latency: number | null; jitter: number | null; loss: number; min: number | null; max: number | null; hours: LatencyHour[]; avgLatency: number | null; avgLoss: number | null }
export type Latency = { latency: number | null; loss: number; probe: string; jitter: number | null; probes: ProbeStat[]; hours: LatencyHour[]; avgLatency: number | null; avgLoss: number | null; none?: boolean; failed?: boolean; dayRx?: number | null; dayTx?: number | null }
export type LatencyMap = Record<string, Latency>

function jitterOf(values: (number | null)[]): number | null {
  const clean = values.filter((value): value is number => value !== null)
  if (clean.length < 2) return null
  let sum = 0
  for (let i = 1; i < clean.length; i++) sum += Math.abs(clean[i] - clean[i - 1])
  return sum / (clean.length - 1)
}

export const HOUR_BUCKETS = 24
const HOUR_SECONDS = 3600

function hourSlots(count = HOUR_BUCKETS): number[] {
  const nowHour = Math.floor(Date.now() / 1000 / HOUR_SECONDS) * HOUR_SECONDS
  return Array.from({ length: count }, (_, index) => nowHour - (count - 1 - index) * HOUR_SECONDS)
}

function hourlyBuckets(points: PingPoint[], fallbackLoss: number, slots: number[]): LatencyHour[] {
  const byHour = new Map<number, { lat: number; latN: number; loss: number; lossN: number }>()
  for (const point of points) {
    const hour = Math.floor(point.ts / HOUR_SECONDS) * HOUR_SECONDS
    const row = byHour.get(hour) ?? { lat: 0, latN: 0, loss: 0, lossN: 0 }
    if (point.latency !== null) {
      row.lat += point.latency
      row.latN++
    }
    row.loss += point.loss ?? fallbackLoss
    row.lossN++
    byHour.set(hour, row)
  }
  return slots.map((ts) => {
    const row = byHour.get(ts)
    return { ts, latency: row && row.latN > 0 ? row.lat / row.latN : null, loss: row && row.lossN > 0 ? row.loss / row.lossN : null }
  })
}

export function mergeHours(probes: ProbeStat[], slots: number[]): LatencyHour[] {
  return slots.map((ts, index) => {
    let latSum = 0
    let latN = 0
    let lossSum = 0
    let lossN = 0
    for (const probe of probes) {
      const hour = probe.hours[index]
      if (!hour) continue
      if (hour.latency !== null) {
        latSum += hour.latency
        latN++
      }
      if (hour.loss !== null) {
        lossSum += hour.loss
        lossN++
      }
    }
    return { ts, latency: latN > 0 ? latSum / latN : null, loss: lossN > 0 ? lossSum / lossN : null }
  })
}

function mean(values: number[]): number | null {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

export function summarizePing(history: History): Latency {
  const sorted = [...(history.ping ?? [])].sort((a, b) => a.ts - b.ts)
  const byProbe = new Map<number, PingPoint[]>()
  for (const point of sorted) {
    const list = byProbe.get(point.task_id)
    if (list) list.push(point)
    else byProbe.set(point.task_id, [point])
  }

  const slots = hourSlots()
  const probes: ProbeStat[] = []
  for (const [id, points] of byProbe) {
    const values = points.map((point) => point.latency)
    const clean = values.filter((value): value is number => value !== null)
    const loss = history.loss?.[String(id)] ?? (points[points.length - 1]?.latency === null ? 100 : 0)
    const hours = hourlyBuckets(points, loss, slots)
    const lats = hours.map((hour) => hour.latency).filter((value): value is number => value !== null)
    const losses = hours.map((hour) => hour.loss).filter((value): value is number => value !== null)
    probes.push({
      id,
      name: history.probes?.[String(id)] ?? `探测 ${id}`,
      latency: points[points.length - 1]?.latency ?? null,
      jitter: jitterOf(values),
      loss,
      min: clean.length > 0 ? Math.min(...clean) : null,
      max: clean.length > 0 ? Math.max(...clean) : null,
      hours,
      avgLatency: mean(lats),
      avgLoss: mean(losses),
    })
  }

  const hours = mergeHours(probes, slots)
  const avgLatency = mean(hours.map((hour) => hour.latency).filter((value): value is number => value !== null))
  const avgLoss = mean(hours.map((hour) => hour.loss).filter((value): value is number => value !== null))
  const alive = probes.filter((probe) => probe.latency !== null)
  const pick = alive.reduce<ProbeStat | null>((best, probe) => best === null || (probe.latency as number) < (best.latency as number) ? probe : best, null)

  const day = { dayRx: history.dayRx ?? null, dayTx: history.dayTx ?? null }
  if (probes.length === 0) return { latency: null, loss: 0, probe: "", jitter: null, probes, hours, avgLatency, avgLoss, none: true, ...day }
  if (!pick) return { latency: null, loss: 100, probe: probes[0].name, jitter: probes[0].jitter, probes, hours, avgLatency, avgLoss, ...day }
  return { latency: pick.latency, loss: pick.loss, probe: pick.name, jitter: pick.jitter, probes, hours, avgLatency, avgLoss, ...day }
}

const CONCURRENCY = 2

export function useLatency(nodes: Node[] | null): LatencyMap {
  const [stats, setStats] = useState<LatencyMap>({})
  const ids = useMemo(
    () => (nodes ?? []).filter((node) => node.online).map((node) => node.id).sort().join(","),
    [nodes],
  )
  const probeMetaKey = (nodes ?? []).map((node) => `${node.id}:${node.probes.map((probe) => `${probe.id}=${probe.name}`).join(",")}`).join("|")
  const probeMap = useMemo(
    () => new Map((nodes ?? []).map((node) => [node.id, { probes: node.probes, names: node.probes.map(({ id, name }) => ({ id, name })) }])),
    [probeMetaKey],
  )

  useEffect(() => {
    if (!ids) return
    const targets = ids.split(",").filter(Boolean)
    const queue: string[] = []
    let running = 0
    let stopped = false

    const pump = () => {
      if (stopped) return
      while (running < CONCURRENCY && queue.length > 0) {
        const id = queue.shift()!
        const meta = probeMap.get(id)
        running++
        fetchHistory(id, 24, "ping", 288, meta?.names ?? [], meta?.probes ?? [])
          .then((history) => {
            if (!stopped) setStats((current) => ({ ...current, [id]: summarizePing(history) }))
          })
          .catch(() => {
            if (!stopped) setStats((current) => ({ ...current, [id]: { latency: null, loss: 0, probe: "", jitter: null, probes: [], hours: [], avgLatency: null, avgLoss: null, failed: true } }))
          })
          .finally(() => {
            running--
            pump()
          })
      }
    }

    const enqueue = () => {
      for (const id of targets) if (!queue.includes(id)) queue.push(id)
      pump()
    }

    enqueue()
    const timer = setInterval(enqueue, 60_000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [ids, probeMetaKey])

  return stats
}
