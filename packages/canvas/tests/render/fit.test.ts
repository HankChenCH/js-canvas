import { describe, expect, it, vi } from 'vitest'

import { decodeGraph, renderCanvas } from '../../src/index'
import type { RenderBackend } from '../../src/index'

interface CallRecord {
    op: 'begin' | 'end' | 'rect' | 'image'
    [key: string]: unknown
}

/**
 * 录制后端：imageIntrinsicSize 按注入与否挂载——缺席形态 = 后端未实现度量能力口
 * （可选成员，RenderBackend 既有实现零破坏）；显式注入 null = 能力在场但查询不可用
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
        drawImage(src, x, y, width, height) {
            calls.push({ op: 'image', src, x, y, width, height })
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

describe('ImageLayer 臂 contain 计划（ADR 0023，PHP ImageFitPaintingTest 同款口径）', () => {
    it('contain 收缩：40×40 进 100×50 盒 → 盒内 (25,0,50,50)、绝对 (35,5)；盒矩形照画、空隙零指令', () => {
        const { calls, backend, intrinsicSize } = recordingBackend({ width: 40, height: 40 })
        renderCanvas(fitCanvas('contain'), backend)

        expect(intrinsicSize).toHaveBeenCalledWith('a.png')
        // 空隙零绘制指令：盒矩形之外仅一条收缩矩形 image 记录，无 letterbox 填充
        expect(calls.map((call) => call.op)).toEqual(['begin', 'rect', 'image', 'end'])
        expect(calls[1]).toMatchObject({ x: 10, y: 5, width: 100, height: 50 })
        expect(calls[2]).toEqual({ op: 'image', src: 'a.png', x: 35, y: 5, width: 50, height: 50 })
    })

    it('contain 按 align + padding 放置（PHP getContainRect 矩阵同值：非对称 padding center/center → 盒内 (37,12,25,25)）', () => {
        const canvas = decodeGraph({
            canvas: { width: 200, height: 100 },
            layers: [{
                type: 'ImageLayer',
                spec: {
                    shape: { width: 100, height: 50, padding: { top: 20, bottom: 5, left: 0, right: 10 } },
                    align: { horizontal: 'center', vertical: 'center' },
                    position: { x: 10, y: 5, position: 'top-left' },
                    fit: 'contain',
                },
                data: { valueType: 'StaticValue', value: 'a.png' },
            }],
        })
        const { calls, backend } = recordingBackend({ width: 100, height: 100 })
        renderCanvas(canvas, backend)

        // 收缩 25×25 于内容盒 90×25：盒内 (37,12) → 绝对 (47,17)
        expect(calls[2]).toEqual({ op: 'image', src: 'a.png', x: 47, y: 17, width: 25, height: 25 })
    })

    it('后端未实现度量能力（可选成员缺席）→ cover 降级走现路径', () => {
        const { calls, backend, intrinsicSize } = recordingBackend()
        renderCanvas(fitCanvas('contain'), backend)

        expect(intrinsicSize).not.toHaveBeenCalled()
        expect(calls[2]).toEqual({ op: 'image', src: 'a.png', x: 10, y: 5, width: 100, height: 50 })
    })

    it.each([
        ['null', null],
        ['零尺寸', { width: 0, height: 0 }],
        ['负尺寸', { width: 10, height: -3 }],
    ])('度量不可用（%s）→ cover 降级（PHP getimagesize 失败同门，损坏图不因 fit 崩渲染）', (_name, intrinsic) => {
        const { calls, backend } = recordingBackend(intrinsic as { width: number; height: number } | null)
        renderCanvas(fitCanvas('contain'), backend)

        expect(calls[2]).toEqual({ op: 'image', src: 'a.png', x: 10, y: 5, width: 100, height: 50 })
    })

    it('未知 fit 值降级 cover：白名单在渲染臂，度量能力不被询问', () => {
        const { calls, backend, intrinsicSize } = recordingBackend({ width: 40, height: 40 })
        renderCanvas(fitCanvas('fill'), backend)

        expect(intrinsicSize).not.toHaveBeenCalled()
        expect(calls[2]).toEqual({ op: 'image', src: 'a.png', x: 10, y: 5, width: 100, height: 50 })
    })

    it('cover 零回归：无 fit 不询问度量能力、绘制指令与现状逐字段一致', () => {
        const { calls, backend, intrinsicSize } = recordingBackend({ width: 40, height: 40 })
        renderCanvas(fitCanvas(), backend)

        expect(intrinsicSize).not.toHaveBeenCalled()
        expect(calls.map((call) => call.op)).toEqual(['begin', 'rect', 'image', 'end'])
        expect(calls[2]).toEqual({ op: 'image', src: 'a.png', x: 10, y: 5, width: 100, height: 50 })
    })
})
