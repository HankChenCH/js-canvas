/**
 * 后端原语的点位取样单元测试（go backend_test.go 移植面）：直接驱动五原语，
 * 锁定 begin/end 透明底产物、drawRect 背景/边框像素语义、drawImage 的
 * blit 放置/裁窗/EXIF 次序/静默防护与 imageIntrinsicSize 查询面。
 * 插值核明确不复刻（napi 平滑 vs go CatmullRom），取样点远离分界并放宽容差。
 */
import { describe, expect, it } from 'vitest'

import {
    canvasJpeg,
    canvasPng,
    decodePixels,
    expectPixelNear,
    jpegWithExifOrientation,
    makeCanvas,
    tempFixtureDir,
    writeFixture,
    type Pixels,
} from './helpers'
import { ImageRendererBackend } from '../src/backend'

const RED = [255, 0, 0, 255] as const
const GREEN = [0, 255, 0, 255] as const
const BLUE = [0, 0, 255, 255] as const
const WHITE = [255, 255, 255, 255] as const
const CLEAR = [0, 0, 0, 0] as const

function solidPng(w: number, h: number, color: readonly number[]): Uint8Array {
    const { canvas, ctx } = makeCanvas(w, h)
    ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${(color[3] ?? 255) / 255})`
    ctx.fillRect(0, 0, w, h)
    return canvasPng(canvas)
}

/** 40×40 四象限：左上红 / 右上绿 / 左下蓝 / 右下洋红（分界在 20） */
function quadPng(): Uint8Array {
    const { canvas, ctx } = makeCanvas(40, 40)
    ctx.fillStyle = 'rgb(255,0,0)'
    ctx.fillRect(0, 0, 20, 20)
    ctx.fillStyle = 'rgb(0,255,0)'
    ctx.fillRect(20, 0, 20, 20)
    ctx.fillStyle = 'rgb(0,0,255)'
    ctx.fillRect(0, 20, 20, 20)
    ctx.fillStyle = 'rgb(255,0,255)'
    ctx.fillRect(20, 20, 20, 20)
    return canvasPng(canvas)
}

/** 20×10 双色横条：左红右蓝，分界列在 x=10（拉伸无关等比用例） */
function twoColorPng(): Uint8Array {
    const { canvas, ctx } = makeCanvas(20, 10)
    ctx.fillStyle = 'rgb(255,0,0)'
    ctx.fillRect(0, 0, 10, 10)
    ctx.fillStyle = 'rgb(0,0,255)'
    ctx.fillRect(10, 0, 10, 10)
    return canvasPng(canvas)
}

/** 8×16 上红下蓝、带指定 EXIF orientation 的 JPEG 落盘（EXIF 集成共用夹具） */
function twoBandExifJpegFile(dir: string, orientation: number): string {
    const { canvas, ctx } = makeCanvas(8, 16)
    ctx.fillStyle = 'rgb(255,0,0)'
    ctx.fillRect(0, 0, 8, 8)
    ctx.fillStyle = 'rgb(0,0,255)'
    ctx.fillRect(0, 8, 8, 8)
    const data = jpegWithExifOrientation(canvasJpeg(canvas), 'II', 3, orientation)
    return writeFixture(dir, `exif-rotated-${orientation}.jpg`, data)
}

/** end 产物 → PNG 魔数 + 可解码位图（验收面：字节面 + 像素取样） */
async function sampleProduct(product: unknown): Promise<Pixels> {
    expect(product).toBeInstanceOf(Uint8Array)
    const bytes = product as Uint8Array
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]) // PNG 魔数
    return decodePixels(bytes)
}

describe('begin/end 透明底产物（对位 go Begin/End + *image.NRGBA）', () => {
    it('begin 建面 → end 产出透明底 PNG 字节', async () => {
        const backend = new ImageRendererBackend()
        backend.begin(20, 20)
        const px = await sampleProduct(backend.end())
        expect(px.width).toBe(20)
        expect(px.height).toBe(20)
        expectPixelNear(px, 10, 10, CLEAR)
    })

    it('尺寸非法即抛（渲染面尺寸非法）', () => {
        const backend = new ImageRendererBackend()
        expect(() => backend.begin(0, 10)).toThrow(/渲染面尺寸非法/)
        expect(() => backend.begin(-1, -1)).toThrow(/渲染面尺寸非法/)
    })

    it('未建面 end 返回 null（对位 go 字面 nil；核心 assertProduct 报产物缺失）', () => {
        expect(new ImageRendererBackend().end()).toBeNull()
    })

    it('未建面即调原语报错（对位 go face() 防线）', () => {
        const backend = new ImageRendererBackend()
        expect(() => backend.drawRect(0, 0, 5, 5, '#fff', { top: null, bottom: null, left: null, right: null })).toThrow(
            /位图渲染面未初始化/,
        )
        expect(() =>
            backend.drawImage('x.png', { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 5, height: 5 }),
        ).toThrow(/位图渲染面未初始化/)
    })

    it('同一实例 Begin 即重置（实例可跨渲染复用）', async () => {
        const backend = new ImageRendererBackend()
        backend.begin(10, 10)
        backend.drawRect(0, 0, 10, 10, '#f00', { top: null, bottom: null, left: null, right: null })
        backend.begin(20, 20)
        const px = await sampleProduct(backend.end())
        expect(px.width).toBe(20)
        expectPixelNear(px, 5, 5, CLEAR) // 旧面不残留
    })
})

describe('drawRect 背景与盒内嵌边框带（go TestDrawRect* 互检）', () => {
    it('背景 + 四边内嵌带', async () => {
        const backend = new ImageRendererBackend()
        backend.begin(20, 20)
        const side = { width: 2, color: '#f00' }
        backend.drawRect(0, 0, 20, 20, '#fff', { top: side, bottom: side, left: side, right: side })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 10, 10, WHITE) // 内部保持背景
        // 边框 = 四边各一条线宽=边框宽的直线（非描边矩形），按盒内嵌绘制
        expectPixelNear(px, 10, 1, RED) // top 带覆盖 y ∈ [0, 2)
        expectPixelNear(px, 10, 18, RED) // bottom 带覆盖 y ∈ [18, 20)
        expectPixelNear(px, 1, 10, RED) // left 带覆盖 x ∈ [0, 2)
        expectPixelNear(px, 18, 10, RED) // right 带覆盖 x ∈ [18, 20)
        expectPixelNear(px, 1, 1, RED) // 角部落交叉带
    })

    it('null 背景 / 未设边跳过', async () => {
        const backend = new ImageRendererBackend()
        backend.begin(20, 20)
        backend.drawRect(0, 0, 20, 20, null, { top: { width: 3, color: '#00f' }, bottom: null, left: null, right: null })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 10, 1, BLUE) // 仅 top 边
        expectPixelNear(px, 10, 10, CLEAR) // 背景 null 跳过填充，保持透明
        expectPixelNear(px, 1, 10, CLEAR) // 未设的 left 边
        expectPixelNear(px, 10, 19, CLEAR) // 未设的 bottom 边
    })

    it('空串背景同 null 跳过（PHP 同款守卫）', async () => {
        const backend = new ImageRendererBackend()
        backend.begin(20, 20)
        backend.drawRect(0, 0, 20, 20, '', { top: null, bottom: null, left: null, right: null })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 10, 10, CLEAR)
    })

    it('非法颜色报错中止（背景/边框独立解析）', () => {
        const backend = new ImageRendererBackend()
        backend.begin(20, 20)
        const noBorder = { top: null, bottom: null, left: null, right: null }
        expect(() => backend.drawRect(0, 0, 20, 20, 'nope', noBorder)).toThrow(/无法解析颜色/)
        expect(() =>
            backend.drawRect(0, 0, 20, 20, '#fff', { top: { width: 1, color: 'bogus' }, bottom: null, left: null, right: null }),
        ).toThrow(/解析边框色/)
    })

    it('wire 可注入的零宽边不计（width≤0）', async () => {
        const backend = new ImageRendererBackend()
        backend.begin(20, 20)
        backend.drawRect(0, 0, 20, 20, null, { top: { width: 0, color: '#f00' }, bottom: null, left: null, right: null })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 10, 0, CLEAR)
    })

    it('线宽大于盒高/盒宽时 bottom/right 带起点钳到盒原点（max 收缩）', async () => {
        const backend = new ImageRendererBackend()
        backend.begin(6, 6)
        // 只画 bottom：带 = (x, max(y, y+h-10), …) = 整盒
        backend.drawRect(1, 1, 4, 4, null, { top: null, bottom: { width: 10, color: '#0f0' }, left: null, right: null })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 3, 3, GREEN) // 带吃满整盒
        expectPixelNear(px, 0, 0, CLEAR) // 盒外不受影响
    })
})

describe('drawImage blit（go TestDrawImage* 互检）', () => {
    it('整图哨兵：拉伸铺满目标盒', async () => {
        const dir = tempFixtureDir()
        const path = writeFixture(dir, 'solid.png', solidPng(4, 4, RED))
        const backend = new ImageRendererBackend()
        backend.begin(20, 20)
        await backend.preload(path)
        backend.drawImage(path, { x: 0, y: 0, width: 0, height: 0 }, { x: 2, y: 3, width: 6, height: 6 })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 2, 3, RED, 60)
        expectPixelNear(px, 7, 8, RED, 60)
        expectPixelNear(px, 1, 3, CLEAR)
        expectPixelNear(px, 7, 9, CLEAR)
    })

    it('窗口 blit：只取 srcRect 子矩形搬运，窗外不参与', async () => {
        const dir = tempFixtureDir()
        const path = writeFixture(dir, 'quad.png', quadPng())
        const backend = new ImageRendererBackend()
        backend.begin(20, 20)
        await backend.preload(path)
        backend.drawImage(path, { x: 0, y: 0, width: 20, height: 20 }, { x: 0, y: 0, width: 10, height: 10 })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 5, 5, RED, 60)
        expectPixelNear(px, 0, 0, RED, 60)
        expectPixelNear(px, 9, 9, RED, 60)
        expectPixelNear(px, 10, 5, CLEAR) // 窗外不参与
        expectPixelNear(px, 5, 10, CLEAR)
    })

    it('拉伸无关等比（fill 形态的后端落点）', async () => {
        const dir = tempFixtureDir()
        const path = writeFixture(dir, 'two.png', twoColorPng())
        const backend = new ImageRendererBackend()
        backend.begin(20, 20)
        await backend.preload(path)
        backend.drawImage(path, { x: 0, y: 0, width: 20, height: 10 }, { x: 0, y: 0, width: 20, height: 20 })
        const px = await sampleProduct(backend.end())
        for (const [x, y] of [[2, 0], [7, 5], [2, 19]] as const) expectPixelNear(px, x, y, RED, 60)
        for (const [x, y] of [[12, 5], [17, 0], [17, 19]] as const) expectPixelNear(px, x, y, BLUE, 60)
    })

    it('dstRect 尺寸 ≤0 防护只跳过，且防护先于读取（src 不可读也不抛）', async () => {
        const backend = new ImageRendererBackend()
        backend.begin(20, 20)
        backend.drawImage('/nonexistent/go-canvas-fixture.png', { x: 0, y: 0, width: 4, height: 4 }, { x: 0, y: 0, width: 0, height: 5 })
        backend.drawImage('/nonexistent/go-canvas-fixture.png', { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 5, height: -1 })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 5, 5, CLEAR)
    })

    it('src 查不到/解码失败静默不画（TS 契约缺省约定；偏离 go 报错中止，见 drawImage docblock）', async () => {
        const dir = tempFixtureDir()
        const broken = writeFixture(dir, 'broken.png', new Uint8Array([100, 101, 102, 103]))
        const backend = new ImageRendererBackend()
        backend.begin(20, 20)
        await backend.preload('/nonexistent/go-canvas-fixture.png')
        await backend.preload(broken)
        backend.drawImage('/nonexistent/go-canvas-fixture.png', { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 5, height: 5 })
        backend.drawImage(broken, { x: 0, y: 0, width: 0, height: 0 }, { x: 10, y: 0, width: 5, height: 5 })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 2, 2, CLEAR)
        expectPixelNear(px, 12, 2, CLEAR)
    })

    it('setImage 登记键：命中登记字节（qr: 键与物化资源同门）', async () => {
        const backend = new ImageRendererBackend()
        backend.begin(10, 10)
        backend.setImage('qr:hello', solidPng(4, 4, GREEN))
        await backend.preload('qr:hello')
        backend.drawImage('qr:hello', { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 8, height: 8 })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 4, 4, GREEN, 60)
        expectPixelNear(px, 9, 9, CLEAR)
    })

    it('data URL src 直读', async () => {
        const base64 = Buffer.from(solidPng(4, 4, RED)).toString('base64')
        const backend = new ImageRendererBackend()
        backend.begin(10, 10)
        await backend.preload(`data:image/png;base64,${base64}`)
        backend.drawImage(`data:image/png;base64,${base64}`, { x: 0, y: 0, width: 0, height: 0 }, { x: 1, y: 1, width: 8, height: 8 })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 5, 5, RED, 60)
    })

    it('EXIF o=6 整图哨兵：8×16 上红下蓝 → 观察 16×8 左蓝右红（go 互检）', async () => {
        const path = twoBandExifJpegFile(tempFixtureDir(), 6)
        const backend = new ImageRendererBackend()
        backend.begin(20, 20)
        await backend.preload(path)
        backend.drawImage(path, { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 16, height: 8 })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 0, 1, BLUE, 60) // 观察方向左半 = 原下缘
        expectPixelNear(px, 15, 6, RED, 60) // 观察方向右半 = 原上缘
    })

    it('EXIF o=6 窗口 blit 在内在坐标：下半窗（蓝带）→ 转正后蓝块（go 互检）', async () => {
        const path = twoBandExifJpegFile(tempFixtureDir(), 6)
        const backend = new ImageRendererBackend()
        backend.begin(20, 20)
        await backend.preload(path)
        backend.drawImage(path, { x: 0, y: 8, width: 8, height: 8 }, { x: 0, y: 0, width: 10, height: 10 })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 2, 5, BLUE, 60)
        expectPixelNear(px, 8, 5, BLUE, 60)
    })
})

describe('imageIntrinsicSize 查询面（raw 内在尺寸，混合口径查询侧）', () => {
    it('PNG 路径：canonical == raw（无 EXIF）', () => {
        const dir = tempFixtureDir()
        const path = writeFixture(dir, 'plain.png', solidPng(6, 3, GREEN))
        const backend = new ImageRendererBackend()
        expect(backend.imageIntrinsicSize!(path)).toEqual({ width: 6, height: 3 })
    })

    it('EXIF o=6 JPEG：≥5 互换返 raw 尺寸 8×16（napi canonical 为 16×8）', () => {
        const path = twoBandExifJpegFile(tempFixtureDir(), 6)
        const backend = new ImageRendererBackend()
        expect(backend.imageIntrinsicSize!(path)).toEqual({ width: 8, height: 16 })
    })

    it('preload 路径同收敛 raw 尺寸（canonical 缓存经 ≥5 互换）', async () => {
        const path = twoBandExifJpegFile(tempFixtureDir(), 6)
        const backend = new ImageRendererBackend()
        await backend.preload(path)
        expect(backend.imageIntrinsicSize!(path)).toEqual({ width: 8, height: 16 })
    })

    it('登记键命中走字节', () => {
        const backend = new ImageRendererBackend()
        backend.setImage('qr:abc', solidPng(5, 7, BLUE))
        expect(backend.imageIntrinsicSize!('qr:abc')).toEqual({ width: 5, height: 7 })
    })

    it('查不到/损坏 → null（契约降级 fill 形态）', () => {
        const dir = tempFixtureDir()
        const broken = writeFixture(dir, 'broken.png', new Uint8Array([1, 2, 3]))
        const backend = new ImageRendererBackend()
        expect(backend.imageIntrinsicSize!('/nonexistent/go-canvas-fixture.png')).toBeNull()
        expect(backend.imageIntrinsicSize!(broken)).toBeNull()
    })
})

describe('preload 异步预备缝（napi 位图同步不可得的装配前提）', () => {
    it('可解码 src 预备成功，查不到/损坏返回 false', async () => {
        const dir = tempFixtureDir()
        const path = writeFixture(dir, 'ok.png', solidPng(2, 2, RED))
        const broken = writeFixture(dir, 'broken.png', new Uint8Array([9, 9, 9]))
        const backend = new ImageRendererBackend()
        expect(await backend.preload(path)).toBe(true)
        expect(await backend.preload('/nonexistent/go-canvas-fixture.png')).toBe(false)
        expect(await backend.preload(broken)).toBe(false)
    })

    it('未 preload 直接 drawImage：静默不画（同步原语消费不到未装配位图）', async () => {
        const dir = tempFixtureDir()
        const path = writeFixture(dir, 'solid.png', solidPng(4, 4, RED))
        const backend = new ImageRendererBackend()
        backend.begin(10, 10)
        backend.drawImage(path, { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 5, height: 5 })
        const px = await sampleProduct(backend.end())
        expectPixelNear(px, 2, 2, CLEAR)
    })
})
