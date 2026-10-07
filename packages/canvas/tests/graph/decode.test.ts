import { describe, expect, it } from 'vitest'

import { decodeGraph, decodeLayer, UnknownLayerTypeError } from '../../src/index'
import type { ImageLayer, QrCodeLayer, TableLayer, TableCellLayer, TextLayer } from '../../src/index'

/** 逐值平移 php-canvas-next 的解码用例（CanvasTest/LayerTest/AbstractLayerTest 清单）：
 *  缺省回填、字符串数字收整（向零截断）、'auto' 标志、未知 type 报错。 */
describe('wire → 领域解码', () => {
    it('最小 wire 回填全部缺省（基础层；取 QrCodeLayer 承载通用缺省）', () => {
        const canvas = decodeGraph({
            canvas: { width: 100, height: 80 },
            layers: [{ type: 'QrCodeLayer' }],
        })

        expect(canvas.width).toBe(100)
        expect(canvas.height).toBe(80)
        const layer = canvas.layers[0]!
        expect(layer.type).toBe('QrCodeLayer')
        expect(layer.priority).toBe(0)
        expect(layer.shape.width).toBe(0)
        expect(layer.shape.height).toBe(0)
        expect(layer.shape.autoWidth).toBe(false)
        expect(layer.shape.autoHeight).toBe(false)
        expect(layer.shape.lineHeight).toBe(1)
        expect(layer.shape.padding).toEqual({ top: 0, bottom: 0, left: 0, right: 0 })
        expect(layer.shape.border).toEqual({ top: null, bottom: null, left: null, right: null })
        expect(layer.shape.backgroundColor).toBeNull()
        expect(layer.align).toEqual({ horizontal: 'left', vertical: 'top' })
        expect(layer.position).toEqual({ x: 0, y: 0, anchor: 'top-left' })
    })

    it('对齐缺省逐类型平移 PHP 属性默认：Image center/center、Text left/bottom', () => {
        expect(decodeLayer({ type: 'ImageLayer' }).align).toEqual({ horizontal: 'center', vertical: 'center' })
        expect(decodeLayer({ type: 'TextLayer' }).align).toEqual({ horizontal: 'left', vertical: 'bottom' })
        expect(decodeLayer({ type: 'QrCodeLayer' }).align).toEqual({ horizontal: 'left', vertical: 'top' })
        expect(decodeLayer({ type: 'TableLayer' }).align).toEqual({ horizontal: 'left', vertical: 'top' })
    })

    it('字符串数字收整：向零截断（PHP intval 语义）', () => {
        const layer = decodeLayer({
            type: 'TableLayer',
            priority: '3',
            spec: {
                shape: { width: '30', height: '40.7', lineHeight: '1.5' },
                position: { x: '5', y: '6.9' },
            },
        })

        expect(layer.priority).toBe(3)
        expect(layer.shape.width).toBe(30)
        expect(layer.shape.height).toBe(40)
        expect(layer.shape.lineHeight).toBe(1.5)
        expect(layer.position.x).toBe(5)
        expect(layer.position.y).toBe(6)
    })

    it('负数与负小数向零截断', () => {
        const layer = decodeLayer({
            type: 'ImageLayer',
            spec: { shape: { width: '-12.5', height: -7.9 }, position: { x: '-3.5', y: -2 } },
        })

        expect(layer.shape.width).toBe(-12)
        expect(layer.shape.height).toBe(-7)
        expect(layer.position.x).toBe(-3)
        expect(layer.position.y).toBe(-2)
    })

    describe("'auto' 标志", () => {
        it("'auto' 字符串与 autoWidth 标志都置 auto 并清零尺寸（大小写不敏感）", () => {
            const auto = decodeLayer({
                type: 'ImageLayer',
                spec: { shape: { width: 'auto', height: 'AUTO', autoWidth: true, autoHeight: true } },
            })

            expect(auto.shape.autoWidth).toBe(true)
            expect(auto.shape.width).toBe(0)
            expect(auto.shape.autoHeight).toBe(true)
            expect(auto.shape.height).toBe(0)
        })

        it('autoWidth false 时走声明值', () => {
            const fixed = decodeLayer({
                type: 'ImageLayer',
                spec: { shape: { width: '30', height: 40, autoWidth: false, autoHeight: false } },
            })

            expect(fixed.shape.width).toBe(30)
            expect(fixed.shape.height).toBe(40)
            expect(fixed.shape.autoWidth).toBe(false)
            expect(fixed.shape.autoHeight).toBe(false)
        })

        it("autoWidth '0' 按假处理（PHP ?: 真值语义）", () => {
            const layer = decodeLayer({
                type: 'ImageLayer',
                spec: { shape: { width: 25, autoWidth: '0' } },
            })

            expect(layer.shape.width).toBe(25)
            expect(layer.shape.autoWidth).toBe(false)
        })

        it('width 键缺席时 autoWidth 标志整体被忽略（PHP array_key_exists 门）', () => {
            const layer = decodeLayer({
                type: 'ImageLayer',
                spec: { shape: { autoWidth: true } },
            })

            expect(layer.shape.width).toBe(0)
            expect(layer.shape.autoWidth).toBe(false)
        })
    })

    it('padding 字符串收整且缺边回填 0', () => {
        const layer = decodeLayer({
            type: 'ImageLayer',
            spec: { shape: { padding: { top: '10', left: 2.5 } } },
        })

        expect(layer.shape.padding).toEqual({ top: 10, bottom: 0, left: 2.5, right: 0 })
    })

    it('border 逐边回填：width 收整、color 缺省 #000、缺边为 null', () => {
        const layer = decodeLayer({
            type: 'ImageLayer',
            spec: {
                shape: {
                    border: { top: { width: '2', color: '#f00' }, bottom: { width: 1 } },
                },
            },
        })

        expect(layer.shape.border.top).toEqual({ width: 2, color: '#f00' })
        expect(layer.shape.border.bottom).toEqual({ width: 1, color: '#000' })
        expect(layer.shape.border.left).toBeNull()
        expect(layer.shape.border.right).toBeNull()
    })

    it('backgroundColor：字符串原样保留、null 回填；空串保留（往返恒等优先）', () => {
        expect(decodeLayer({ type: 'ImageLayer', spec: { shape: { backgroundColor: '#fff' } } }).shape.backgroundColor).toBe('#fff')
        expect(decodeLayer({ type: 'ImageLayer', spec: { shape: { backgroundColor: null } } }).shape.backgroundColor).toBeNull()
        expect(decodeLayer({ type: 'ImageLayer', spec: { shape: { backgroundColor: '' } } }).shape.backgroundColor).toBe('')
    })

    it('align 键缺席回填类型缺省；取值未知回退 left/top（PHP 渲染端 default 兜底语义）', () => {
        const ok = decodeLayer({
            type: 'ImageLayer',
            spec: { align: { horizontal: 'right', vertical: 'center' } },
        })
        expect(ok.align).toEqual({ horizontal: 'right', vertical: 'center' })

        // junk 取值不回类型缺省（Image 的 center/center），而与 PHP 渲染兜底一致落 left/top
        const junkText = decodeLayer({
            type: 'TextLayer',
            spec: { align: { horizontal: 'middle', vertical: 'middle' } },
        })
        expect(junkText.align).toEqual({ horizontal: 'left', vertical: 'top' })

        const junkImage = decodeLayer({
            type: 'ImageLayer',
            spec: { align: { horizontal: 'middle', vertical: 'middle' } },
        })
        expect(junkImage.align).toEqual({ horizontal: 'left', vertical: 'top' })
    })

    describe('position', () => {
        it('x/y 齐备才生效，anchor 缺省 top-left', () => {
            const both = decodeLayer({
                type: 'ImageLayer',
                spec: { position: { x: 5, y: 6, position: 'bottom-right' } },
            })
            expect(both.position).toEqual({ x: 5, y: 6, anchor: 'bottom-right' })

            const noAnchor = decodeLayer({
                type: 'ImageLayer',
                spec: { position: { x: 1, y: 2 } },
            })
            expect(noAnchor.position).toEqual({ x: 1, y: 2, anchor: 'top-left' })
        })

        it('x 或 y 缺席时整块忽略（PHP isset 双门），未知 anchor 回退 top-left', () => {
            const missingY = decodeLayer({ type: 'ImageLayer', spec: { position: { x: 5 } } })
            expect(missingY.position).toEqual({ x: 0, y: 0, anchor: 'top-left' })

            const junkAnchor = decodeLayer({
                type: 'ImageLayer',
                spec: { position: { x: 1, y: 2, position: 'middle' } },
            })
            expect(junkAnchor.position).toEqual({ x: 1, y: 2, anchor: 'top-left' })
        })
    })

    describe('TextLayer 专属', () => {
        it('fontFamily 部分缺省回填（font 空串、fontSize 12、fontColor #000000、angle 0、autowrap false）', () => {
            const layer = decodeLayer({
                type: 'TextLayer',
                spec: { fontFamily: { fontSize: '14' } },
                data: { value: '正文' },
            }) as TextLayer

            expect(layer.text).toBe('正文')
            expect(layer.font).toBe('')
            expect(layer.fontSize).toBe(14)
            expect(layer.fontColor).toBe('#000000')
            expect(layer.angle).toBe(0)
            expect(layer.autowrap).toBe(false)
        })

        it('数字 value 转字符串、angle 收整、autowrap 真值语义（PHP (bool)）', () => {
            const layer = decodeLayer({
                type: 'TextLayer',
                spec: {
                    fontFamily: { font: 'msyh.ttf', fontSize: 14, fontColor: '#333', angle: '90', autowrap: 1 },
                },
                data: { value: 123 },
            }) as TextLayer

            expect(layer.text).toBe('123')
            expect(layer.font).toBe('msyh.ttf')
            expect(layer.fontSize).toBe(14)
            expect(layer.fontColor).toBe('#333')
            expect(layer.angle).toBe(90)
            expect(layer.autowrap).toBe(true)
        })

        it("autowrap '0' 与空串按假（PHP (bool) 字符串语义）", () => {
            expect((decodeLayer({ type: 'TextLayer', spec: { fontFamily: { autowrap: '0' } } }) as TextLayer).autowrap).toBe(false)
            expect((decodeLayer({ type: 'TextLayer', spec: { fontFamily: { autowrap: '' } } }) as TextLayer).autowrap).toBe(false)
        })

        it('data 缺席 → 空文本', () => {
            expect((decodeLayer({ type: 'TextLayer' }) as TextLayer).text).toBe('')
        })
    })

    describe('ImageLayer 专属', () => {
        it('value 进 src；空串与 null 归 null（PHP setImage 语义）', () => {
            expect((decodeLayer({ type: 'ImageLayer', data: { value: 'https://x/a.png' } }) as ImageLayer).src).toBe('https://x/a.png')
            expect((decodeLayer({ type: 'ImageLayer', data: { value: '' } }) as ImageLayer).src).toBeNull()
            expect((decodeLayer({ type: 'ImageLayer', data: {} }) as ImageLayer).src).toBeNull()
            expect((decodeLayer({ type: 'ImageLayer' }) as ImageLayer).src).toBeNull()
        })

        it('数字 value 转字符串（PHP 弱类型参数收整）', () => {
            expect((decodeLayer({ type: 'ImageLayer', data: { value: 123 } }) as ImageLayer).src).toBe('123')
        })
    })

    describe('QrCodeLayer 专属', () => {
        it('value 缺省空串', () => {
            expect((decodeLayer({ type: 'QrCodeLayer' }) as QrCodeLayer).value).toBe('')
            expect((decodeLayer({ type: 'QrCodeLayer', data: { value: 'https://example.com' } }) as QrCodeLayer).value).toBe('https://example.com')
        })
    })

    describe('表格容器（镜像 addRow/addCell/addContentLayer 副作用）', () => {
        it('addRow 同步行宽到表宽且关 autoWidth', () => {
            const table = decodeLayer({
                type: 'TableLayer',
                spec: { shape: { width: 100, height: 40 } },
                rows: [
                    { type: 'TableRowLayer', spec: { shape: { width: 50, height: 10 } }, cells: [] },
                ],
            }) as TableLayer

            expect(table.type).toBe('TableLayer')
            const row = table.rows[0]!
            expect(row.shape.width).toBe(100)
            expect(row.shape.autoWidth).toBe(false)
        })

        it('addCell 行高取最高单元格并固化（关 autoHeight）', () => {
            const table = decodeLayer({
                type: 'TableLayer',
                spec: { shape: { width: 100, height: 40 } },
                rows: [
                    {
                        type: 'TableRowLayer',
                        spec: { shape: { width: 100, height: 'auto' } },
                        cells: [
                            { type: 'TableCellLayer', spec: { shape: { width: 50, height: 12 } } },
                            { type: 'TableCellLayer', spec: { shape: { width: 50, height: 30 } } },
                        ],
                    },
                ],
            }) as TableLayer

            const row = table.rows[0]!
            expect(row.shape.height).toBe(30)
            expect(row.shape.autoHeight).toBe(false)
        })

        it('auto cell 采纳内容动态高并固化（PHP addContentLayer auto 分支）', () => {
            const cell = decodeLayer({
                type: 'TableCellLayer',
                spec: { shape: { width: 100, height: 'auto' } },
                content: {
                    type: 'TextLayer',
                    spec: { shape: { width: 100, height: 'auto' }, fontFamily: { fontSize: 12 } },
                    data: { value: '内容' },
                },
            }) as TableCellLayer

            expect(cell.shape.height).toBe(12)
            expect(cell.shape.autoHeight).toBe(false)
            expect(cell.content?.type).toBe('TextLayer')
            // 内容宽同步 cell 宽
            expect(cell.content?.shape.width).toBe(100)
            expect(cell.content?.shape.autoWidth).toBe(false)
        })

        it('固定 cell 压平内容高并关内容 autoHeight（PHP addContentLayer 固定分支）', () => {
            const cell = decodeLayer({
                type: 'TableCellLayer',
                spec: { shape: { width: 100, height: 20 } },
                content: {
                    type: 'TextLayer',
                    spec: { shape: { width: 100, height: 'auto' }, fontFamily: { fontSize: 12 } },
                    data: { value: '内容' },
                },
            }) as TableCellLayer

            expect(cell.shape.height).toBe(20)
            expect(cell.content?.shape.height).toBe(20)
            expect(cell.content?.shape.autoHeight).toBe(false)
        })

        it('content 缺省 null；PHP !empty 同门：\'0\'/0/false/[] 视为无内容', () => {
            expect((decodeLayer({ type: 'TableCellLayer' }) as TableCellLayer).content).toBeNull()
            expect((decodeLayer({ type: 'TableCellLayer', content: '' }) as TableCellLayer).content).toBeNull()
            expect((decodeLayer({ type: 'TableCellLayer', content: '0' }) as TableCellLayer).content).toBeNull()
            expect((decodeLayer({ type: 'TableCellLayer', content: 0 }) as TableCellLayer).content).toBeNull()
            expect((decodeLayer({ type: 'TableCellLayer', content: false }) as TableCellLayer).content).toBeNull()
            expect((decodeLayer({ type: 'TableCellLayer', content: [] }) as TableCellLayer).content).toBeNull()
        })
    })

    describe('未知 type 报错（非静默丢弃）', () => {
        it('顶层未知 type 抛 UnknownLayerTypeError 且消息含类型名', () => {
            expect(() => decodeLayer({ type: 'VideoLayer' })).toThrow(UnknownLayerTypeError)
            expect(() => decodeLayer({ type: 'VideoLayer' })).toThrow(/VideoLayer/)
        })

        it('graph 级未知 type 报错（平移 CanvasTest::testFromGraphRejectsUnknownType）', () => {
            expect(() =>
                decodeGraph({
                    canvas: { width: 10, height: 10 },
                    layers: [{ type: 'VideoLayer', priority: 0, spec: {} }],
                }),
            ).toThrow(UnknownLayerTypeError)
        })

        it('嵌套 content 与 type 缺失同样报错', () => {
            expect(() =>
                decodeLayer({ type: 'TableCellLayer', content: { type: 'AudioLayer' } }),
            ).toThrow(UnknownLayerTypeError)
            expect(() => decodeLayer({})).toThrow(UnknownLayerTypeError)
        })
    })

    it('priority 降序排列，等优先级保持 wire 序（稳定排序）', () => {
        const canvas = decodeGraph({
            canvas: { width: 10, height: 10 },
            layers: [
                { type: 'ImageLayer', priority: 1, spec: { shape: { width: 1 } } },
                { type: 'ImageLayer', priority: 5, spec: { shape: { width: 2 } } },
                { type: 'ImageLayer', priority: 1, spec: { shape: { width: 3 } } },
            ],
        })

        expect(canvas.layers.map((layer) => layer.priority)).toEqual([5, 1, 1])
        expect(canvas.layers[1]!.shape.width).toBe(1)
        expect(canvas.layers[2]!.shape.width).toBe(3)
    })
})
