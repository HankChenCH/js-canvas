/**
 * 颜色解析：wire 面与图层选项只产出 CSS 十六进制写法（PHP intervention 还接受
 * 颜色名与 rgb() 函数串，本项目不使用），故仅支持 hex 形态，其余报错中止渲染。
 *
 * 与 go-canvas pdf-renderer/color.go（及其引用的 image-renderer color.go）同一公式
 * 的小件复制——几何/颜色契约的一部分，多后端防线必须对称（AGENTS.md 包依赖红线
 * 第四款：共享小件同式复制并注明出处，两包互不 import）。
 */

/** 直 alpha 的 8 位色（go rgba 对位；PDF 面只经 fillColor/fillOpacity 两缝消费） */
export interface Rgba {
    r: number
    g: number
    b: number
    a: number
}

/**
 * parseColor 解析十六进制颜色为直 alpha 的 rgba。
 * 支持 #rgb / #rgba / #rrggbb / #rrggbbaa，前导 # 可省略；3/4 位逐位翻倍后走同一累积路径。
 * 非法输入报错中止（失败即抛纪律：渲染面丢弃、无产物逃逸）。
 */
export function parseColor(s: string): Rgba {
    const h = s.startsWith('#') ? s.slice(1) : s
    let hex: string
    switch (h.length) {
        case 3:
        case 4:
            hex = Array.from(h, (ch) => ch + ch).join('') // 逐位翻倍：#f00 → ff0000
            break
        case 6:
        case 8:
            hex = h
            break
        default:
            throw new Error(`无法解析颜色 "${s}": 支持 #rgb/#rgba/#rrggbb/#rrggbbaa`)
    }

    const c = [0, 0, 0, 0]
    for (let i = 0; i < hex.length; i += 1) {
        const v = hexDigit(hex[i]!)
        if (v === null) {
            throw new Error(`无法解析颜色 "${s}": 非法十六进制位 "${hex[i]}"`)
        }
        c[Math.floor(i / 2)] = c[Math.floor(i / 2)]! * 16 + v
    }
    if (hex.length === 6) {
        c[3] = 255
    }
    return { r: c[0]!, g: c[1]!, b: c[2]!, a: c[3]! }
}

function hexDigit(ch: string | undefined): number | null {
    if (ch === undefined) return null
    const code = ch.charCodeAt(0)
    if (code >= 0x30 && code <= 0x39) return code - 0x30 // 0-9
    if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10 // a-f
    if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10 // A-F
    return null
}
