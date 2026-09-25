/// <reference types="node" />
import assert from "node:assert/strict"
import { applyBatchUpdate, mergeHours, normalizeServer, parseTrafficLimit, safeNodes, summarizePing, type History, type Node, type PingPoint, type ProbeStat } from "./api.ts"

const MB = 1024 * 1024

const baseNode: Node = {
  id: "00000000-0000-4000-8000-000000000001", name: "node", sort: 0, public: true, online: false,
  country: "", last_seen: 0, metrics: { uptime: 100, cpu: 1, load: [0.1, 0.2, 0.3],
    mem_total: 1024, mem_used: 512, swap_total: 0, swap_used: 0, disk_total: 2048, disk_used: 1024,
    net_rx: 10, net_tx: 20, total_rx: 100, total_tx: 200, month_rx: 50, month_tx: 100,
    tcp: 3, udp: 4, procs: 20 },
  os: "", kernel: "", arch: "", virt: "", cpu_name: "", cpu_cores: 1, mem_total: 1024, swap_total: 0,
  disk_total: 2048, agent_version: "", price: 0, currency: "USD", billing_cycle: "monthly", expires_at: null,
  traffic_limit: 0, traffic_mode: "sum", traffic_reset_day: 1, total_rx: 100, total_tx: 200,
  month_rx: 50, month_tx: 100, month_start: "", day_rx: 100, day_tx: 200, probes: [],
}
const node = baseNode
assert.equal(safeNodes([node])[0], node)
for (const patch of [{ load: null }, { load: [1, "bad", 3] }, { cpu: "bad" }, { net_rx: Infinity }]) {
  const bad = { ...node, metrics: { ...node.metrics, ...patch } } as unknown as Node
  const result = safeNodes([bad, node])
  assert.equal(result[0].metrics, null)
  assert.equal(result[1], node)
}

const now = Date.now()
const normalized = normalizeServer({
  id: "00000000-0000-4000-8000-000000000002",
  name: "probe", last_updated: now, boot_time: String(now - 60_000),
  ram_total: 2048, ram_used: 1024, swap_total: 512, swap_used: 256,
  disk_total: 10240, disk_used: 5120, cpu_cores: 4, net_in_speed: 100, net_out_speed: 50,
  net_rx: 1000, net_tx: 2000, net_rx_monthly: 3000, net_tx_monthly: 4000,
  load_avg: "0.1 0.2 0.3", traffic_limit: "2TB", traffic_calc_type: "max",
  billing_cycle: "year", currency: "¥", price: "12.5", expire_date: "2026-12-31",
  probes: [
    { id: "ct", name: "电信", ping: 20, loss: 0 },
    { id: "node_20", name: "东京 20", ping: 35, loss: 1 },
  ],
})
assert.equal(normalized.id, "00000000-0000-4000-8000-000000000002")
assert.equal(normalized.online, true)
assert.equal(normalized.mem_total, 2 * 1024 * 1024 * 1024)
assert.equal(normalized.metrics?.mem_used, 1024 * 1024 * 1024)
assert.equal(normalized.disk_total, 10 * 1024 * 1024 * 1024)
assert.equal(normalized.metrics?.disk_used, 5120 * 1024 * 1024)
assert.equal(normalized.traffic_limit, 2 * 1024 ** 4)
assert.equal(normalized.billing_cycle, "yearly")
assert.equal(normalized.currency, "CNY")
assert.equal(normalized.probes.length, 2)
assert.equal(normalized.probes[1].id, "node_20")
assert.equal(normalized.metrics?.net_rx, 100)
assert.equal(normalized.metrics?.load[2], 0.3)

assert.equal(parseTrafficLimit("1TB"), 1024 ** 4)
assert.equal(parseTrafficLimit("500GB/mo"), 500 * 1024 ** 3)
assert.equal(parseTrafficLimit(""), 0)
assert.equal(parseTrafficLimit(100), 100 * 1024 ** 3)

const mergedSlots = normalizeServer({
  id: "00000000-0000-4000-8000-000000000004", name: "slots", last_updated: now,
  ram_total: 1024, ram_used: 512, disk_total: 10240, disk_used: 1024, cpu_cores: 1,
  ping_ct: 10, ping_cu: 11, ping_cm: 12, ping_bd: 13, ping_node_1: 14, ping_node_2: 15, ping_node_3: 16, ping_node_4: 17,
  custom_ct: "1.1.1.1", custom_cu: "1.1.1.1", custom_cm: "1.1.1.1", custom_bd: "1.1.1.1",
  node_1: "1.1.1.1", node_2: "1.1.1.1", node_3: "1.1.1.1", node_4: "1.1.1.1", node_5: "0", node_6: "",
  probes: [{ id: "node_20", name: "扩展 20", ping: 20, loss: 0 }],
})
assert.equal(mergedSlots.probes.length, 9)
assert.equal(mergedSlots.probes[0].id, "ct")
assert.equal(mergedSlots.probes[7].id, "node_4")
assert.equal(mergedSlots.probes[8].id, "node_20")
assert.equal(mergedSlots.probes.some((probe) => probe.id === "node_5"), false)
assert.equal(mergedSlots.probes.some((probe) => probe.id === "node_6"), false)

const old = normalizeServer({
  id: "00000000-0000-4000-8000-000000000003", name: "old", last_updated: now - 1000,
  boot_time: String(now - 10_000), ram_total: 1024, ram_used: 512, swap_total: 128, swap_used: 64,
  disk_total: 10240, disk_used: 2048, cpu_cores: 2, cpu_info: "CPU A", os: "Debian 12",
  kernel_version: "6.1", arch: "x86_64", net_in_speed: 10, net_out_speed: 20,
  net_rx: 100, net_tx: 200, net_rx_monthly: 300, net_tx_monthly: 400,
  load_avg: "0.1 0.2 0.3", traffic_limit: 100, traffic_calc_type: "total", show_traffic: false,
  probes: [{ id: "ct", name: "电信", ping: 20, loss: 0 }],
})
const updated = applyBatchUpdate(old, { cpu: 55, ram_used: 700, net_in_speed: 900, ping_ct: 31 }, now, 300)
assert.equal(updated.name, "old")
assert.equal(updated.os, "Debian 12")
assert.equal(updated.kernel, "6.1")
assert.equal(updated.cpu_cores, 2)
assert.equal(updated.metrics?.cpu, 55)
assert.equal(updated.metrics?.mem_used, 700 * MB)
assert.equal(updated.metrics?.net_rx, 900)
assert.equal(updated.metrics?.net_tx, 20)
assert.equal(updated.probes[0].ping, 31)
assert.equal(updated.probes[0].name, "电信")
assert.equal(updated.metrics?.uptime, 10)
assert.equal(updated.traffic_limit, 100 * 1024 ** 3)
assert.equal(updated.traffic_mode, "sum")
assert.equal(updated.show_traffic, false)
console.log("坏报告不会拖垮整页")

function history(ping: PingPoint[], loss: Record<string, number> = {}): History {
  return { metrics: [], ping, probes: { "1": "东京", "2": "洛杉矶" }, loss }
}

const best = summarizePing(history([
  { task_id: 1, ts: 100, latency: 80 },
  { task_id: 1, ts: 200, latency: 60 },
  { task_id: 2, ts: 100, latency: 120 },
], { "1": 5 }))
assert.equal(best.latency, 60)
assert.equal(best.probe, "东京")
assert.equal(best.loss, 5)

const empty = summarizePing(history([]))
assert.equal(empty.none, true)
assert.equal(empty.latency, null)

const timeout = summarizePing(history([{ task_id: 3, ts: 1, latency: null }]))
assert.equal(timeout.latency, null)
assert.equal(timeout.loss, 100)

const lastWins = summarizePing(history([
  { task_id: 1, ts: 100, latency: 10 },
  { task_id: 1, ts: 200, latency: null },
]))
assert.equal(lastWins.latency, null)
assert.equal(lastWins.loss, 100)

const fastest = summarizePing(history([
  { task_id: 1, ts: 100, latency: 30 },
  { task_id: 2, ts: 100, latency: 40 },
]))
assert.equal(fastest.latency, 30)
assert.equal(fastest.probe, "东京")

console.log("延迟摘要取每个探测的最新样本")

const jittered = summarizePing(history([
  { task_id: 1, ts: 100, latency: 20 },
  { task_id: 1, ts: 200, latency: 40 },
  { task_id: 1, ts: 300, latency: 30 },
]))
assert.equal(jittered.jitter, 15)
assert.equal(jittered.probes.length, 1)
assert.equal(jittered.probes[0].min, 20)
assert.equal(jittered.probes[0].max, 40)
assert.equal(jittered.probes[0].latency, 30)

const multi = summarizePing(history([
  { task_id: 1, ts: 100, latency: 50 },
  { task_id: 2, ts: 100, latency: 80 },
  { task_id: 2, ts: 200, latency: null },
], { "2": 25 }))
assert.equal(multi.probes.length, 2)
assert.equal(multi.latency, 50)
assert.equal(multi.jitter, null)
const second = multi.probes.find((p) => p.id === 2)
assert.equal(second?.latency, null)
assert.equal(second?.loss, 25)

console.log("多探测摘要带波动、丢包与区间")

const hour = Math.floor(Date.now() / 1000 / 3600) * 3600
const hourly = summarizePing(history([
  { task_id: 1, ts: hour + 10, latency: 40 },
  { task_id: 1, ts: hour + 20, latency: 60 },
]))
assert.equal(hourly.probes[0].hours.length, 24)
assert.equal(hourly.probes[0].hours[23].latency, 50)
assert.equal(hourly.probes[0].hours[23].loss, 0)
assert.equal(hourly.probes[0].hours[0].latency, null)
assert.equal(hourly.probes[0].avgLatency, 50)

const hourlyLoss = summarizePing(history([
  { task_id: 2, ts: hour + 10, latency: 50, loss: 8 },
], { "2": 8 }))
assert.equal(hourlyLoss.probes[0].hours[23].loss, 8)
assert.equal(hourlyLoss.probes[0].avgLoss, 8)

console.log("小时聚合生成 24 格热力数据")

const merged = summarizePing(history([
  { task_id: 1, ts: hour + 10, latency: 40 },
  { task_id: 1, ts: hour + 20, latency: 60 },
  { task_id: 2, ts: hour + 10, latency: 120 },
  { task_id: 2, ts: hour + 20, latency: 80 },
]))
assert.equal(merged.hours.length, 24)
assert.equal(merged.hours[23].latency, 75)
assert.equal(merged.hours[0].latency, null)
assert.equal(merged.avgLatency, 75)
assert.equal(merged.avgLoss, 0)
assert.equal(merged.probes.length, 2)

const slot = (latency: number | null, loss: number | null) => ({ ts: hour, latency, loss })
const probe = (hours: { ts: number; latency: number | null; loss: number | null }[]): ProbeStat => ({
  id: 1, name: "p", latency: null, jitter: null, loss: 0, min: null, max: null, hours, avgLatency: null, avgLoss: null,
})
const averaged = mergeHours([probe([slot(20, 0)]), probe([slot(40, 20)]), probe([slot(null, null)])], [hour])
assert.equal(averaged[0].latency, 30)
assert.equal(averaged[0].loss, 10)

const gap = mergeHours([probe([slot(null, 6)])], [hour])
assert.equal(gap[0].latency, null)
assert.equal(gap[0].loss, 6)

console.log("多探测按小时均值合并为单条色带")

