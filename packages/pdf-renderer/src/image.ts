/**
 * 图片放置几何：2×3 仿射（y 向下像素空间）+ EXIF 八向归正矩阵 + 源窗包络 +
 * pdfkit 发射形态。对位 go pdf-renderer/image.go 的 affine/after/apply/transformRect/
 * orientAffine/placeAffine 六件（同式平移，发射公式因底座坐标系不同而形态有异，
 * 见 placeAffine docblock 的实证注记）。
 */

/** 2×3 仿射矩阵（y 向下坐标系）：x' = a·x + b·y + e；y' = c·x + d·y + f */
export interface Affine {
    a: number
    b: number
    c: number
    d: number
    e: number
    f: number
}

/** px→pt 换算系数（96dpi 口径：pt = px × 72/96）。核心接口坐标恒抽象像素，换算责任全在后端 */
export const PX_TO_PT = 0.75

/** apply 点变换 */
export function apply(m: Affine, x: number, y: number): [number, number] {
    return [m.a * x + m.b * y + m.e, m.c * x + m.d * y + m.f]
}

/** after 复合：this ∘ other（先施加 other、后施加 this） */
export function after(m: Affine, n: Affine): Affine {
    return {
        a: m.a * n.a + m.b * n.c,
        b: m.a * n.b + m.b * n.d,
        c: m.c * n.a + m.d * n.c,
        d: m.c * n.b + m.d * n.d,
        e: m.a * n.e + m.b * n.f + m.e,
        f: m.c * n.e + m.d * n.f + m.f,
    }
}

/** 整型矩形（像素空间；对位 go rect{Min,Max}，宽高形态与核心 BlitRect 同构） */
export interface IntRect {
    x: number
    y: number
    width: number
    height: number
}

/**
 * orientAffine EXIF orientation 的恒距归正矩阵（y 向下，整幅内在图 sw×sh → 观察方向）。
 * 与 go pdf-renderer orientAffine 逐向同式（2/4 镜像、3 旋转 180°、6/8 旋转 90°、
 * 5/7 沿对角镜像；位图实现的「观察格点 → 内在格点」取逆映射连续化，格点离散 ±1 由
 * 平移项吸收）。orientation > 4 的宽高互换语义显式落在矩阵里（h 平移项出现在 6/7、
 * w 出现在 7/8）。八向标定见 tests/matrix.test.ts。
 */
export function orientAffine(orientation: number, sw: number, sh: number): Affine {
    const w = sw
    const h = sh
    switch (orientation) {
        case 2:
            return { a: -1, b: 0, c: 0, d: 1, e: w, f: 0 }
        case 3:
            return { a: -1, b: 0, c: 0, d: -1, e: w, f: h }
        case 4:
            return { a: 1, b: 0, c: 0, d: -1, e: 0, f: h }
        case 5: // 转置（主对角镜像）
            return { a: 0, b: 1, c: 1, d: 0, e: 0, f: 0 }
        case 6: // 旋转 90° 顺时针
            return { a: 0, b: -1, c: 1, d: 0, e: h, f: 0 }
        case 7: // 反转置（反对角镜像）
            return { a: 0, b: -1, c: -1, d: 0, e: h, f: w }
        case 8: // 旋转 90° 逆时针
            return { a: 0, b: 1, c: -1, d: 0, e: 0, f: w }
        default: // 1 及越界归一：恒等
            return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
    }
}

/** transformRect 矩形经仿射后的轴对齐包络（8 向归正均为轴排列/翻转，四角即足；int 截断对位 go） */
export function transformRect(m: Affine, r: IntRect): IntRect {
    const p0 = apply(m, r.x, r.y)
    const p1 = apply(m, r.x + r.width, r.y + r.height)
    const p2 = apply(m, r.x, r.y + r.height)
    const p3 = apply(m, r.x + r.width, r.y)
    const xs = [p0[0], p1[0], p2[0], p3[0]]
    const ys = [p0[1], p1[1], p2[1], p3[1]]
    const x = Math.trunc(Math.min(...xs))
    const y = Math.trunc(Math.min(...ys))
    return {
        x,
        y,
        width: Math.trunc(Math.max(...xs)) - x,
        height: Math.trunc(Math.max(...ys)) - y,
    }
}

/**
 * placeAffine 发射放置矩阵：像素空间（y 向下）仿射 → PDF cm 矩阵（列向量约定：
 * x' = A·x + C·y + E；y' = B·x + D·y + F，与 go 行向量仿射 x' = a·x + b·y + e /
 * y' = c·x + d·y + f 相差一次转置）：
 *
 *     A = a   B = c   C = b   D = d   E = e·pxToPt   F = f·pxToPt
 *
 * **与 go fpdf 发射形态（A=a, B=−c, C=−b, D=d, E=b·H + e·pxToPt, F=H(1−d) − f·pxToPt）
 * 的分歧实证**：fpdf 用户空间 = PDF 原生 y 向上，翻转 H 项落在 E/F；pdfkit 页首自发
 * `1 0 0 −1 0 H cm`（外层翻转），叠加其图像内部 cm 后净效果 = myCm 输出即视觉坐标
 * （左上原点、y 向下、pt）——H 项整体消失，线性部分转置即得。出图语义与 go 逐向
 * 等价（四象限平移/镜像/旋转标定 + EXIF 八向 poppler 栅格标定锁定；曾错发行向量
 * 形态 [a,b,−c,−d,...]：恒等/90° 偶然出图、转置/镜像族整体出页静默白页）。
 * **抄错无报错，栅格标定即防线**
 */
export function placeMatrix(m: Affine, pageHeightPx: number): [number, number, number, number, number, number] {
    void pageHeightPx // 视觉坐标系下发 H 项消失；形参保留对位 go placeAffine(r.height) 的口径位
    return [m.a, m.c, m.b, m.d, m.e * PX_TO_PT, m.f * PX_TO_PT]
}

// ---- 直嵌 blit 共享主体（对位 go image.go embedBlit） ----

import type { BlitRect } from '@hankchen/canvas'

import { imageDimensions, sniffType } from './decode'
import { exifOrientation } from './exif'

/**
 * embedBlit 直嵌 blit 共享主体（drawImage/drawImageMasked 同源）：魔数嗅探 → 内在
 * 尺寸 → srcRect 源窗与放置矩阵 P 算定 → 内容寻址开图（去重）→ 调用臂给定的裁剪
 * 原语内发射放置矩阵与整幅图。源字节原样进文档（JPEG/PNG 直嵌零重编码），srcRect→
 * dstRect 的裁窗与拉伸、EXIF 归正全部经裁剪路径 + 放置矩阵在 PDF 图形态完成——像素
 * 不被搬动，与位图后端「解码 → 裁窗 → 转正 → 拉伸」像素管线语义等价。
 * 裁剪闭包在 transform 之前施加（双空间纪律：pdfkit 裁剪/变换入参恒其翻转用户空间，
 * 矩阵换算归 placeMatrix）。源窗与解码图不相交静默不画（go 同款防御）
 */
export function embedBlit(
    doc: PDFKit.PDFDocument,
    data: Uint8Array,
    srcRect: BlitRect,
    dstRect: BlitRect,
    pageHeightPx: number,
    clip: (doc: PDFKit.PDFDocument) => void,
    openDeduped: (data: Uint8Array) => PDFKit.Mixins.PDFImage,
): void {
    sniffType(data) // 魔数嗅探防线在前：垃圾字节/不支持格式的可读报错先于尺寸解析（格式标签由 pdfkit 自嗅，此处为校验）
    const bounds = imageDimensions(data) // raw，未转正

    let region: IntRect
    if (srcRect.width <= 0 || srcRect.height <= 0) {
        region = { x: 0, y: 0, width: bounds.width, height: bounds.height } // 零宽高哨兵 = 整图
    } else {
        const clipped = intersectRect(
            { x: srcRect.x, y: srcRect.y, width: srcRect.width, height: srcRect.height },
            bounds,
        )
        if (clipped === null) {
            return // 源窗与解码图不相交：分派层几何保证不发生，wire 可注入——静默不画
        }
        region = clipped
    }

    // 放置矩阵 P = 窗映射 W ∘ EXIF 归正 T（先归正、后映射，与 go 同构）
    const t = orientAffine(exifOrientation(data), bounds.width, bounds.height)
    const box = transformRect(t, region)
    if (box.width <= 0 || box.height <= 0) {
        return // 退化窗防御（恒距变换下非空窗的包络非空，正常几何不可达）
    }
    const sx = dstRect.width / box.width
    const sy = dstRect.height / box.height
    const w: Affine = { a: sx, b: 0, c: 0, d: sy, e: dstRect.x - sx * box.x, f: dstRect.y - sy * box.y }
    const p = after(w, t)

    const img = openDeduped(data)
    doc.save()
    clip(doc)
    doc.transform(...placeMatrix(p, pageHeightPx))
    // 整幅图按内在尺寸入坐标（矩阵负责裁窗与映射），放置点恒 (0,0) 不为负；
    // ignoreOrientation 关掉 pdfkit 的 EXIF 自动归正（实证 0.20.2 存在且仅影响放置
    // 不动字节）——归正由本矩阵自管（05 号决议 EXIF 自管八向矩阵）。
    // cast 注：@types/pdfkit 0.17 的 image/openImage 签名未收 PDFImage 实参与
    // ignoreOrientation 选项（0.20 运行时实证在位），经窄化调用面绕开
    const imageAt = doc.image as (src: Buffer, x: number, y: number, options: Record<string, unknown>) => PDFKit.PDFDocument
    imageAt.call(doc, img as unknown as Buffer, 0, 0, {
        width: bounds.width * PX_TO_PT,
        height: bounds.height * PX_TO_PT,
        ignoreOrientation: true,
    })
    doc.restore() // 弹出裁剪与放置矩阵
}

/** intersectRect 矩形与整幅内在图的交集；不相交返回 null */
function intersectRect(r: IntRect, bounds: { width: number; height: number }): IntRect | null {
    const x0 = Math.max(r.x, 0)
    const y0 = Math.max(r.y, 0)
    const x1 = Math.min(r.x + r.width, bounds.width)
    const y1 = Math.min(r.y + r.height, bounds.height)
    if (x1 - x0 <= 0 || y1 - y0 <= 0) {
        return null
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}
