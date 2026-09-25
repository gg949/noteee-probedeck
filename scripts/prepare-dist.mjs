import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

const root = new URL("..", import.meta.url).pathname
const dist = join(root, "dist")
const favicon = join(root, "public", "favicon.svg")

if (existsSync(favicon)) {
  mkdirSync(join(dist, "assets"), { recursive: true })
  cpSync(favicon, join(dist, "assets", "favicon.svg"))
}

const html = join(dist, "index.html")
if (!existsSync(html)) throw new Error("dist/index.html 不存在")
const text = readFileSync(html, "utf8")
if (text.includes("/src/main.tsx")) throw new Error("dist/index.html 仍指向源码入口")
if (!text.includes("/assets/")) throw new Error("dist/index.html 没有 /assets/ 引用")

rmSync(join(dist, "favicon.svg"), { force: true })
console.log("ProbeDeck dist 布局检查通过")
