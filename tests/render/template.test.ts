import { describe, expect, it } from 'vitest'

import { decodeGraph, qrImageSrc, renderCanvas } from '../../src/index'
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

    it('工单 03 内容分派：图片/文本绘制原语接入（QR 随工单 04 接入）', () => {
        const canvas = decodeGraph({
            canvas: { width: 100, height: 100 },
            layers: [
                // 图片：内容盒 80×80（padding 10），cover 原点 = center/center → (10, 10)
                { type: 'ImageLayer', spec: { shape: { width: 100, height: 100, padding: { top: 10, bottom: 10, left: 10, right: 10 } } }, data: { value: 'a.png' } },
                // 无 src 只画盒
                { type: 'ImageLayer', spec: { shape: { width: 10, height: 10 } } },
                // 文本：非 autowrap 单行；left/bottom 缺省
                { type: 'TextLayer', spec: { shape: { width: 40, height: 30 }, fontFamily: { fontSize: 10 } }, data: { value: '文本' } },
                { type: 'QrCodeLayer', spec: { shape: { width: 10, height: 10 } }, data: { value: 'qr' } },
            ],
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        const images = calls.filter((call) => call.op === 'image')
        expect(images).toEqual([
            { op: 'image', src: 'a.png', x: 10, y: 10, width: 80, height: 80 },
            // QR：图层原点起按宽度正方形铺放（PHP paintQrCode 同门）
            { op: 'image', src: 'qr:qr', x: 0, y: 0, width: 10, height: 10 },
        ])

        const texts = calls.filter((call) => call.op === 'text')
        expect(texts).toEqual([
            // left/bottom 缺省：x = 0 + 0，y = 0 + contentHeight(30) = 30
            { op: 'text', line: '文本', x: 0, y: 30 },
        ])
    })

    it('工单 04 QR 绘制：内容盒无关、忽略 padding/align，声明高 ≠ 宽时仍按宽铺正方形', () => {
        const canvas = decodeGraph({
            canvas: { width: 200, height: 200 },
            layers: [{
                type: 'QrCodeLayer',
                spec: {
                    shape: {
                        width: 80,
                        height: 40, // 声明高 ≠ 宽：PHP getHeight 声明优先生效，但图像仍宽×宽
                        padding: { top: 5, bottom: 5, left: 7, right: 7 },
                    },
                    align: { horizontal: 'center', vertical: 'center' },
                    position: { x: 10, y: 20 },
                },
                data: { value: 'https://example.com/join' },
            }],
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        expect(calls.filter((call) => call.op === 'image')).toEqual([
            { op: 'image', src: 'qr:https://example.com/join', x: 10, y: 20, width: 80, height: 80 },
        ])
        // 盒高按声明（40），QR 内容铺宽 × 宽（80）
        expect(rects(calls)[0]).toMatchObject({ width: 80, height: 40 })
    })

    it('工单 04 QR：空值不绘制；表格单元格内的 QR 同样分派', () => {
        const canvas = decodeGraph({
            canvas: { width: 300, height: 100 },
            layers: [
                { type: 'QrCodeLayer', spec: { shape: { width: 20, height: 20 } }, data: { value: '' } },
                {
                    type: 'TableLayer',
                    spec: { shape: { width: 100, height: 40 }, position: { x: 10, y: 20 } },
                    rows: [{
                        type: 'TableRowLayer',
                        spec: { shape: { width: 100, height: 40 } },
                        cells: [{
                            type: 'TableCellLayer',
                            spec: { shape: { width: 50, height: 40 } },
                            content: { type: 'QrCodeLayer', spec: { shape: { width: 30, height: 30 } }, data: { value: 'cell' } },
                        }],
                    }],
                },
            ],
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        expect(calls.filter((call) => call.op === 'image')).toEqual([
            // 单元格内容层与单元格同原点（10, 20）；addContentLayer 副作用把内容宽
            // 同步为 cell 宽 50，QR 按同步后的宽铺 50×50 正方形
            { op: 'image', src: 'qr:cell', x: 10, y: 20, width: 50, height: 50 },
        ])
    })

    it('qrImageSrc：QR 内容的绘制引用键（物化器经 setImage 回写同键）', () => {
        expect(qrImageSrc('https://example.com')).toBe('qr:https://example.com')
    })

    it('autowrap 文本逐行分派：行高推进 + autoHeight 动态高一致', () => {
        const canvas = decodeGraph({
            canvas: { width: 100, height: 100 },
            layers: [{
                type: 'TextLayer',
                spec: {
                    shape: { width: 50, height: 'auto', autoHeight: true },
                    fontFamily: { fontSize: 10, autowrap: true },
                },
                data: { value: '一二三四五六七' },
            }],
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        const texts = calls.filter((call) => call.op === 'text')
        expect(texts).toEqual([
            // bottom+autowrap 两行：首行锚点 y = 动态高 20 - 行高 10×(2-1) = 10
            { op: 'text', line: '一二三四五', x: 0, y: 10 },
            { op: 'text', line: '六七', x: 0, y: 20 },
        ])
        // 盒高 = 行高 10 × 2 行
        expect(rects(calls)[0]).toMatchObject({ width: 50, height: 20 })
    })

    it('空文本行也分派 drawText（空行守卫归后端；与快照契约 paint 序一致）', () => {
        const canvas = decodeGraph({
            canvas: { width: 100, height: 100 },
            layers: [{
                type: 'TextLayer',
                spec: { shape: { width: 40, height: 20 }, fontFamily: { fontSize: 10 } },
                data: { value: '' },
            }],
        })
        const { calls, backend } = recordingBackend()
        renderCanvas(canvas, backend)

        expect(calls.filter((call) => call.op === 'text')).toEqual([
            { op: 'text', line: '', x: 0, y: 20 },
        ])
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
