/**
 * 全 fit 几何纯函数矩阵（ADR 0024，平移 php-canvas-next ImageLayerTest
 * testCoverRectMatrix / testTileRectsMatrix 同款口径）：
 * - coverSourceWindow：cover 等比居中裁窗公式唯一落点（图片臂内容盒与背景臂画布矩形共用，
 *   对齐不进源窗恒居中裁，box/scale 公式与 containRect 互为 max/min 镜像）
 * - coverSourceRect：图层版（内容盒语义，padding 经内容盒收缩间接收窄窗口）
 * - tileRects：tile 可见块矩形组（单元内在尺寸 1:1 零参数、aligned 锚定、向右下无限延伸、
 *   绘制面止于网格 ∩ 内容盒，行主序、末行末列半块截断、src/dst 可见子矩形一一对应）
 */
import { describe, expect, it } from 'vitest'

import { coverSourceRect, coverSourceWindow, decodeGraph, tileRects } from '../../src/index'
import type { ImageLayer } from '../../src/index'

/** 四边等宽 padding 造数（PHP setPadding(v) 同款） */
function pad(value: number): { top: number; bottom: number; left: number; right: number } {
    return { top: value, bottom: value, left: value, right: value }
}

/**
 * 平移 PHP ImageLayer::make(w, h) + setter 链的造数器：经 decodeGraph 产出领域
 * ImageLayer（宽进边界与真实消费形态一致）；对齐缺省 center/center（PHP 属性默认）
 */
function imageLayer(
    width: number,
    height: number,
    overrides: {
        padding?: { top: number; bottom: number; left: number; right: number }
        horizontal?: 'left' | 'center' | 'right'
        vertical?: 'top' | 'center' | 'bottom'
    } = {},
): ImageLayer {
    return decodeGraph({
        canvas: { width: 0, height: 0 },
        layers: [{
            type: 'ImageLayer',
            spec: {
                shape: {
                    width,
                    height,
                    ...(overrides.padding ? { padding: overrides.padding } : {}),
                },
                align: {
                    horizontal: overrides.horizontal ?? 'center',
                    vertical: overrides.vertical ?? 'center',
                },
            },
            data: { valueType: 'StaticValue', value: 'a.png' },
        }],
    }).layers[0] as ImageLayer
}

describe('cover 等比居中裁窗（平移 testCoverRectMatrix）', () => {
    it('竖图（1:4）进横盒（2:1）：源窗贴满宽、垂直居中裁', () => {
        expect(coverSourceRect(imageLayer(100, 50), 100, 400)).toEqual({ x: 0, y: 175, width: 100, height: 50 })
    })

    it('方图进横盒：源窗全宽、中部横带（sy = (40-20)/2 = 10）', () => {
        expect(coverSourceRect(imageLayer(100, 50), 40, 40)).toEqual({ x: 0, y: 10, width: 40, height: 20 })
    })

    it('横图（4:1）进竖盒：源窗贴满高、水平居中裁（sx 截断 87.5 → 87）', () => {
        expect(coverSourceRect(imageLayer(50, 100), 200, 50)).toEqual({ x: 87, y: 0, width: 25, height: 50 })
    })

    it('等比：源窗 = 整图，零裁切', () => {
        expect(coverSourceRect(imageLayer(100, 50), 200, 100)).toEqual({ x: 0, y: 0, width: 200, height: 100 })
    })

    it('padding 收缩内容盒 → 窗口随之收窄（80×30 内容盒 → 40×15 窗）', () => {
        expect(coverSourceRect(imageLayer(100, 50, { padding: pad(10) }), 40, 40))
            .toEqual({ x: 0, y: 12, width: 40, height: 15 })
    })

    it('对齐不影响源窗（cover 恒居中裁）', () => {
        expect(coverSourceRect(imageLayer(100, 50, { horizontal: 'left', vertical: 'top' }), 40, 40))
            .toEqual(coverSourceRect(imageLayer(100, 50), 40, 40))
    })
})

describe('coverSourceWindow 公式唯一落点（背景臂传画布矩形，无 padding 语义）', () => {
    it('图片臂（无 padding 图层版）与公式版同值', () => {
        expect(coverSourceWindow(100, 50, 40, 40)).toEqual({ x: 0, y: 10, width: 40, height: 20 })
    })

    it('画布矩形直用（320×240 画布进 100×400 竖图 → 贴满宽、垂直居中裁）', () => {
        expect(coverSourceWindow(320, 240, 100, 400)).toEqual({ x: 0, y: 162, width: 100, height: 75 })
    })

    it('等比：源窗 = 整图，零裁切', () => {
        expect(coverSourceWindow(200, 100, 200, 100)).toEqual({ x: 0, y: 0, width: 200, height: 100 })
    })
})

describe('tile 可见块矩形组（平移 testTileRectsMatrix）', () => {
    it('小图 center：网格整体居中，右/下溢出半块截断（行主序）', () => {
        expect(tileRects(imageLayer(100, 50), 40, 40)).toEqual([
            { src: { x: 0, y: 0, width: 40, height: 40 }, dst: { x: 30, y: 5, width: 40, height: 40 } },
            { src: { x: 0, y: 0, width: 30, height: 40 }, dst: { x: 70, y: 5, width: 30, height: 40 } },
            { src: { x: 0, y: 0, width: 40, height: 5 }, dst: { x: 30, y: 45, width: 40, height: 5 } },
            { src: { x: 0, y: 0, width: 30, height: 5 }, dst: { x: 70, y: 45, width: 30, height: 5 } },
        ])
    })

    it('大图 center：锚点为负露出图片中部（可见块只有网格首块的中部子矩形）', () => {
        expect(tileRects(imageLayer(100, 50), 120, 80)).toEqual([
            { src: { x: 10, y: 15, width: 100, height: 50 }, dst: { x: 0, y: 0, width: 100, height: 50 } },
        ])
    })

    it('align=right：首块贴右、锚点前空隙透明露下层，下方照常补行', () => {
        expect(tileRects(imageLayer(100, 50, { horizontal: 'right', vertical: 'top' }), 40, 40)).toEqual([
            { src: { x: 0, y: 0, width: 40, height: 40 }, dst: { x: 60, y: 0, width: 40, height: 40 } },
            { src: { x: 0, y: 0, width: 40, height: 10 }, dst: { x: 60, y: 40, width: 40, height: 10 } },
        ])
    })

    it('非均匀 padding：内容盒 (0,20)-(90,45)，网格止于交集（末列 10px 窄条）', () => {
        expect(tileRects(imageLayer(100, 50, {
            padding: { top: 20, bottom: 5, left: 0, right: 10 },
            horizontal: 'left',
            vertical: 'top',
        }), 40, 40)).toEqual([
            { src: { x: 0, y: 0, width: 40, height: 25 }, dst: { x: 0, y: 20, width: 40, height: 25 } },
            { src: { x: 0, y: 0, width: 40, height: 25 }, dst: { x: 40, y: 20, width: 40, height: 25 } },
            { src: { x: 0, y: 0, width: 10, height: 25 }, dst: { x: 80, y: 20, width: 10, height: 25 } },
        ])
    })

    it('非对称 padding + center：锚点按整盒中点（可落在内容盒起点之前），可见块以 src 偏移修正', () => {
        expect(tileRects(imageLayer(100, 50, { padding: { top: 20, bottom: 5, left: 0, right: 10 } }), 100, 100))
            .toEqual([
                { src: { x: 0, y: 45, width: 90, height: 25 }, dst: { x: 0, y: 20, width: 90, height: 25 } },
            ])
    })

    it('网格线恰好压内容盒底边：零高交集不出块', () => {
        expect(tileRects(imageLayer(80, 40, { horizontal: 'left', vertical: 'top' }), 40, 40)).toEqual([
            { src: { x: 0, y: 0, width: 40, height: 40 }, dst: { x: 0, y: 0, width: 40, height: 40 } },
            { src: { x: 0, y: 0, width: 40, height: 40 }, dst: { x: 40, y: 0, width: 40, height: 40 } },
        ])
    })

    it('内容区被 padding 吃满：交集为空，零块', () => {
        expect(tileRects(imageLayer(40, 40, { padding: pad(20) }), 40, 40)).toEqual([])
    })
})
