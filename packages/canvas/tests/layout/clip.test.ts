/**
 * 裁剪形状纯函数矩阵（ADR 0026，平移 php-canvas-next ImageLayerTest
 * testInscribedCircleRectMatrix / testCircleStrokeParsingMatrix 与 go-canvas
 * layer 包同名矩阵同款口径）：
 * - inscribedCircleRect：内切圆矩形——直径 = min(内容区宽高)、盒内对齐定位
 *   （alignedOrigin 同门）、内边距即框外留白；非方盒恒正方几何（渲染面即正圆，
 *   不变形为椭圆）；内容区被 padding 吃满/超吃负值直通（side ≤0 由渲染臂防护零绘制，
 *   PHP 数组无规范化同门——JS 矩形形态无歧义，防线同效同位在渲染臂）
 * - circleStroke：圆周描边参数解析——宽取四边已声明宽的最小值、色按
 *   top→right→bottom→left 取首个非空边色、四边全未声明不描边
 */
import { describe, expect, it } from 'vitest'

import { circleStroke, decodeGraph, inscribedCircleRect } from '../../src/index'
import type { ImageLayer } from '../../src/index'

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
        border?: {
            top?: { width: number; color: string } | null
            right?: { width: number; color: string } | null
            bottom?: { width: number; color: string } | null
            left?: { width: number; color: string } | null
        }
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
                    ...(overrides.border ? { border: overrides.border } : {}),
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

describe('内切圆矩形矩阵（平移 testInscribedCircleRectMatrix）', () => {
    it('方盒：内切圆 = 整个内容盒', () => {
        expect(inscribedCircleRect(imageLayer(100, 100))).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    })

    it('非方盒（横盒 2:1）：直径取短边 50、垂直居中，左右留透明边', () => {
        expect(inscribedCircleRect(imageLayer(100, 50))).toEqual({ x: 25, y: 0, width: 50, height: 50 })
    })

    it('对齐分量：left/top 贴内容盒原点侧，right/bottom 贴对侧（恒正圆 side=50）', () => {
        expect(inscribedCircleRect(imageLayer(100, 50, { horizontal: 'left', vertical: 'top' })))
            .toEqual({ x: 0, y: 0, width: 50, height: 50 })
        expect(inscribedCircleRect(imageLayer(100, 50, { horizontal: 'right', vertical: 'bottom' })))
            .toEqual({ x: 50, y: 0, width: 50, height: 50 })
    })

    it('padding 收缩内容盒：直径 = min(内容宽高)（内边距即框外留白）', () => {
        const pad = { top: 10, bottom: 10, left: 10, right: 10 }
        expect(inscribedCircleRect(imageLayer(100, 100, { padding: pad })))
            .toEqual({ x: 10, y: 10, width: 80, height: 80 })
    })

    it('非对称 padding：center 按整盒中点、left/top 取各自 padding 分量（contain 矩阵同款期望）', () => {
        // 内容盒 90×25 → 边长 25
        const asym = { top: 20, right: 10, bottom: 5, left: 0 }
        expect(inscribedCircleRect(imageLayer(100, 50, { padding: asym })))
            .toEqual({ x: 37, y: 12, width: 25, height: 25 })
        expect(inscribedCircleRect(imageLayer(100, 50, { padding: asym, horizontal: 'left' })))
            .toEqual({ x: 0, y: 12, width: 25, height: 25 })
        expect(inscribedCircleRect(imageLayer(100, 50, { padding: asym, vertical: 'top' })))
            .toEqual({ x: 37, y: 20, width: 25, height: 25 })
    })

    it('反例域（非法输入防线随矩阵平移）：内容区恰被 padding 吃满（side=0）与超吃（side<0）负值直通，渲染臂 side ≤0 拦截', () => {
        const full = { top: 20, bottom: 20, left: 20, right: 20 }
        expect(inscribedCircleRect(imageLayer(40, 40, { padding: full })))
            .toEqual({ x: 20, y: 20, width: 0, height: 0 })

        const over = { top: 25, bottom: 25, left: 25, right: 25 }
        // center：placedWidth = -10 → x = trunc((40-(-10))/2) = 25（PHP intval 同门）
        expect(inscribedCircleRect(imageLayer(40, 40, { padding: over })))
            .toEqual({ x: 25, y: 25, width: -10, height: -10 })
    })
})

describe('圆周描边参数解析矩阵（平移 testCircleStrokeParsingMatrix）', () => {
    it('四边全未声明：不描边', () => {
        expect(circleStroke(imageLayer(100, 100))).toBeNull()
    })

    it('单边声明：宽与色都取该边', () => {
        expect(circleStroke(imageLayer(100, 100, { border: { top: { width: 4, color: '#f00' } } })))
            .toEqual({ width: 4, color: '#f00' })
        expect(circleStroke(imageLayer(100, 100, { border: { right: { width: 3, color: '#0f0' } } })))
            .toEqual({ width: 3, color: '#0f0' })
    })

    it('多边声明：宽取最小值（top 2 < bottom 8），色按 top→right→bottom→left 取首个非空（top）', () => {
        expect(circleStroke(imageLayer(100, 100, {
            border: { top: { width: 2, color: '#f00' }, bottom: { width: 8, color: '#00f' } },
        }))).toEqual({ width: 2, color: '#f00' })
    })

    it('首个非空按序回退：top 未声明、right 5 蓝色、left 2 黄色 → 宽 2、色取 right 蓝', () => {
        expect(circleStroke(imageLayer(100, 100, {
            border: { right: { width: 5, color: '#00f' }, left: { width: 2, color: '#ff0' } },
        }))).toEqual({ width: 2, color: '#00f' })
    })

    it('全边同值：宽色一致', () => {
        const all = { width: 4, color: '#abc' }
        expect(circleStroke(imageLayer(100, 100, { border: { top: all, right: all, bottom: all, left: all } })))
            .toEqual({ width: 4, color: '#abc' })
    })

    it('反例域（Go 同款防线随矩阵平移）：width ≤0 的边不计（wire 可注入负宽，领域对象可被宿主直构）', () => {
        expect(circleStroke(imageLayer(100, 100, { border: { top: { width: -1, color: '#f00' } } }))).toBeNull()
        expect(circleStroke(imageLayer(100, 100, {
            border: { top: { width: -1, color: '#f00' }, bottom: { width: 3, color: '#00f' } },
        }))).toEqual({ width: 3, color: '#00f' })
    })
})
