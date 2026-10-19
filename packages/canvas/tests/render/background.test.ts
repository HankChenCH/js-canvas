/**
 * 画布背景铺装（ADR 0022 / canvas-background spec §4，Go renderer/background_test.go
 * 与 PHP AbstractRenderer paintBackground 对拍同款口径）：插入点 = begin 之后、
 * 根层循环之前，先色后图——背景之下无物（画布初始透明保留），背景图透明区露背景色；
 * 铺色复用 drawRect 原语（无边框），铺图复用 drawImage 原语（blit 双矩形 ADR 0024：
 * 恒 cover，分派点读内在尺寸算等比居中裁窗，能力缺席退化零哨兵 fill 形态；资源物化
 * 属宿主/后端缝不在核心模板）；无背景零开销。
 */
import { describe, expect, it } from 'vitest'

import { decodeGraph, renderCanvas } from '../../src/index'
import type { BlitRect, Canvas, RenderBackend } from '../../src/index'

interface Record_ {
    op: 'rect' | 'image'
    x: number
    y: number
    width: number
    height: number
    bgColor: string | null
    border: unknown
    src: string
    srcRect: BlitRect
}

function recordingBackend(): { records: Record_[]; backend: RenderBackend } {
    const records: Record_[] = []
    const backend: RenderBackend = {
        begin() {},
        end() {},
        drawRect(x, y, width, height, bgColor, border) {
            records.push({ op: 'rect', x, y, width, height, bgColor, border, src: '', srcRect: { x: 0, y: 0, width: 0, height: 0 } })
        },
        drawImage(src, srcRect, dstRect) {
            records.push({ op: 'image', x: dstRect.x, y: dstRect.y, width: dstRect.width, height: dstRect.height, bgColor: null, border: null, src, srcRect: { ...srcRect } })
        },
        drawText() {},
    }
    return { records, backend }
}

/** 内容图层造数（decode 缺省形态）：20×10 图片层，priority 0 垫底序 */
function contentLayer(): Canvas['layers'][number] {
    return decodeGraph({
        canvas: { width: 0, height: 0 },
        layers: [{ type: 'ImageLayer', spec: { shape: { width: 20, height: 10 } }, data: { valueType: 'StaticValue', value: 'a.png' } }],
    }).layers[0]!
}

function docWith(background: Canvas['background'], layers: Canvas['layers']): Canvas {
    return { width: 320, height: 240, background, layers }
}

describe('画布背景铺装（先色后图，根层循环之前）', () => {
    it('先铺色后图层：首个 rect = 整幅画布 + 背景色（无边框）', () => {
        const { records, backend } = recordingBackend()

        renderCanvas(docWith({ color: '#ffffff', image: null }, [contentLayer()]), backend)

        expect(records.map((r) => r.op)).toEqual(['rect', 'rect', 'image'])
        const bg = records[0]!
        expect([bg.x, bg.y, bg.width, bg.height]).toEqual([0, 0, 320, 240])
        expect(bg.bgColor).toBe('#ffffff')
        // 背景铺色不得带边框（借盒边框语义区分：内容层 rect 才带各自边框形态）
        expect(bg.border).toEqual({ top: null, bottom: null, left: null, right: null })
    })

    it('先色后图：背景图整幅 cover（透明区露色），均在根层之前', () => {
        const { records, backend } = recordingBackend()

        renderCanvas(docWith({ color: '#ffffff', image: '/local/bg.png' }, [contentLayer()]), backend)

        expect(records.map((r) => r.op)).toEqual(['rect', 'image', 'rect', 'image'])
        const bgImage = records[1]!
        expect(bgImage.src).toBe('/local/bg.png')
        expect([bgImage.x, bgImage.y, bgImage.width, bgImage.height]).toEqual([0, 0, 320, 240])
    })

    it('仅背景图：不铺色，整幅 cover 照铺（分量独立条件生效）', () => {
        const { records, backend } = recordingBackend()

        renderCanvas(docWith({ color: null, image: 'bg.png' }, [contentLayer()]), backend)

        expect(records.map((r) => r.op)).toEqual(['image', 'rect', 'image'])
        expect(records[0]!.src).toBe('bg.png')
    })

    it('无背景零开销：原语序与存量一致（画布初始透明保留）', () => {
        const { records, backend } = recordingBackend()

        renderCanvas(docWith(null, [contentLayer()]), backend)

        expect(records.map((r) => r.op)).toEqual(['rect', 'image'])
    })

    it('背景随 decodeGraph 的 graph 输入生效（wire → 渲染端到端）', () => {
        const { records, backend } = recordingBackend()
        const doc = decodeGraph({
            canvas: { width: 320, height: 240, background: { color: '#ffffff', image: 'bg.png' } },
            layers: [{ type: 'ImageLayer', spec: { shape: { width: 20, height: 10 } }, data: { valueType: 'StaticValue', value: 'a.png' } }],
        })

        renderCanvas(doc, backend)

        expect(records.map((r) => r.op)).toEqual(['rect', 'image', 'rect', 'image'])
    })
})

describe('背景臂 blit 迁移（ADR 0024：恒 cover，dst 零 diff）', () => {
    it('能力缺席（mock 未实现度量口）→ 零哨兵 fill 形态，dstRect 整幅画布不变', () => {
        const { records, backend } = recordingBackend()

        renderCanvas(docWith({ color: null, image: 'bg.png' }, []), backend)

        expect(records.map((r) => r.op)).toEqual(['image'])
        expect(records[0]!.srcRect).toEqual({ x: 0, y: 0, width: 0, height: 0 })
        expect([records[0]!.x, records[0]!.y, records[0]!.width, records[0]!.height]).toEqual([0, 0, 320, 240])
    })

    it('能力在场：分派点读内在尺寸算等比居中裁窗（40×40 图进 320×240 画布 → 中部横带）', () => {
        const records: Record_[] = []
        const backend: RenderBackend = {
            begin() {},
            end() {},
            drawRect() {},
            drawImage(src, srcRect, dstRect) {
                records.push({ op: 'image', x: dstRect.x, y: dstRect.y, width: dstRect.width, height: dstRect.height, bgColor: null, border: null, src, srcRect: { ...srcRect } })
            },
            drawText() {},
            imageIntrinsicSize: () => ({ width: 40, height: 40 }),
        }

        renderCanvas(docWith({ color: null, image: 'bg.png' }, []), backend)

        expect(records).toEqual([{
            op: 'image',
            x: 0,
            y: 0,
            width: 320,
            height: 240,
            bgColor: null,
            border: null,
            src: 'bg.png',
            srcRect: { x: 0, y: 5, width: 40, height: 30 },
        }])
    })

    it('度量非法（零尺寸）同退化零哨兵（真损坏图由后端解码处置，结局 parity）', () => {
        const records: Record_[] = []
        const backend: RenderBackend = {
            begin() {},
            end() {},
            drawRect() {},
            drawImage(src, srcRect, dstRect) {
                records.push({ op: 'image', x: dstRect.x, y: dstRect.y, width: dstRect.width, height: dstRect.height, bgColor: null, border: null, src, srcRect: { ...srcRect } })
            },
            drawText() {},
            imageIntrinsicSize: () => ({ width: 0, height: 0 }),
        }

        renderCanvas(docWith({ color: null, image: 'bg.png' }, []), backend)

        expect(records[0]!.srcRect).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    })
})
