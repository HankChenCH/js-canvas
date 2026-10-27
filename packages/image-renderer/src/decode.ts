/**
 * 图片字节装载与解码（对位 go decode.go + blitSource 共享前段的读源半边）：
 * 三源依次查——登记表（setImage 键，`qr:` 前缀与物化资源同门）→ data URL →
 * 本地路径。远程 URL 不进原语同步路径（网络 I/O 归 ResourceResolver 物化，
 * 未物化的远程引用按查不到处置）。
 */
import { Image, loadImage, type Image as NapiImage } from '@napi-rs/canvas'
import { readFileSync } from 'node:fs'

/** 登记面最小结构（ImageRendererBackend 的 setImage 登记表同构，解耦复用） */
export interface ByteRegistry {
    get(key: string): Uint8Array | undefined
}

/**
 * 按引用装载图片字节：登记表命中优先；data URL 仅支持 base64 形态；其余按
 * 本地路径读盘（文件视为渲染会话内不可变，对位 go os.ReadFile）。查不到返回
 * null——由调用方按各自契约处置（drawImage 静默不画 / imageIntrinsicSize
 * 返 null 退化 fill）
 */
export function loadSourceBytes(src: string, registry?: ByteRegistry): Uint8Array | null {
    const hit = registry?.get(src)
    if (hit) {
        return hit
    }
    if (src.startsWith('data:')) {
        const comma = src.indexOf(',')
        if (comma < 0 || !src.slice(0, comma).endsWith(';base64')) {
            return null
        }
        return new Uint8Array(Buffer.from(src.slice(comma + 1), 'base64'))
    }
    // 带 scheme 的远程引用静默不装（Windows 盘符路径非本仓宿主面）；本地路径读盘
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(src)) {
        return null
    }
    try {
        return new Uint8Array(readFileSync(src))
    } catch {
        return null
    }
}

/**
 * 同步头部尺寸探测：napi Image 的 width/height 在 src 赋值后同步可得（位图
 * raster 才需 await decode）。损坏/空字节 width 归 0 → null。
 *
 * 实测钉死（1.0.13，精确钉版 + exif 测试互检）：同步 width/height 是 **raw**
 * （EXIF 转正前）的头尺寸——转正发生在异步解码的 raster 阶段（async loadImage
 * 出 canonical 位图）。故本探测结果直返即查询面要的 raw 内在尺寸，无需再按
 * orientation 换算（见 backend.imageIntrinsicSize 两路收敛注释）
 */
export function decodeHeaderSize(bytes: Uint8Array): { width: number; height: number } | null {
    const img = new Image()
    img.src = Buffer.from(bytes)
    if (img.width <= 0 || img.height <= 0) {
        return null
    }
    return { width: img.width, height: img.height }
}

/**
 * 异步解码出可绘制位图（napi 实测 1.0.13：同步只出尺寸，raster 须经
 * loadImage/decode() 才可 drawImage——后端 preload 缝的实现底座）。
 * 解码失败返回 null（调用方标记该 src 静默不画）
 */
export async function decodeDrawableImage(bytes: Uint8Array): Promise<NapiImage | null> {
    try {
        return await loadImage(Buffer.from(bytes))
    } catch {
        return null
    }
}
