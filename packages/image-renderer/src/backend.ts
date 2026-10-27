/**
 * 位图渲染后端（对位 go-canvas/image-renderer/backend.go 的 Renderer）：以
 * @napi-rs/canvas 新建透明画布为渲染面，实现核心 RenderBackend 五原语接入
 * 渲染模板；承载图像登记缝（setImage）、异步预备缝（preload）、EXIF 混合口径
 * 映射与 PNG 编码（end → encodeSync('png') 透明底产物，对位 go *image.NRGBA）。
 *
 * 失败即抛纪律（核心 render.ts 文件头契约）：任一原语失败即抛——渲染面整体
 * 丢弃、end() 不达、失败后实例不复用（建面态残留，重建实例再渲染）。唯一例外
 * 是 drawImage 的 src 查不到/解码失败：核心契约的缺省约定为静默不画（JS 坏图
 * 现状 parity；对位 go 位图后端此二处报错中止——TS 侧有意从宽，两端口径见
 * drawImage/imageIntrinsicSize docblock）。
 *
 * 与 go 的结构性差异（实现形态，非语义）：napi 的 Image 同步只出尺寸、可绘制
 * 位图须经 loadImage/decode() 异步解码，而核心 drawImage 是同步原语——故后端
 * 增设 preload(src) 异步预备缝，渲染前把本次要画的 src 装配进解码缓存；同步
 * 原语只消费缓存（未装配/装配失败一律静默不画）。默认 resolver（本包
 * createDefaultResolver）物化时对访问到的每个 src 自动预热，完整管线不受影响。
 *
 * 非并发安全（对位 go）：渲染面与解码缓存按实例持有，并发渲染请各自新建实例；
 * 实例可跨多次渲染复用，begin 即重置。
 */
import { createCanvas, type Canvas as NapiCanvas, type Image as NapiImage, type SKRSContext2D } from '@napi-rs/canvas'
import type { BlitRect, Border, RenderBackend, TextDrawOptions } from '@hankchen/canvas'

import { cssColor, parseColor } from './color'
import { decodeHeaderSize, decodeDrawableImage, loadSourceBytes } from './decode'
import { canonicalSourceRect, exifOrientation, rawDimensions } from './exif'
import { registerFontData } from './typography'
import { drawTextLine } from './text'

/** 解码缓存项：位图 + 该字节的 EXIF orientation（映射缝的同步输入） */
interface DecodedEntry {
    readonly image: NapiImage
    readonly orientation: number
}

export class ImageRendererBackend implements RenderBackend {
    private surface: NapiCanvas | null = null
    private ctx: SKRSContext2D | null = null

    /** 图像登记表（核心 setImage 缝）：键 = wire src 引用（`qr:` 前缀/远程 URL/任意键） */
    private readonly registry = new Map<string, Uint8Array>()

    /** 解码缓存：键 = src 引用；null = 装配失败标记（静默不画） */
    private readonly decoded = new Map<string, DecodedEntry | null>()

    /** begin 取渲染面；未建面即调用绘制原语属用法错误（模板保证先 begin） */
    private canvasCtx(): SKRSContext2D {
        if (this.ctx === null || this.surface === null) {
            throw new Error('位图渲染面未初始化:应经渲染模板 Begin 建面')
        }
        return this.ctx
    }

    /**
     * 渲染前异步预备：解析 src（登记表/data URL/本地路径）并解码出可绘制位图进
     * 缓存。幂等；返回是否可绘制。默认 resolver 物化时逐 src 调用——手工装配
     * 后端时须自行预热，否则 drawImage 静默不画（见文件头「结构性差异」注）
     */
    async preload(src: string): Promise<boolean> {
        if (this.decoded.has(src)) {
            return this.decoded.get(src) !== null
        }
        const bytes = loadSourceBytes(src, this.registry)
        if (bytes === null) {
            this.decoded.set(src, null)
            return false
        }
        const image = await decodeDrawableImage(bytes)
        if (image === null) {
            this.decoded.set(src, null)
            return false
        }
        this.decoded.set(src, { image, orientation: exifOrientation(bytes) })
        return true
    }

    /** 创建渲染面（width/height ≤0 报错；全新透明画布，对位 image.NewNRGBA） */
    begin(width: number, height: number): void {
        if (width <= 0 || height <= 0) {
            throw new Error(`渲染面尺寸非法: ${width}x${height}`)
        }
        this.surface = createCanvas(width, height)
        this.ctx = this.surface.getContext('2d')
    }

    /** 收尾：encodeSync('png') 透明底产物；未建面返回 null（对位 go 字面 nil） */
    end(): Uint8Array | null {
        if (this.surface === null) {
            return null
        }
        return new Uint8Array(this.surface.encodeSync('png'))
    }

    /**
     * 矩形盒：背景色 + 四边边框。背景为 null 或空串跳过填充（PHP 同款守卫）；
     * 边框 = 四边各一条线宽=边框宽的直线（非描边矩形），按盒内嵌绘制，逐边可
     * null/零宽不计，序 top/bottom/left/right（PHP 绘制序，后画覆盖先画；
     * canvas source-over 合成 = go draw.Over 同语义）
     */
    drawRect(x: number, y: number, width: number, height: number, bgColor: string | null, border: Border): void {
        const ctx = this.canvasCtx()

        if (bgColor !== null && bgColor !== '') {
            ctx.fillStyle = cssColor(parseColor(bgColor))
            ctx.fillRect(x, y, width, height)
        }

        // 边框带公式与 go borderBands 逐条同式（盒内嵌；bottom/right 的 max 防越界收缩）
        const bands: Array<{ band: [number, number, number, number]; color: string }> = []
        if (border.top !== null && border.top.width > 0) {
            bands.push({ band: [x, y, width, border.top.width], color: border.top.color })
        }
        if (border.bottom !== null && border.bottom.width > 0) {
            const bandY = Math.max(y, y + height - border.bottom.width)
            bands.push({ band: [x, bandY, width, y + height - bandY], color: border.bottom.color })
        }
        if (border.left !== null && border.left.width > 0) {
            bands.push({ band: [x, y, border.left.width, height], color: border.left.color })
        }
        if (border.right !== null && border.right.width > 0) {
            const bandX = Math.max(x, x + width - border.right.width)
            bands.push({ band: [bandX, y, x + width - bandX, height], color: border.right.color })
        }
        for (const { band, color } of bands) {
            // 逐边颜色独立解析，解析失败 wrap 后上抛中止（对位 go fillEdge）
            let fill: string
            try {
                fill = cssColor(parseColor(color))
            } catch (error) {
                throw new Error(`解析边框色: ${(error as Error).message}`)
            }
            ctx.fillStyle = fill
            ctx.fillRect(band[0], band[1], band[2], band[3])
        }
    }

    /**
     * 图片双矩形 blit（ADR 0024）：把 src 的 srcRect 子矩形拉伸搬运到 dstRect。
     * srcRect 是 raw（内在坐标）空间窗口——napi 位图是 canonical（EXIF 自动转正）
     * 空间，非整图窗口经 canonicalSourceRect 映射进 canonical（04 号决议像素面
     * 口径的落地机制，与 go「先裁后转」逐像素等价）；整图哨兵（零宽高）直取
     * canonical 整图（raw 全图转正 = canonical 全图，恒等免映射）。
     * dstRect 尺寸 ≤0 防护先于读取跳过；src 未装配/装配失败/映射窗与位图不相交
     * 一律静默不画（缺省约定，见文件头）
     */
    drawImage(src: string, srcRect: BlitRect, dstRect: BlitRect): void {
        const ctx = this.canvasCtx()
        if (dstRect.width <= 0 || dstRect.height <= 0) {
            return
        }

        const entry = this.decoded.get(src)
        if (entry === undefined || entry === null) {
            return
        }
        const { image, orientation } = entry

        // canonical 位图界内的源窗；哨兵 → 整图（按解码实际尺寸，ADR 0024 接口契约）
        let window: BlitRect
        if (srcRect.width <= 0 || srcRect.height <= 0) {
            window = { x: 0, y: 0, width: image.width, height: image.height }
        } else {
            const raw = rawDimensions(image.width, image.height, orientation)
            window = canonicalSourceRect(srcRect, orientation, raw.width, raw.height)
        }

        // 与解码图求交（对位 go region.Intersect；不相交静默不画）
        const x0 = Math.max(0, Math.ceil(window.x))
        const y0 = Math.max(0, Math.ceil(window.y))
        const x1 = Math.min(image.width, window.x + window.width)
        const y1 = Math.min(image.height, window.y + window.height)
        if (x1 <= x0 || y1 <= y0) {
            return
        }

        ctx.drawImage(image, x0, y0, x1 - x0, y1 - y0, dstRect.x, dstRect.y, dstRect.width, dstRect.height)
    }

    /**
     * 单行文本（对位 go text.go DrawText）：原语层永远真实字体绘制——字体装配/
     * TTC 拒收/内置默认字体判定/对齐锚点与基线差/角度旋转见 text.ts
     * （drawTextLine）。空行零副作用；字色解析失败中止
     */
    drawText(line: string, x: number, y: number, options: TextDrawOptions): void {
        const ctx = this.canvasCtx()
        drawTextLine(ctx, line, x, y, options)
    }

    /**
     * 源图内在尺寸度量（ADR 0023/0024 查询口）：返 raw（未转正）尺寸——对位
     * go image.DecodeConfig / PHP getimagesize 的内在坐标系。查不到/解码失败返
     * null → 核心统一退化 fill 形态。
     * 两路在「raw 出参」契约上收敛（napi 同步/异步口径差异的实测收敛，见
     * decode.ts decodeHeaderSize docblock）：
     * - preload 缓存命中：位图是 canonical（异步解码已转正），经 exifOrientation
     *   ≥5 互换换回 raw；
     * - 未装配 src：同步头部探测直出 raw 头尺寸（同步口不施加转正），原样返回
     */
    imageIntrinsicSize(src: string): { width: number; height: number } | null {
        const cached = this.decoded.get(src)
        if (cached !== undefined && cached !== null) {
            const bytes = loadSourceBytes(src, this.registry)
            const orientation = bytes === null ? 1 : exifOrientation(bytes)
            return rawDimensions(cached.image.width, cached.image.height, orientation)
        }
        const bytes = loadSourceBytes(src, this.registry)
        if (bytes === null) {
            return null
        }
        return decodeHeaderSize(bytes)
    }

    /**
     * 图像登记缝（核心 setImage 契约）：物化器按键登记资源字节，键即 drawImage
     * 收到的 src 引用。字节拷贝入表（所有权归登记表，防外部原地改写）；同键重
     * 登记使解码缓存失效（下次 preload 重装配）
     */
    setImage(key: string, data: Uint8Array): void {
        this.registry.set(key, new Uint8Array(data))
        this.decoded.delete(key)
    }

    /**
     * 字体物化缝（resolver 的远程字体下载字节按键登记；核心 ResourceResolver
     * 契约「注册缝归后端包契约」的本包落点）：TTC 拒收与 GlobalFonts 注册在
     * 此处完成（物化阶段 fail-fast，渲染不带病启动），drawText 以 wire font
     * 引用（URL 原文）直取。幂等（同字节同别名）
     */
    registerFont(ref: string, data: Uint8Array): void {
        registerFontData(ref, data)
    }
}
