/**
 * 后端会话（对位 go pdf-renderer/backend.go Renderer）：以 pdfkit 新建单文档为渲染面，
 * 实现核心包五个绘制原语接入渲染模板；可选形状能力口（drawEllipse + drawImageMasked，
 * ADR 0026，掩码 blit 走矢量裁剪、椭圆走原生 ellipse——两成员齐备才算形状能力后端），
 * End 产物为 PDF 文档字节 Uint8Array（经核心 renderAs/renderPagesAs 消费）。
 *
 * 单位契约：核心接口坐标恒抽象像素，px→pt 换算责任全在后端（96dpi 口径，
 * pt = px × 0.75，PX_TO_PT 全局唯一换算点）——页 MediaBox、原语坐标、字号一律 ×0.75；
 * 对齐偏移等已度量值不二次换算（go 曾踩右对齐越锚 7px 的坑，见 text.ts）。
 *
 * 失败即抛纪律（对位 go「失败即抛、渲染面丢弃、无产物逃逸」）：任一原语失败即抛出
 * 并弃件（会话整体复位，实例不复用），渲染模板的收尾 end() 不达；防御面：失败后
 * 直调 end() 也无半截产物逃逸（doc 已弃，返回 null 走核心 product_type_mismatch）。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import PDFDocument from 'pdfkit'

import type { Border, RenderBackend, ShapeCapableBackend, TextDrawOptions, BlitRect, BorderSide } from '@hankchen/canvas'

import { parseColor, type Rgba } from './color'
import { imageDimensions } from './decode'
import { PX_TO_PT, embedBlit } from './image'
import { drawTextLine } from './text'
import { isRemoteURL } from './url'

/** QR 图层登记键前缀（核心 qrImageSrc 产出；未物化的 qr: 引用走占位语义静默不画） */
const QR_KEY_PREFIX = 'qr:'

/**
 * PdfRenderer PDF 渲染后端：实例即一个 PDF 文档会话——首次 begin 建档，后续 begin
 * 同一文档续页（核心 renderPages 的 n 页 n 次 begin + 单文档一次 end 编排）；end 产出
 * 即终结会话（doc 与字体/内嵌图注册表一并复位），同一实例再次渲染必然得到干净新文档，
 * 不会把页面追加进旧文档（对位 go 工票 03 验收语义）。**非并发安全**：并发渲染请各自 new
 */
export class PdfRenderer implements RenderBackend, ShapeCapableBackend {
    /** doc begin 建立的 PDF 文档（会话内单文档连续性，多页逐页 addPage） */
    private doc: PDFKit.PDFDocument | null = null
    /** 渲染面高（px，placeMatrix 的页高 pt 换算基准） */
    private pageHeightPx = 0
    /** 流错误位（'error' 监听落点；emit 前后双重复查，宁可无产物不可出半成品） */
    private streamError: Error | null = null

    /**
     * fonts 已注册字体表（字体引用键 → 合成族名）：多行文本逐行 drawText，同一引用
     * 只读盘/注册一次；文档内嵌去重由 pdfkit 按字体键自持。随文档会话走（end/discard
     * 复位），新文档须重新注册
     */
    private readonly fonts = new Map<string, string>()

    /**
     * 字体字节登记表（registerFontData 缝，resolver 物化远程字体后按原始引用登记；
     * 不随会话复位——物化结果内容寻址，重复登记幂等覆盖）
     */
    private readonly fontData = new Map<string, Uint8Array>()

    /**
     * images 内容 hash → 已开图实例（对位 fpdf 按名去重，pdfkit 是引用式去重——
     * 05 号决议补丁 #1：同一图片重复出现只嵌一份字节）。随文档会话走
     */
    private readonly images = new Map<string, PDFKit.Mixins.PDFImage>()

    /**
     * imageBytes setImage 登记表（wire src 同键 → 字节；工票 09 物化缝形态）。
     * 不随会话复位（物化面与文档会话解耦，重复登记幂等覆盖）
     */
    private readonly imageBytes = new Map<string, Uint8Array>()

    /** 后端自带的默认物化器（createRenderer 接线；核心缝契约 resolver.ts 的消费端） */
    defaultResolver?: import('@hankchen/canvas').ResourceResolver

    begin(width: number, height: number): void {
        if (width <= 0 || height <= 0) {
            throw new Error(`渲染面尺寸非法: ${width}x${height}`)
        }
        // 页尺寸 = px × 0.75 pt（MediaBox 与编译期页几何同口径）；margin 归零：
        // 绘制坐标全由模板给足，不留库级默认留白（72pt）干扰
        const size: [number, number] = [width * PX_TO_PT, height * PX_TO_PT]
        if (this.doc === null) {
            const doc = new PDFDocument({ autoFirstPage: false, margin: 0 })
            // 原子性包装层（05 号决议补件 #4）：'error' 监听落错误位，emit 收集完毕
            // 才交付；pdfkit 绘制期错误以同步 throw 为主，流级错误走此通道
            doc.on('error', (err: Error) => {
                this.streamError = err
            })
            this.doc = doc
        }
        this.doc.addPage({ size, margin: 0 })
        this.pageHeightPx = height
    }

    /**
     * end 收尾：全程内存构建，同步排空流取完整文档字节（pdfkit 内部 fflate 同步
     * deflate，doc.end() 时所有 chunk 同步入内部缓冲——冒烟实证 read() 循环排空即得
     * 完整 %PDF，poppler 读通；end() 同步返 Uint8Array，对位 go End() []byte）。
     * 未建面返回 null（对位 go nil 接口；核心 renderAs 断言面报 product_type_mismatch）。
     * end 一次性终结文档会话：无论产出与否 doc 与字体/内嵌图注册表一并复位——
     * begin 的续页分支只应活在单次渲染会话内，end 后实例复用必须从建档起步
     */
    end(): Uint8Array | null {
        if (this.doc === null) {
            return null
        }
        try {
            return this.emit()
        } finally {
            this.resetSession() // 会话复位：再次 begin 即建档新文档（End 后复用语义）
        }
    }

    /** emit 产物发射：错误位复查 + 同步排空；任一失败抛出且弃件（无产物逃逸） */
    private emit(): Uint8Array {
        // 经局部变量读取错误位：doc.read() 等调用会异步改写 this.streamError，
        // 属性窄化会把它误判为 never
        let caught: Error | null = this.streamError
        if (caught !== null) {
            this.discard()
            throw new Error(`PDF 文档生成失败: ${caught.message}`)
        }
        const doc = this.doc!
        doc.end()
        const chunks: Buffer[] = []
        let chunk: Buffer | null
        while ((chunk = doc.read()) !== null) {
            chunks.push(chunk)
        }
        caught = this.streamError
        if (caught !== null) {
            // 排空后才暴露的流错误：半截流不可信，弃件不出半成品
            this.discard()
            throw new Error(`PDF 文档生成失败: ${caught.message}`)
        }
        return new Uint8Array(Buffer.concat(chunks)) // 拷贝出 Buffer 池化内存
    }

    drawRect(x: number, y: number, width: number, height: number, bgColor: string | null, border: Border): void {
        this.tryBegin((doc) => {
            if (bgColor !== null && bgColor !== '') {
                paintRect(doc, x, y, width, height, parseColor(bgColor))
            }
            for (const edge of borderBands(x, y, width, height, border)) {
                let c: Rgba
                try {
                    c = parseColor(edge.side.color)
                } catch (err) {
                    throw new Error(`解析边框色: ${(err as Error).message}`)
                }
                paintRect(doc, edge.band.x, edge.band.y, edge.band.width, edge.band.height, c)
            }
        })
    }

    /**
     * drawImage 双矩形 blit（ADR 0024）：先查 setImage 登记表，未命中按 src 处理——
     * `qr:` 前缀未登记走占位语义静默不画（核心 QR 臂注释的占位约定）；其余远程引用
     * 未登记报错（物化缺失是调用侧错误，对位 go os.ReadFile 失败即错的结局 parity）；
     * 本地路径同步读盘。JPEG/PNG 直嵌零重编码；GIF/BMP/WebP 魔数嗅探报错（05 号
     * 降级声明，错误信息列明 v1 支持面）。srcRect 零宽高哨兵 = 整图；dstRect 零尺寸
     * 防护先于读取静默不画；源窗与图不相交静默不画（go 同款防御）
     */
    drawImage(src: string, srcRect: BlitRect, dstRect: BlitRect): void {
        this.tryBegin((doc) => {
            if (dstRect.width <= 0 || dstRect.height <= 0) {
                return // 防护先于读取（PHP dw/dh ≤0 同款；未建面检查在前，对位 go docf 次序）
            }
            const data = this.lookupImageBytes(src)
            if (data === null) {
                return // qr: 未物化占位语义
            }
            embedBlit(doc, data, srcRect, dstRect, this.pageHeightPx, (d) => clipRectPath(d, dstRect), (bytes) => this.openDeduped(bytes))
        })
    }

    /**
     * drawImageMasked 掩码 blit 原语（ADR 0026，形状能力口）：双矩形 blit 语义与
     * drawImage 完全一致（含零宽高整图哨兵）后，以 maskRect 外接矩形的内切椭圆为掩码
     * 裁切。掩码矩形是画布绝对坐标、与目标矩形独立，裁剪路径在未入放置矩阵的用户空间
     * 施加（双空间纪律与 go 同门）。dstRect/maskRect 空矩形防护不画
     */
    drawImageMasked(src: string, srcRect: BlitRect, dstRect: BlitRect, maskRect: BlitRect): void {
        this.tryBegin((doc) => {
            if (dstRect.width <= 0 || dstRect.height <= 0 || maskRect.width <= 0 || maskRect.height <= 0) {
                return // dstRect/maskRect 空矩形防护不画；未建面检查在前，对位 go docf 次序
            }
            const data = this.lookupImageBytes(src)
            if (data === null) {
                return
            }
            embedBlit(doc, data, srcRect, dstRect, this.pageHeightPx, (d) => clipEllipsePath(d, maskRect), (bytes) => this.openDeduped(bytes))
        })
    }

    /**
     * drawEllipse 椭圆原语（ADR 0026，形状能力口）：fillColor 填充 + stroke 描边一体。
     * 描边为驱动原生缘上居中带 [r−w/2, r+w/2]（pdfkit stroke 即缘上居中，与 go fpdf
     * Ellipse 同口径）；颜色先解析后挂载，错误路径不残留文档状态；半透明色经
     * ExtGState（fillOpacity/strokeOpacity）挂载画完恢复
     */
    drawEllipse(x: number, y: number, width: number, height: number, fillColor: string | null, stroke: BorderSide | null): void {
        if (width <= 0 || height <= 0) {
            return // 内切边长 ≤0 零几何零绘制（渲染臂同款防护）
        }
        this.tryBegin((doc) => {
            const cx = (x + width / 2) * PX_TO_PT
            const cy = (y + height / 2) * PX_TO_PT
            const rx = (width / 2) * PX_TO_PT
            const ry = (height / 2) * PX_TO_PT
            if (fillColor !== null && fillColor !== '') {
                const c = parseColor(fillColor)
                doc.fillOpacity(c.a / 255).fillColor(rgbHex(c))
                doc.ellipse(cx, cy, rx, ry).fill()
                doc.fillOpacity(1) // 画完恢复，后续元素不吃残留 alpha
            }
            if (stroke !== null && stroke.width > 0) {
                const c = parseColor(stroke.color)
                doc.strokeOpacity(c.a / 255).strokeColor(rgbHex(c)).lineWidth(stroke.width * PX_TO_PT)
                doc.ellipse(cx, cy, rx, ry).stroke()
                doc.strokeOpacity(1)
            }
        })
    }

    /** drawText 单行文本（对位 go text.go DrawText；字体分派/对齐锚点/角度见 text.ts） */
    drawText(line: string, x: number, y: number, options: TextDrawOptions): void {
        this.tryBegin((doc) => {
            drawTextLine(doc, this.fonts, this.fontData, line, x, y, options)
        })
    }

    /**
     * imageIntrinsicSize 源图内在尺寸度量（ADR 0024 全 fit 前置；查询口非绘制原语）：
     * 登记表命中走字节，本地路径同步读盘，远程未登记返回 null（核心统一退化 fill 形态
     * ——缺席即破 parity，故本能力必须实现）。JPEG 解析 SOF 得 raw 尺寸 + PNG 解析
     * IHDR（PNG 无 orientation）；raw 空间口径：SOF 尺寸本身就是 raw，orientation ≥5
     * 不需换回，返回值恒 raw。解析失败返 null（真损坏图由 drawImage 硬错处置）
     */
    imageIntrinsicSize(src: string): { width: number; height: number } | null {
        const data = this.lookupImageBytesOrNull(src)
        if (data === null) {
            return null
        }
        try {
            return imageDimensions(data)
        } catch {
            return null
        }
    }

    /** setImage 图像登记缝（工票 09 / 06 号决议）：物化器以 wire src 同键登记资源字节 */
    setImage(key: string, data: Uint8Array): void {
        this.imageBytes.set(key, data)
    }

    /**
     * registerFontData 字体登记缝（本包契约，核心 resolver 契约注明「字体 URL 的下载
     * 字节交渲染端注册（不经 setImage——字体非图像）」的落点）：远程字体物化字节按
     * 原始引用登记，drawText 时按 options.font 同键取用
     */
    registerFontData(key: string, data: Uint8Array): void {
        this.fontData.set(key, data)
    }

    // ---- 会话内件 ----

    /** docf 取渲染面；未建面即调用绘制原语属用法错误（模板保证先 begin） */
    private docf(): PDFKit.PDFDocument {
        if (this.doc === null) {
            throw new Error('PDF 渲染面未初始化:应经渲染模板 begin 建面')
        }
        return this.doc
    }

    /**
     * tryBegin 绘制原语的统一外壳：未建面即抛（用法错误）；原语失败 → 弃件（会话
     * 复位）后原样抛出——渲染面整体丢弃、无半截产物逃逸、失败后实例不复用（重试请
     * 各自 new；防御面：失败后直调 end() 返回 null）
     */
    private tryBegin<T>(paint: (doc: PDFKit.PDFDocument) => T): T {
        const doc = this.docf()
        try {
            return paint(doc)
        } catch (err) {
            this.resetSession()
            throw err
        }
    }

    /**
     * lookupImageBytes 绘制路径的源字节解析：登记表命中走字节；`qr:` 未登记 = 占位
     * 语义（null → 静默不画）；其余远程引用未登记 = 物化缺失硬错；本地路径读盘失败
     * 包装可读错误（对位 go 读取图片 %s: %w）
     */
    private lookupImageBytes(src: string): Uint8Array | null {
        const registered = this.imageBytes.get(src)
        if (registered !== undefined) {
            return registered
        }
        if (src.startsWith(QR_KEY_PREFIX)) {
            return null // 未物化 QR：核心 QR 臂占位语义（只画盒）
        }
        if (isRemoteURL(src)) {
            throw new Error(`读取图片 ${src}: 远程引用未物化——应经 ResourceResolver 物化后经 setImage 登记`)
        }
        try {
            return new Uint8Array(readFileSync(src))
        } catch (err) {
            throw new Error(`读取图片 ${src}: ${(err as Error).message}`)
        }
    }

    /** lookupImageBytesOrNull 度量路径的软解析：任何失败都归 null（核心退化 fill 形态） */
    private lookupImageBytesOrNull(src: string): Uint8Array | null {
        try {
            return this.lookupImageBytes(src)
        } catch {
            return null
        }
    }

    /**
     * openDeduped 内容 hash → 已开图实例（对位 fpdf 按名去重）：pdfkit 的 _imageRegistry
     * 只对 string src 去重，Buffer 每次都新开对象——内容寻址的实例表保证 tile 多块/
     * 重复引用同一图片只嵌一份字节（去重断言见 tests/image.test.ts）
     */
    private openDeduped(data: Uint8Array): PDFKit.Mixins.PDFImage {
        const hash = createHash('sha256').update(data).digest('hex')
        let img = this.images.get(hash)
        if (img === undefined) {
            img = (this.doc as unknown as { openImage(src: Buffer): PDFKit.Mixins.PDFImage }).openImage(
                Buffer.from(data.buffer, data.byteOffset, data.byteLength),
            )
            this.images.set(hash, img)
        }
        return img
    }

    /** resetSession 会话复位：doc 与 doc 域注册表（字体族名/内嵌图实例）一并清空 */
    private resetSession(): void {
        this.doc = null
        this.streamError = null
        this.fonts.clear()
        this.images.clear()
    }

    /** discard 失败弃件：会话复位且实例不复用（streamError 已随 doc 域清除） */
    private discard(): void {
        this.resetSession()
    }
}

// ---- 绘制小件（对位 go backend.go paintRect/borderBands） ----

/** paintRect 以像素坐标画一个实心矩形（内部 ×0.75 转 pt）；半透明色经 ExtGState 挂 alpha，画完恢复不透明 */
function paintRect(doc: PDFKit.PDFDocument, x: number, y: number, w: number, h: number, c: Rgba): void {
    doc.fillOpacity(c.a / 255)
    doc.fillColor(rgbHex(c))
    doc.rect(x * PX_TO_PT, y * PX_TO_PT, w * PX_TO_PT, h * PX_TO_PT).fill()
    doc.fillOpacity(1)
}

/** rgbHex rgba → pdfkit 颜色串（#rrggbb；alpha 走 fillOpacity/strokeOpacity 通道） */
export function rgbHex(c: Rgba): string {
    const hex = (v: number) => v.toString(16).padStart(2, '0')
    return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`
}

/** edgeBand 一条边的线宽带：边框设定 + 盒内嵌的覆盖区 */
interface EdgeBand {
    side: BorderSide
    band: { x: number; y: number; width: number; height: number }
}

/**
 * borderBands 四条边的线宽带，序为 top/bottom/left/right（PHP 绘制序，后画覆盖先画）；
 * 未设或 width≤0（wire 解码可注入）的边不计。
 * 与 go pdf-renderer backend.go borderBands（及 image-renderer 同名小件）同一公式的
 * 复制——几何契约的一部分，多后端防线必须对称
 */
export function borderBands(x: number, y: number, width: number, height: number, border: Border): EdgeBand[] {
    const bands: EdgeBand[] = []
    const s = border.top
    if (s !== null && s.width > 0) {
        bands.push({ side: s, band: { x, y, width, height: s.width } })
    }
    const b = border.bottom
    if (b !== null && b.width > 0) {
        bands.push({ side: b, band: { x, y: Math.max(y, y + height - b.width), width, height: y + height - Math.max(y, y + height - b.width) } })
    }
    const l = border.left
    if (l !== null && l.width > 0) {
        bands.push({ side: l, band: { x, y, width: l.width, height } })
    }
    const r = border.right
    if (r !== null && r.width > 0) {
        const x0 = Math.max(x, x + width - r.width)
        bands.push({ side: r, band: { x: x0, y, width: x + width - x0, height } })
    }
    return bands
}

/** clipRectPath dstRect 裁剪路径（像素坐标 ×0.75 入 pdfkit 翻转用户空间；在 transform 之前施加） */
function clipRectPath(doc: PDFKit.PDFDocument, dstRect: BlitRect): void {
    doc.rect(dstRect.x * PX_TO_PT, dstRect.y * PX_TO_PT, dstRect.width * PX_TO_PT, dstRect.height * PX_TO_PT).clip()
}

/** clipEllipsePath maskRect 内切椭圆裁剪路径（inscribedEllipse 同一几何落点，ADR 0026） */
function clipEllipsePath(doc: PDFKit.PDFDocument, maskRect: BlitRect): void {
    const cx = (maskRect.x + maskRect.width / 2) * PX_TO_PT
    const cy = (maskRect.y + maskRect.height / 2) * PX_TO_PT
    const rx = (maskRect.width / 2) * PX_TO_PT
    const ry = (maskRect.height / 2) * PX_TO_PT
    doc.ellipse(cx, cy, rx, ry).clip()
}
