import { describe, expect, it } from 'vitest'

import { decodeGraph, renderCanvas } from '../../src/index'
import type { Border, RenderBackend } from '../../src/index'

interface CallRecord {
    op: 'begin' | 'end' | 'rect' | 'image' | 'text'
    [key: string]: unknown
}

/** 录制后端：只记录原语调用序与几何，不产像素（渲染端测试走点位/调用序断言，不做逐像素复刻） */
function recordingBackend() {
    const calls: CallRecord[] = []
    const backend: RenderBackend = {
        begin(width, height) {
            calls.push({ op: 'begin', width, height })
        },
        end() {
            calls.push({ op: 'end' })
        },
        drawRect(x, y, width, height, bgColor, border) {
            calls.push({ op: 'rect', x, y, width, height, bgColor, border })
        },
        drawImage(src, x, y, width, height) {
            calls.push({ op: 'image', src, x, y, width, height })
        },
        drawText(line, x, y) {
            calls.push({ op: 'text', line, x, y })
        },
    }
    return { calls, backend }
}

function rects(calls: CallRecord[]) {
    return calls.filter((call) => call.op === 'rect')
}

const NO_BORDER: Border = { top: null, bottom: null, left: null, right: null }

describe('五原语渲染模板', () => {
    it('begin/end 包裹整棵树，尺寸取画布声明', () => {
        const { calls, backend } = recordingBackend()
        renderCanvas(decodeGraph({ canvas: { width: 320, height: 200 }, layers: [] }), backend)

        expect(calls[0]).toEqual({ op: 'begin', width: 320, height: 200 })
        expect(calls[calls.length - 1]).toEqual({ op: 'end' })
    })

    it('priority 降序绘制：数组头先画垫底（模板按解码后的画布层序直绘）', () => {
        const canvas = decodeGraph({
            canvas: { width: 100, height: 100 },
            layers: [
                { type: 'ImageLayer', priority: 1, spec: { shape: { width: 10, height: 10, backgroundColor: '#low' } } },
                { type: 'ImageLayer', priority: 5, spec: { shape: { width: 10, height: 10, backgroundColor: '#high' } } },
                { type: 'ImageLayer', priority: 1, spec: { shape: { width: 10, height: 10, backgroundColor: '#low2' } } },
            ],
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        const boxes = rects(calls)
        expect(boxes.map((box) => box.bgColor)).toEqual(['#high', '#low', '#low2'])
    })

    it('锚点与定位合成绝对原点：bottom-right + 偏移', () => {
        const canvas = decodeGraph({
            canvas: { width: 100, height: 80 },
            layers: [{
                type: 'ImageLayer',
                spec: {
                    shape: { width: 20, height: 10, backgroundColor: '#x' },
                    position: { x: 5, y: 6, position: 'bottom-right' },
                },
            }],
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        expect(rects(calls)[0]).toMatchObject({ x: 100 - 20 + 5, y: 80 - 10 + 6 })
    })

    it('负溢出不钳位：子层大于父盒得到负绝对坐标', () => {
        const canvas = decodeGraph({
            canvas: { width: 10, height: 10 },
            layers: [{
                type: 'ImageLayer',
                spec: {
                    shape: { width: 50, height: 50, backgroundColor: '#big' },
                    // wire 的 position 需 x/y 齐备才生效（PHP isset 双门），锚点也要带上偏移键
                    position: { x: 0, y: 0, position: 'bottom-right' },
                },
            }],
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        expect(rects(calls)[0]).toMatchObject({ x: -40, y: -40 })
    })

    it('背景与四边 border 原样传给后端', () => {
        const canvas = decodeGraph({
            canvas: { width: 10, height: 10 },
            layers: [{
                type: 'ImageLayer',
                spec: {
                    shape: {
                        width: 30,
                        height: 20,
                        backgroundColor: '#fff',
                        border: {
                            top: { width: 2, color: '#f00' },
                            bottom: null,
                            left: { width: 1, color: '#00f' },
                            right: null,
                        },
                    },
                },
            }],
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        expect(rects(calls)[0]).toMatchObject({
            bgColor: '#fff',
            border: {
                top: { width: 2, color: '#f00' },
                bottom: null,
                left: { width: 1, color: '#00f' },
                right: null,
            },
        })
    })

    it('表格下钻：行纵向堆叠、单元格横向排布、内容层与单元格同原点', () => {
        const canvas = decodeGraph({
            canvas: { width: 300, height: 100 },
            layers: [{
                type: 'TableLayer',
                spec: { shape: { width: 100, height: 40, backgroundColor: '#table' }, position: { x: 10, y: 20 } },
                rows: [
                    {
                        type: 'TableRowLayer',
                        spec: { shape: { width: 100, height: 10, backgroundColor: '#row1' } },
                        cells: [
                            { type: 'TableCellLayer', spec: { shape: { width: 50, height: 10, backgroundColor: '#cell1' } } },
                            {
                                type: 'TableCellLayer',
                                spec: { shape: { width: 40, height: 10, backgroundColor: '#cell2' } },
                                content: {
                                    type: 'TextLayer',
                                    spec: { shape: { width: 40, height: 10, backgroundColor: '#content' } },
                                    data: { value: '文本' },
                                },
                            },
                        ],
                    },
                    {
                        type: 'TableRowLayer',
                        spec: { shape: { width: 100, height: 30, backgroundColor: '#row2' } },
                        cells: [],
                    },
                ],
            }],
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        expect(rects(calls).map((rect) => [rect.bgColor, rect.x, rect.y])).toEqual([
            ['#table', 10, 20],
            ['#row1', 10, 20], // 行1：表原点起
            ['#cell1', 10, 20], // 单元格1：行原点起
            ['#cell2', 60, 20], // 单元格2：单元格1 宽 50 之后
            ['#content', 60, 20], // 内容层与所属单元格同原点
            ['#row2', 10, 30], // 行2：行1 高 10 之后
        ])
    })

    it('工单 02 占位语义：文本/图片/QR 只画盒，不触发 drawImage/drawText', () => {
        const canvas = decodeGraph({
            canvas: { width: 100, height: 100 },
            layers: [
                { type: 'ImageLayer', spec: { shape: { width: 10, height: 10 } }, data: { value: 'a.png' } },
                { type: 'TextLayer', spec: { shape: { width: 10, height: 10 } }, data: { value: '文本' } },
                { type: 'QrCodeLayer', spec: { shape: { width: 10, height: 10 } }, data: { value: 'qr' } },
            ],
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        expect(rects(calls)).toHaveLength(3)
        expect(calls.filter((call) => call.op === 'image')).toEqual([])
        expect(calls.filter((call) => call.op === 'text')).toEqual([])
    })

    it('autoHeight 文本/QR 的动态高参与盒绘制（盒高非 0，占位盒可见）', () => {
        const canvas = decodeGraph({
            canvas: { width: 100, height: 100 },
            layers: [
                {
                    type: 'TextLayer',
                    spec: {
                        shape: { width: 60, height: 'auto', autoWidth: false, autoHeight: true },
                        fontFamily: { fontSize: 14 },
                        position: { x: 0, y: 0 },
                    },
                    data: { value: '文本' },
                },
                { type: 'QrCodeLayer', spec: { shape: { width: 30, height: 'auto' }, position: { position: 'top-left' } } },
            ],
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        expect(rects(calls)[0]).toMatchObject({ width: 60, height: 14 })
        expect(rects(calls)[1]).toMatchObject({ width: 30, height: 30 })
    })

    it('NO_BORDER 常量即无边框盒', () => {
        expect(NO_BORDER).toEqual({ top: null, bottom: null, left: null, right: null })
    })
})
