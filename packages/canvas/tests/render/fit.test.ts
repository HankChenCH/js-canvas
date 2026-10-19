import { describe, expect, it, vi } from 'vitest'

import { decodeGraph, renderCanvas } from '../../src/index'
import type { RenderBackend } from '../../src/index'

interface CallRecord {
    op: 'begin' | 'end' | 'rect' | 'image'
    [key: string]: unknown
}

/**
 * 录制后端：blit 双矩形签名（ADR 0024）——image 记录 = src + srcRect/dstRect 矩形对象。
 * imageIntrinsicSize 按注入与否挂载：缺席形态 = 后端未实现度量能力口（可选成员，
 * 既有后端零破坏）；显式注入 null = 能力在场但查询不可用
 */
function recordingBackend(intrinsic?: { width: number; height: number } | null) {
    const calls: CallRecord[] = []
    const intrinsicSize = vi.fn(() => intrinsic ?? null)
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
        ...(intrinsic !== undefined ? { imageIntrinsicSize: intrinsicSize } : {}),
    }
    return { calls, backend, intrinsicSize }
}

/** 100×50 盒（backgroundColor '#fff'）置于 (10,5)，align center/center；fit 由参数注入 */
function fitCanvas(fit?: string) {
    return decodeGraph({
        canvas: { width: 200, height: 100 },
        layers: [{
            type: 'ImageLayer',
            spec: {
                shape: { width: 100, height: 50, backgroundColor: '#fff' },
                align: { horizontal: 'center', vertical: 'center' },
                position: { x: 10, y: 5, position: 'top-left' },
                ...(fit === undefined ? {} : { fit }),
            },
            data: { valueType: 'StaticValue', value: 'a.png' },
        }],
    })
}

const RECT = { op: 'rect', x: 10, y: 5, width: 100, height: 50 }

describe('paintImage 全 fit 分派（ADR 0024，PHP ImageFitPaintingTest 同款口径）', () => {
    it('cover（缺省）分派等比居中裁窗：40×40 进 100×50 盒 → srcRect 中部横带、dstRect 同门', () => {
        const { calls, backend, intrinsicSize } = recordingBackend({ width: 40, height: 40 })
        renderCanvas(fitCanvas(), backend)

        // 内在尺寸查询为全 fit 前置（cover 也依赖度量）
        expect(intrinsicSize).toHaveBeenCalledWith('a.png')
        expect(calls.map((call) => call.op)).toEqual(['begin', 'rect', 'image', 'end'])
        expect(calls[1]).toMatchObject(RECT)
        expect(calls[2]).toEqual({
            op: 'image',
            src: 'a.png',
            srcRect: { x: 0, y: 10, width: 40, height: 20 },
            dstRect: { x: 10, y: 5, width: 100, height: 50 },
        })
    })

    it('显式 cover wire 同 cover（解码归一缺省，裁窗分派不变）', () => {
        const { calls, backend } = recordingBackend({ width: 40, height: 40 })
        renderCanvas(fitCanvas('cover'), backend)

        expect(calls[2]).toEqual({
            op: 'image',
            src: 'a.png',
            srcRect: { x: 0, y: 10, width: 40, height: 20 },
            dstRect: { x: 10, y: 5, width: 100, height: 50 },
        })
    })

    it('未知 fit 值降级 cover：白名单外（flip，从未入册）走裁窗', () => {
        const { calls, backend } = recordingBackend({ width: 40, height: 40 })
        renderCanvas(fitCanvas('flip'), backend)

        expect(calls[2]).toEqual({
            op: 'image',
            src: 'a.png',
            srcRect: { x: 0, y: 10, width: 40, height: 20 },
            dstRect: { x: 10, y: 5, width: 100, height: 50 },
        })
    })

    it('contain（ADR 0023 语义不动）：srcRect 整图、dstRect 收缩矩形（盒内居中）', () => {
        const { calls, backend } = recordingBackend({ width: 40, height: 40 })
        renderCanvas(fitCanvas('contain'), backend)

        expect(calls.map((call) => call.op)).toEqual(['begin', 'rect', 'image', 'end'])
        expect(calls[2]).toEqual({
            op: 'image',
            src: 'a.png',
            srcRect: { x: 0, y: 0, width: 40, height: 40 },
            dstRect: { x: 35, y: 5, width: 50, height: 50 },
        })
    })

    it('fill：整图 srcRect + 与 cover 同门 dstRect（唯一差别在源矩形，不裁切不保比）', () => {
        const { calls, backend } = recordingBackend({ width: 40, height: 40 })
        renderCanvas(fitCanvas('fill'), backend)

        expect(calls.map((call) => call.op)).toEqual(['begin', 'rect', 'image', 'end'])
        expect(calls[2]).toEqual({
            op: 'image',
            src: 'a.png',
            srcRect: { x: 0, y: 0, width: 40, height: 40 },
            dstRect: { x: 10, y: 5, width: 100, height: 50 },
        })
    })

    it('fill dst 随 align + padding（与 cover 同门：imageOrigin + 内容宽高）', () => {
        const canvas = decodeGraph({
            canvas: { width: 200, height: 100 },
            layers: [{
                type: 'ImageLayer',
                spec: {
                    shape: { width: 100, height: 50, padding: { top: 10, bottom: 10, left: 10, right: 10 } },
                    align: { horizontal: 'center', vertical: 'center' },
                    position: { x: 10, y: 5, position: 'top-left' },
                    fit: 'fill',
                },
                data: { valueType: 'StaticValue', value: 'a.png' },
            }],
        })
        const { calls, backend } = recordingBackend({ width: 40, height: 40 })
        renderCanvas(canvas, backend)

        expect(calls[2]).toEqual({
            op: 'image',
            src: 'a.png',
            srcRect: { x: 0, y: 0, width: 40, height: 40 },
            dstRect: { x: 20, y: 15, width: 80, height: 30 },
        })
    })

    it('tile：可见块行主序逐块 blit（src/dst 1:1，网格居中、右/下半块截断）', () => {
        const { calls, backend } = recordingBackend({ width: 40, height: 40 })
        renderCanvas(fitCanvas('tile'), backend)

        expect(calls.map((call) => call.op)).toEqual(['begin', 'rect', 'image', 'image', 'image', 'image', 'end'])
        expect(calls.slice(2, 6)).toEqual([
            {
                op: 'image',
                src: 'a.png',
                srcRect: { x: 0, y: 0, width: 40, height: 40 },
                dstRect: { x: 40, y: 10, width: 40, height: 40 },
            },
            {
                op: 'image',
                src: 'a.png',
                srcRect: { x: 0, y: 0, width: 30, height: 40 },
                dstRect: { x: 80, y: 10, width: 30, height: 40 },
            },
            {
                op: 'image',
                src: 'a.png',
                srcRect: { x: 0, y: 0, width: 40, height: 5 },
                dstRect: { x: 40, y: 50, width: 40, height: 5 },
            },
            {
                op: 'image',
                src: 'a.png',
                srcRect: { x: 0, y: 0, width: 30, height: 5 },
                dstRect: { x: 80, y: 50, width: 30, height: 5 },
            },
        ])
    })

    it('tile dst 随图层锚点位移入账，src 不随位移（40×40 图铺满 40×40 盒恰一块）', () => {
        const canvas = decodeGraph({
            canvas: { width: 200, height: 100 },
            layers: [{
                type: 'ImageLayer',
                spec: {
                    shape: { width: 40, height: 40 },
                    align: { horizontal: 'left', vertical: 'top' },
                    position: { x: 5, y: 7, position: 'top-left' },
                    fit: 'tile',
                },
                data: { valueType: 'StaticValue', value: 'a.png' },
            }],
        })
        const { calls, backend } = recordingBackend({ width: 40, height: 40 })
        renderCanvas(canvas, backend)

        expect(calls[2]).toEqual({
            op: 'image',
            src: 'a.png',
            srcRect: { x: 0, y: 0, width: 40, height: 40 },
            dstRect: { x: 5, y: 7, width: 40, height: 40 },
        })
    })
})

describe('内在尺寸不可用统一退化 fill 形态（ADR 0024 纪律改写）', () => {
    it('能力缺席（可选成员未实现）→ 零哨兵整图 blit（不再有 cover 原语兜底）', () => {
        const { calls, backend, intrinsicSize } = recordingBackend()
        renderCanvas(fitCanvas('contain'), backend)

        expect(intrinsicSize).not.toHaveBeenCalled()
        expect(calls[2]).toEqual({
            op: 'image',
            src: 'a.png',
            srcRect: { x: 0, y: 0, width: 0, height: 0 },
            dstRect: { x: 10, y: 5, width: 100, height: 50 },
        })
    })

    it.each([
        ['缺省', undefined],
        ['cover', 'cover'],
        ['contain', 'contain'],
        ['fill', 'fill'],
        ['tile', 'tile'],
        ['未知值', 'flip'],
    ])('度量不可用（%s）→ 白名单四档统一退化 fill 形态，tile 不产生 N 块循环', (_name, fit) => {
        const { calls, backend } = recordingBackend(null)
        renderCanvas(fitCanvas(fit), backend)

        expect(calls.filter((call) => call.op === 'image')).toEqual([{
            op: 'image',
            src: 'a.png',
            srcRect: { x: 0, y: 0, width: 0, height: 0 },
            dstRect: { x: 10, y: 5, width: 100, height: 50 },
        }])
    })

    it.each([
        ['null', null],
        ['零尺寸', { width: 0, height: 0 }],
        ['负尺寸', { width: 10, height: -3 }],
    ])('度量非法（%s）同退化（损坏图不因 fit 崩渲染，坏图由后端静默不画）', (_name, intrinsic) => {
        const { calls, backend } = recordingBackend(intrinsic as { width: number; height: number } | null)
        renderCanvas(fitCanvas('cover'), backend)

        expect(calls[2]).toEqual({
            op: 'image',
            src: 'a.png',
            srcRect: { x: 0, y: 0, width: 0, height: 0 },
            dstRect: { x: 10, y: 5, width: 100, height: 50 },
        })
    })
})

describe('QR 臂迁移（ADR 0015 内切 + ADR 0024 blit）', () => {
    it('QR 整图 blit：srcRect 零哨兵、零内在尺寸读取，内切正方形语义不变', () => {
        const canvas = decodeGraph({
            canvas: { width: 200, height: 100 },
            layers: [{
                type: 'QrCodeLayer',
                spec: {
                    shape: { width: 100, height: 50, padding: { top: 5, bottom: 5, left: 5, right: 5 } },
                    align: { horizontal: 'left', vertical: 'top' },
                    position: { x: 0, y: 0, position: 'top-left' },
                },
                data: { valueType: 'StaticValue', value: 'https://example.com/qr-blit' },
            }],
        })
        const { calls, backend, intrinsicSize } = recordingBackend({ width: 40, height: 40 })
        renderCanvas(canvas, backend)

        expect(intrinsicSize).not.toHaveBeenCalled()
        expect(calls.filter((call) => call.op === 'image')).toEqual([{
            op: 'image',
            src: 'qr:https://example.com/qr-blit',
            srcRect: { x: 0, y: 0, width: 0, height: 0 },
            dstRect: { x: 5, y: 5, width: 40, height: 40 },
        }])
    })
})
