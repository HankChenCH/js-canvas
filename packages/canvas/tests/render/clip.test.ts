import { describe, expect, it, vi } from 'vitest'

import { decodeGraph, renderCanvas } from '../../src/index'
import type { RenderBackend } from '../../src/index'

interface CallRecord {
    op: 'begin' | 'end' | 'rect' | 'image' | 'ellipse' | 'masked'
    [key: string]: unknown
}

/**
 * 录制后端（PHP CoordinateRecordingRenderer 同款口径）：形状能力口按注入与否挂载
 * ——drawEllipse + drawImageMasked 两成员齐备才算形状能力后端（可选能力口契约，
 * 缺席形态 = 既有后端零破坏）；imageIntrinsicSize 同 fit 测试注入法
 */
function recordingBackend(
    options: { shapeCapable?: boolean; intrinsic?: { width: number; height: number } | null } = {},
) {
    const { shapeCapable = true, intrinsic } = options
    const calls: CallRecord[] = []
    const backend: RenderBackend = {
        begin(width, height) {
            calls.push({ op: 'begin', width, height })
        },
        end() {
            calls.push({ op: 'end' })
        },
        drawRect(x, y, width, height) {
            calls.push({ op: 'rect', x, y, width, height })
        },
        drawImage(src, srcRect, dstRect) {
            calls.push({ op: 'image', src, srcRect: { ...srcRect }, dstRect: { ...dstRect } })
        },
        drawText() {},
        ...(shapeCapable
            ? {
                    drawEllipse(x, y, width, height, fill, stroke) {
                        calls.push({ op: 'ellipse', x, y, width, height, fill, stroke })
                    },
                    drawImageMasked(src, srcRect, dstRect, maskRect) {
                        calls.push({
                            op: 'masked',
                            src,
                            srcRect: { ...srcRect },
                            dstRect: { ...dstRect },
                            maskRect: { ...maskRect },
                        })
                    },
                }
            : {}),
        ...(intrinsic !== undefined
            ? { imageIntrinsicSize: vi.fn(() => intrinsic) }
            : {}),
    }
    return { calls, backend }
}

/** 图层造数器：盒尺寸/对齐/位置/背景/边框/padding/clip 可注入（PHP renderLayer + setter 链同门） */
function clipCanvas(overrides: {
    width?: number
    height?: number
    x?: number
    y?: number
    horizontal?: 'left' | 'center' | 'right'
    vertical?: 'top' | 'center' | 'bottom'
    backgroundColor?: string
    padding?: { top: number; bottom: number; left: number; right: number }
    border?: {
        top?: { width: number; color: string } | null
        right?: { width: number; color: string } | null
        bottom?: { width: number; color: string } | null
        left?: { width: number; color: string } | null
    }
    clip?: string
    fit?: string
    src?: string | null
}) {
    return decodeGraph({
        canvas: { width: 200, height: 100 },
        layers: [{
            type: 'ImageLayer',
            spec: {
                shape: {
                    width: overrides.width ?? 100,
                    height: overrides.height ?? 50,
                    ...(overrides.backgroundColor !== undefined ? { backgroundColor: overrides.backgroundColor } : {}),
                    ...(overrides.padding ? { padding: overrides.padding } : {}),
                    ...(overrides.border ? { border: overrides.border } : {}),
                },
                align: {
                    horizontal: overrides.horizontal ?? 'center',
                    vertical: overrides.vertical ?? 'center',
                },
                position: { x: overrides.x ?? 10, y: overrides.y ?? 5, position: 'top-left' },
                ...(overrides.fit !== undefined ? { fit: overrides.fit } : {}),
                ...(overrides.clip !== undefined ? { clip: overrides.clip } : {}),
            },
            data: { valueType: 'StaticValue', value: overrides.src === undefined ? 'a.png' : overrides.src },
        }],
    })
}

describe('paintImage 圆形档三步分派（ADR 0026，PHP ImageClipPaintingTest 同款口径）', () => {
    it('圆形档三步：椭圆背景填充 → 遮罩 blit → 椭圆周描边；矩形盒 rect/image 原语不参与', () => {
        // 方盒 100×100 置于 (10,5)：内切圆 = 整盒；掩码矩形是渲染面绝对坐标
        const canvas = clipCanvas({
            width: 100, height: 100, backgroundColor: '#ffffff',
            border: { top: { width: 6, color: '#f00' }, right: { width: 6, color: '#f00' }, bottom: { width: 6, color: '#f00' }, left: { width: 6, color: '#f00' } },
            clip: 'circle',
        })
        const { calls, backend } = recordingBackend({ intrinsic: { width: 40, height: 40 } })
        renderCanvas(canvas, backend)

        expect(calls.map((call) => call.op)).toEqual(['begin', 'ellipse', 'masked', 'ellipse', 'end'])
        expect(calls[1]).toEqual({
            op: 'ellipse', x: 10, y: 5, width: 100, height: 100, fill: '#ffffff', stroke: null,
        })
        // fit 几何照旧（cover：40×40 方图进方盒零裁切），掩码矩形 = 内切圆矩形
        expect(calls[2]).toEqual({
            op: 'masked',
            src: 'a.png',
            srcRect: { x: 0, y: 0, width: 40, height: 40 },
            dstRect: { x: 10, y: 5, width: 100, height: 100 },
            maskRect: { x: 10, y: 5, width: 100, height: 100 },
        })
        expect(calls[3]).toEqual({
            op: 'ellipse', x: 10, y: 5, width: 100, height: 100, fill: null, stroke: { width: 6, color: '#f00' },
        })
        expect(calls.filter((call) => call.op === 'rect')).toEqual([])
        expect(calls.filter((call) => call.op === 'image')).toEqual([])
    })

    it('非方盒 100×50：内切圆恒正方 (35,5,50,50)（绝对坐标），fit 的 dstRect 仍是内容盒', () => {
        const canvas = clipCanvas({ width: 100, height: 50, backgroundColor: '#0f0', clip: 'circle' })
        const { calls, backend } = recordingBackend({ intrinsic: { width: 40, height: 40 } })
        renderCanvas(canvas, backend)

        expect(calls[1]).toMatchObject({ op: 'ellipse', x: 35, y: 5, width: 50, height: 50, fill: '#0f0' })
        // cover：40×40 方图进 100×50 内容盒 → 源窗中部横带 (0,10,40,20)、dst 全内容盒
        expect(calls[2]).toEqual({
            op: 'masked',
            src: 'a.png',
            srcRect: { x: 0, y: 10, width: 40, height: 20 },
            dstRect: { x: 10, y: 5, width: 100, height: 50 },
            maskRect: { x: 35, y: 5, width: 50, height: 50 },
        })
    })

    it('无图（src null）：背景圆 + 描边环两步，零 blit（占位语义进圆）', () => {
        const canvas = clipCanvas({
            width: 100, height: 100, backgroundColor: '#fff',
            border: { top: { width: 2, color: '#00f' } },
            clip: 'circle', src: null,
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        expect(calls.map((call) => call.op)).toEqual(['begin', 'ellipse', 'ellipse', 'end'])
        expect(calls[1]).toEqual({ op: 'ellipse', x: 10, y: 5, width: 100, height: 100, fill: '#fff', stroke: null })
        expect(calls[2]).toEqual({
            op: 'ellipse', x: 10, y: 5, width: 100, height: 100, fill: null, stroke: { width: 2, color: '#00f' },
        })
        expect(calls.filter((call) => call.op === 'masked')).toEqual([])
    })

    it('四边全未声明不描边：只两步（背景圆 + 遮罩 blit）', () => {
        const canvas = clipCanvas({ width: 100, height: 100, backgroundColor: '#fff', clip: 'circle' })
        const { calls, backend } = recordingBackend({ intrinsic: { width: 40, height: 40 } })
        renderCanvas(canvas, backend)

        expect(calls.map((call) => call.op)).toEqual(['begin', 'ellipse', 'masked', 'end'])
        expect(calls.filter((call) => call.op === 'ellipse')).toHaveLength(1)
    })

    it('描边参数解析规则进分派：宽取四边已声明最小值（2 < 8）、色按 top→right→bottom→left 首个非空（top）', () => {
        const canvas = clipCanvas({
            width: 100, height: 100, backgroundColor: '#fff',
            border: { top: { width: 2, color: '#f00' }, bottom: { width: 8, color: '#00f' } },
            clip: 'circle', src: null,
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        expect(calls[2]).toEqual({
            op: 'ellipse', x: 10, y: 5, width: 100, height: 100, fill: null, stroke: { width: 2, color: '#f00' },
        })
    })

    it('circle × fit 正交（先绘后裁）：contain/tile/fill 各档几何照旧，只换成遮罩 blit 形态', () => {
        // contain：40×20 宽图进 100×100 盒 → 等比放大 100×50 垂直居中（ADR 0023 几何不动）
        const contain = clipCanvas({ width: 100, height: 100, clip: 'circle', fit: 'contain' })
        const containCalls = recordingBackend({ intrinsic: { width: 40, height: 20 } })
        renderCanvas(contain, containCalls.backend)
        expect(containCalls.calls[2]).toEqual({
            op: 'masked',
            src: 'a.png',
            srcRect: { x: 0, y: 0, width: 40, height: 20 },
            dstRect: { x: 10, y: 30, width: 100, height: 50 },
            maskRect: { x: 10, y: 5, width: 100, height: 100 },
        })

        // fill：整图进与 cover 同门的目标矩形
        const fill = clipCanvas({ width: 100, height: 100, clip: 'circle', fit: 'fill' })
        const fillCalls = recordingBackend({ intrinsic: { width: 40, height: 40 } })
        renderCanvas(fill, fillCalls.backend)
        expect(fillCalls.calls[2]).toEqual({
            op: 'masked',
            src: 'a.png',
            srcRect: { x: 0, y: 0, width: 40, height: 40 },
            dstRect: { x: 10, y: 5, width: 100, height: 100 },
            maskRect: { x: 10, y: 5, width: 100, height: 100 },
        })

        // tile：可见块逐块遮罩 blit（掩码矩形同圆；40×40 单元 center 锚定盒内 (30,30)
        // → 绝对 (40,35)，右/下溢出截断）
        const tile = clipCanvas({ width: 100, height: 100, clip: 'circle', fit: 'tile' })
        const tileCalls = recordingBackend({ intrinsic: { width: 40, height: 40 } })
        renderCanvas(tile, tileCalls.backend)
        expect(tileCalls.calls.slice(2, 6)).toEqual([
            {
                op: 'masked',
                src: 'a.png',
                srcRect: { x: 0, y: 0, width: 40, height: 40 },
                dstRect: { x: 40, y: 35, width: 40, height: 40 },
                maskRect: { x: 10, y: 5, width: 100, height: 100 },
            },
            {
                op: 'masked',
                src: 'a.png',
                srcRect: { x: 0, y: 0, width: 30, height: 40 },
                dstRect: { x: 80, y: 35, width: 30, height: 40 },
                maskRect: { x: 10, y: 5, width: 100, height: 100 },
            },
            {
                op: 'masked',
                src: 'a.png',
                srcRect: { x: 0, y: 0, width: 40, height: 30 },
                dstRect: { x: 40, y: 75, width: 40, height: 30 },
                maskRect: { x: 10, y: 5, width: 100, height: 100 },
            },
            {
                op: 'masked',
                src: 'a.png',
                srcRect: { x: 0, y: 0, width: 30, height: 30 },
                dstRect: { x: 80, y: 75, width: 30, height: 30 },
                maskRect: { x: 10, y: 5, width: 100, height: 100 },
            },
        ])
    })

    it('内在尺寸不可用（ADR 0024 纪律）：退化整图拉伸（fill 形态、srcRect 零哨兵）再裁圆——遮罩几何不变', () => {
        const canvas = clipCanvas({ width: 100, height: 50, clip: 'circle' })
        const { calls, backend } = recordingBackend({ intrinsic: null })
        renderCanvas(canvas, backend)

        expect(calls[2]).toEqual({
            op: 'masked',
            src: 'a.png',
            srcRect: { x: 0, y: 0, width: 0, height: 0 },
            dstRect: { x: 10, y: 5, width: 100, height: 50 },
            maskRect: { x: 35, y: 5, width: 50, height: 50 },
        })
    })

    it('内容区被 padding 吃满：内切圆边长 ≤0，零几何零绘制（连椭圆都不画）', () => {
        const canvas = clipCanvas({
            width: 40, height: 40, backgroundColor: '#fff',
            padding: { top: 20, bottom: 20, left: 20, right: 20 },
            border: { top: { width: 2, color: '#f00' } },
            clip: 'circle',
        })
        const { calls, backend } = recordingBackend({ intrinsic: { width: 40, height: 40 } })
        renderCanvas(canvas, backend)

        expect(calls.map((call) => call.op)).toEqual(['begin', 'end'])
        expect(calls.filter((call) => call.op === 'ellipse')).toEqual([])
        expect(calls.filter((call) => call.op === 'masked')).toEqual([])
    })
})

describe('clip 降级面（fit 未知值纪律同门）', () => {
    it('未知 clip 值渲染面按矩形降级（白名单在渲染臂，不在解码门）；wire 透传不受扰', () => {
        const canvas = clipCanvas({ width: 100, height: 50, backgroundColor: '#fff', clip: 'star' })
        const { calls, backend } = recordingBackend({ intrinsic: { width: 40, height: 40 } })
        renderCanvas(canvas, backend)

        expect(calls.map((call) => call.op)).toEqual(['begin', 'rect', 'image', 'end'])
        expect(calls.filter((call) => call.op === 'ellipse' || call.op === 'masked')).toEqual([])
        expect(calls[2]).toEqual({
            op: 'image',
            src: 'a.png',
            srcRect: { x: 0, y: 10, width: 40, height: 20 },
            dstRect: { x: 10, y: 5, width: 100, height: 50 },
        })
    })

    it('显式 rect 与缺省同门：矩形路径照旧', () => {
        const canvas = clipCanvas({ width: 100, height: 50, clip: 'rect' })
        const { calls, backend } = recordingBackend({ intrinsic: { width: 40, height: 40 } })
        renderCanvas(canvas, backend)

        expect(calls.map((call) => call.op)).toEqual(['begin', 'rect', 'image', 'end'])
    })

    it('后端缺形状能力口（可选成员未实现）降级矩形路径：既有后端零破坏', () => {
        const canvas = clipCanvas({ width: 100, height: 50, backgroundColor: '#fff', clip: 'circle' })
        const { calls, backend } = recordingBackend({ shapeCapable: false, intrinsic: { width: 40, height: 40 } })
        renderCanvas(canvas, backend)

        expect(calls.map((call) => call.op)).toEqual(['begin', 'rect', 'image', 'end'])
        expect(calls.filter((call) => call.op === 'ellipse' || call.op === 'masked')).toEqual([])
    })
})
