import { describe, expect, it } from 'vitest'

import { type Affine, after, apply, orientAffine, placeMatrix, transformRect } from '../src/image'

/**
 * 仿射矩阵纯单元标定（对位 go pdf-renderer image_test.go TestOrientAffineAllDirections）：
 * orientAffine 八向以 3×2 字母栅格按「内在格 → 观察格」方向（DrawImage/transformRect
 * 的实际使用方向）重排后逐格比对，期望栅格与 go/位图后端逐向一致（矩阵式 = 位图像素
 * 搬运的连续化，多后端转正防线对称）。
 */
describe('orientAffine 八向归正矩阵（y 向下，整幅内在图 → 观察方向）', () => {
    const letters = 'ABCDEF'
    // 栅格行按 / 分隔；5–8 为 90° 族，宽高互换（期望值与 go 测试逐字一致）
    const cases: Array<[number, string]> = [
        [1, 'ABC/DEF'],
        [2, 'CBA/FED'], // 水平镜像
        [3, 'FED/CBA'], // 旋转 180°
        [4, 'DEF/ABC'], // 垂直镜像
        [5, 'AD/BE/CF'], // 转置（主对角镜像）
        [6, 'DA/EB/FC'], // 旋转 90° 顺时针
        [7, 'FC/EB/DA'], // 反转置（反对角镜像）
        [8, 'CF/BE/AD'], // 旋转 90° 逆时针
    ]

    for (const [orientation, want] of cases) {
        it(`orientation ${orientation} → ${want.replace('/', ' / ')}`, () => {
            const rows = want.split('/')
            const outW = rows[0]!.length
            const outH = rows.length
            const grid: string[][] = Array.from({ length: outH }, () => Array.from({ length: outW }, () => '.'))
            const m = orientAffine(orientation, 3, 2)
            for (let y = 0; y < 2; y += 1) {
                for (let x = 0; x < 3; x += 1) {
                    const [ox, oy] = apply(m, x + 0.5, y + 0.5) // 格心采样，避边界歧义
                    grid[Math.trunc(oy)]![Math.trunc(ox)] = letters.charAt(y * 3 + x)
                }
            }
            expect(grid.map((row) => row.join(''))).toEqual(rows)
        })
    }

    it('越界 orientation 归一恒等（1 及缺省臂同式）', () => {
        expect(orientAffine(0, 3, 2)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
        expect(orientAffine(9, 3, 2)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
    })
})

describe('affine 复合与包络（对位 go after/transformRect）', () => {
    it('after 复合：this ∘ other（先 other 后 this），平移复合逐项核对', () => {
        const t: Affine = { a: 1, b: 0, c: 0, d: 1, e: 10, f: 5 } // 平移 (10,5)
        const r: Affine = { a: 0, b: -1, c: 1, d: 0, e: 0, f: 0 } // 旋转 90°
        const composed = after(t, r) // 先旋转、后平移
        expect(apply(composed, 2, 3)).toEqual([10 - 3, 5 + 2])
        // 复合不满足交换律：先平移后旋转
        const reversed = after(r, t)
        expect(apply(reversed, 2, 3)).toEqual([-8, 12])
    })

    it('orientAffine 六顺时针 90° 矩阵：宽高互换（orientation > 4 语义显式落在矩阵里）', () => {
        const m = orientAffine(6, 8, 16)
        // 整幅四角：raw (0,0) → 观察右上，raw (8,16) → 观察左下（8×16 → 16×8）
        expect(apply(m, 0, 0)).toEqual([16, 0])
        expect(apply(m, 8, 16)).toEqual([0, 8])
    })

    it('transformRect 轴对齐包络：恒距变换下矩形像的包围盒', () => {
        const region = { x: 1, y: 2, width: 4, height: 6 }
        expect(transformRect(orientAffine(1, 10, 10), region)).toEqual({ x: 1, y: 2, width: 4, height: 6 })
        // 顺时针 90°：窗 (1,2,4,6) → 观察窗翻转
        const rotated = transformRect(orientAffine(6, 8, 16), region)
        expect(rotated).toEqual({ x: 16 - 2 - 6, y: 1, width: 6, height: 4 })
    })

    it('placeAffine 的 pdfkit 发射形态自检：行向量仿射转置为 PDF 列向量 cm，平移 ×k', () => {
        // node 侧发射形态 = [a, c, b, d, e·k, f·k]（PDF cm 列向量约定 + pdfkit 外层
        // 翻转使 H 项消失，见 placeMatrix docblock 实证注记）；出图方向的锁定归
        // image.test.ts 的 EXIF 八向 poppler 栅格标定
        const m: Affine = { a: 1, b: 2, c: 3, d: 4, e: 8, f: 12 }
        const k = 0.75
        expect(placeMatrix(m, 100)).toEqual([1, 3, 2, 4, 8 * k, 12 * k])
        // 恒等阵发射后仍恒等（×k 缩放由图像入坐标尺寸承担，见 embedBlit）
        const identity = orientAffine(1, 100, 100)
        expect(placeMatrix(identity, 100)).toEqual([1, 0, 0, 1, 0, 0])
    })
})
