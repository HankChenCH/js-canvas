/**
 * 颜色解析（对位 go-canvas/image-renderer/color.go 同式复制，注明出处；
 * go 侧先例：color/exif/qr 小件在两 module 复制，TS 侧核心包零依赖红线
 * 禁止收纳，故落本包）。wire 面与图层选项只产出 CSS 十六进制写法（PHP
 * intervention 还接受颜色名与 rgb() 函数串，本项目不使用），故仅支持 hex
 * 形态，其余报错中止渲染（原语失败即抛纪律）。
 */

/** 直 alpha 颜色分量（0–255，无预乘；对位 go color.NRGBA） */
export interface NrgbaColor {
    r: number
    g: number
    b: number
    a: number
}

/**
 * 解析十六进制颜色为直 alpha 分量。支持 #rgb / #rgba / #rrggbb / #rrggbbaa，
 * 前导 # 可省略；3/4 位逐位翻倍后走同一累积路径；6 位 alpha=255。
 * 非法长度/非法十六进制位即抛（错误消息对位 go color.go 文案）
 */
export function parseColor(s: string): NrgbaColor {
    const h = s.startsWith('#') ? s.slice(1) : s
    let hex: string
    switch (h.length) {
        case 3:
        case 4: {
            // 逐位翻倍：#f00 → ff0000
            hex = Array.from(h, (ch) => ch + ch).join('')
            break
        }
        case 6:
        case 8:
            hex = h
            break
        default:
            throw new Error(`无法解析颜色 ${JSON.stringify(s)}: 支持 #rgb/#rgba/#rrggbb/#rrggbbaa`)
    }

    const c = [0, 0, 0, 0]
    for (let i = 0; i < hex.length; i += 1) {
        c[i / 2 | 0] = c[i / 2 | 0]! * 16 + hexDigit(hex[i]!, s)
    }
    if (hex.length === 6) {
        c[3] = 255
    }
    return { r: c[0]!, g: c[1]!, b: c[2]!, a: c[3]! }
}

function hexDigit(ch: string, source: string): number {
    const code = ch.charCodeAt(0)
    if (code >= 0x30 && code <= 0x39) return code - 0x30 // 0-9
    if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10 // a-f
    if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10 // A-F
    throw new Error(`无法解析颜色 ${JSON.stringify(source)}: 非法十六进制位 ${JSON.stringify(ch)}`)
}

/**
 * napi canvas fillStyle 字符串（css rgba() 函数式，alpha 归一到 0–1）。
 * canvas 2D 默认 source-over 合成 = go draw.Over 同语义（后画覆盖先画）
 */
export function cssColor(c: NrgbaColor): string {
    return `rgba(${c.r},${c.g},${c.b},${c.a / 255})`
}
