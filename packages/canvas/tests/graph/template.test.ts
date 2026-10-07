import { describe, expect, it } from 'vitest'

import {
    decodeGraph,
    decodeLayer,
    encodeGraph,
    encodeLayer,
    RowsPathMissingError,
    TemplateRowsConflictError,
} from '../../src/index'
import type {
    ImageLayer,
    QrCodeLayer,
    TableRowTemplateLayer,
    TableLayer,
    TextLayer,
    WireGraph,
    WireLayerNode,
} from '../../src/index'

/** canonical wire 造数器：键级对齐 php-canvas-next graph() 输出（往返恒等的输入形态） */
function baseNode(type: WireLayerNode['type'], overrides: Record<string, unknown> = {}): WireLayerNode {
    return {
        type,
        priority: 0,
        spec: {
            shape: {
                width: 0,
                height: 0,
                autoWidth: false,
                autoHeight: false,
                lineHeight: 1,
                padding: { top: 0, bottom: 0, left: 0, right: 0 },
                border: { top: null, bottom: null, left: null, right: null },
                backgroundColor: null,
            },
            align: { horizontal: 'left', vertical: 'top' },
            position: { x: 0, y: 0, position: 'top-left' },
        },
        ...overrides,
    }
}

/** canonical 全量 shape（与 baseNode 的 shape 字面同源派生，避免两份漂移） */
const FULL_SHAPE = baseNode('ImageLayer').spec!.shape!

/** spec §2.5 canonical wire：模板表全键形态（示意键补全为 canonical 全量） */
function canonicalTemplateTableWire(): WireLayerNode {
    return baseNode('TableLayer', {
        priority: 0,
        spec: {
            shape: { ...FULL_SHAPE, width: 320, height: 200 },
            align: { horizontal: 'left', vertical: 'top' },
            position: { x: 0, y: 0, position: 'top-left' },
        },
        data: { rowsPath: 'order.items' },
        template: baseNode('TableRowTemplate', {
            spec: {
                shape: { ...FULL_SHAPE, width: 320, height: 0, autoHeight: true },
                align: { horizontal: 'left', vertical: 'top' },
                position: { x: 0, y: 0, position: 'top-left' },
            },
            cells: [
                baseNode('TableCellLayer', {
                    spec: {
                        shape: { ...FULL_SHAPE, width: 160, height: 0, autoHeight: true },
                        align: { horizontal: 'left', vertical: 'top' },
                        position: { x: 0, y: 0, position: 'top-left' },
                    },
                    content: baseNode('TextLayer', {
                        spec: {
                            shape: { ...FULL_SHAPE, width: 160, height: 0, autoHeight: true },
                            align: { horizontal: 'left', vertical: 'bottom' },
                            position: { x: 0, y: 0, position: 'top-left' },
                            fontFamily: { font: '', fontSize: 12, fontColor: '#000000', angle: 0, autowrap: false },
                        },
                        data: {
                            valueType: 'ExpressionValue',
                            expression: '姓名：{{row.name}}（{{$index}}）',
                            value: '姓名：{{row.name}}（{{$index}}）',
                        },
                    }),
                }),
                baseNode('TableCellLayer', {
                    spec: {
                        shape: { ...FULL_SHAPE, width: 160, height: 40 },
                        align: { horizontal: 'left', vertical: 'top' },
                        position: { x: 0, y: 0, position: 'top-left' },
                    },
                    content: baseNode('ImageLayer', {
                        spec: {
                            shape: { ...FULL_SHAPE, width: 160, height: 40 },
                            align: { horizontal: 'center', vertical: 'center' },
                            position: { x: 0, y: 0, position: 'top-left' },
                        },
                        data: { valueType: 'ExpressionValue', expression: '{{row.avatar}}', value: '{{row.avatar}}' },
                    }),
                }),
                baseNode('TableCellLayer', {
                    spec: {
                        shape: { ...FULL_SHAPE, width: 160, height: 40 },
                        align: { horizontal: 'left', vertical: 'top' },
                        position: { x: 0, y: 0, position: 'top-left' },
                    },
                    content: baseNode('QrCodeLayer', {
                        spec: {
                            shape: { ...FULL_SHAPE, width: 160, height: 40 },
                            align: { horizontal: 'left', vertical: 'top' },
                            position: { x: 0, y: 0, position: 'top-left' },
                        },
                        data: { valueType: 'ExpressionValue', expression: '{{row.code}}', value: '{{row.code}}' },
                    }),
                }),
            ],
        }),
    })
}

describe('模板态 canonical wire 往返恒等（spec §2.5）', () => {
    it('spec §2.5 示例（补全 canonical 全量键）→ decode → encode deep-equal', () => {
        const wire = canonicalTemplateTableWire()

        expect(encodeLayer(decodeLayer(wire))).toEqual(wire)
    })

    it('画布级往返恒等且 decode→encode→decode→encode 幂等', () => {
        const wire: WireGraph = {
            canvas: { width: 400, height: 300 },
            layers: [canonicalTemplateTableWire()],
        }

        const first = encodeGraph(decodeGraph(wire))
        expect(first).toEqual(wire)
        expect(encodeGraph(decodeGraph(first))).toEqual(first)
    })

    it('hostile：wire value 与 expression 分歧时域值取 expression（PHP setExpression 镜像）', () => {
        const wire = canonicalTemplateTableWire()
        const template = wire.template as WireLayerNode
        const cell = (template.cells as WireLayerNode[])[0]!
        ;((cell.content as WireLayerNode).data as Record<string, unknown>).value = '字面文案'

        const decoded = decodeLayer(wire) as TableLayer
        const text = (decoded.template!.cells[0]!.content as TextLayer)
        expect(text.expression).toBe('姓名：{{row.name}}（{{$index}}）')
        expect(text.text).toBe('姓名：{{row.name}}（{{$index}}）')

        // decode 已归一：encode 落 value = expression（wire 原文不保留）
        const encoded = encodeLayer(decoded)
        const encodedTextData = (((encoded.template as WireLayerNode).cells as WireLayerNode[])[0]!
            .content as WireLayerNode).data as Record<string, unknown>
        expect(encodedTextData.value).toBe('姓名：{{row.name}}（{{$index}}）')
    })
})

describe('模板态解码域形态（镜像 TableLayer::fromGraph + setTemplate/addTemplateContentLayer）', () => {
    it('rows 空数组落域、rowsPath 落域、模板子树完整', () => {
        const decoded = decodeLayer(canonicalTemplateTableWire()) as TableLayer

        expect(decoded.rows).toEqual([])
        expect(decoded.rowsPath).toBe('order.items')
        expect(decoded.template).not.toBeNull()
        expect(decoded.template!.type).toBe('TableRowTemplate')
        expect(decoded.template!.cells).toHaveLength(3)
        expect((decoded.template!.cells[0]!.content as TextLayer).text).toBe('姓名：{{row.name}}（{{$index}}）')
        expect((decoded.template!.cells[1]!.content as ImageLayer).src).toBe('{{row.avatar}}')
        expect((decoded.template!.cells[2]!.content as QrCodeLayer).value).toBe('{{row.code}}')
    })

    it('宽度耦合沿用：模板行宽=表宽关 autoWidth、内容宽=格宽关 autoWidth', () => {
        const wire = canonicalTemplateTableWire()
        // wire 行宽声明与表宽分歧：装配后以表宽为准（setTemplate→setWidth 镜像）
        ;((wire.template as WireLayerNode).spec as Record<string, unknown>).shape = { ...FULL_SHAPE, width: 999, height: 0, autoHeight: true }

        const decoded = decodeLayer(wire) as TableLayer
        const template = decoded.template!

        expect(template.shape.width).toBe(320)
        expect(template.shape.autoWidth).toBe(false)
        expect(template.cells[0]!.content?.shape.width).toBe(160)
        expect(template.cells[0]!.content?.shape.autoWidth).toBe(false)
        expect(template.cells[1]!.content?.shape.width).toBe(160)
        expect(template.cells[2]!.content?.shape.width).toBe(160)
    })

    it('高度耦合全豁免：行/格/内容的声明高与 autoHeight 原样保留（spec §2.3）', () => {
        const decoded = decodeLayer(canonicalTemplateTableWire()) as TableLayer
        const template = decoded.template!

        // 模板行：声明 0 高 autoHeight true，原样保留
        expect(template.shape.height).toBe(0)
        expect(template.shape.autoHeight).toBe(true)
        // 格 1：声明 0 高 autoHeight true，原样保留
        expect(template.cells[0]!.shape.height).toBe(0)
        expect(template.cells[0]!.shape.autoHeight).toBe(true)
        // 格 2：固定 40 高，原样保留
        expect(template.cells[1]!.shape.height).toBe(40)
        expect(template.cells[1]!.shape.autoHeight).toBe(false)
        // 内容：autoHeight true 原样保留（不走 V1 采纳/压平）
        expect(template.cells[0]!.content?.shape.autoHeight).toBe(true)
        expect(template.cells[0]!.content?.shape.height).toBe(0)
    })

    it('对照：同形态 wire 走 V1 rows 解码仍采纳/压平高度（豁免只属模板装配）', () => {
        const v1 = decodeLayer({
            type: 'TableLayer',
            spec: { shape: { width: 100, height: 40 } },
            rows: [
                {
                    type: 'TableRowLayer',
                    spec: { shape: { width: 100, height: 0, autoHeight: true } },
                    cells: [
                        // auto 格：采纳内容动态高并固化（V1 addContentLayer auto 分支）
                        {
                            type: 'TableCellLayer',
                            spec: { shape: { width: 50, height: 0, autoHeight: true } },
                            content: {
                                type: 'TextLayer',
                                spec: { shape: { width: 50, height: 0, autoHeight: true }, fontFamily: { fontSize: 12 } },
                                data: { value: '内容' },
                            },
                        },
                        // 固定格：压平内容高并关内容 autoHeight（V1 addContentLayer 固定分支）
                        {
                            type: 'TableCellLayer',
                            spec: { shape: { width: 50, height: 20 } },
                            content: {
                                type: 'TextLayer',
                                spec: { shape: { width: 50, height: 0, autoHeight: true }, fontFamily: { fontSize: 12 } },
                                data: { value: '内容' },
                            },
                        },
                    ],
                },
            ],
        }) as TableLayer

        const row = v1.rows[0]!
        // V1：行高取最高格（采纳 20）并固化关 autoHeight
        expect(row.shape.height).toBe(20)
        expect(row.shape.autoHeight).toBe(false)
        // V1 auto 格：采纳内容高（12）并固化
        expect(row.cells[0]!.shape.height).toBe(12)
        expect(row.cells[0]!.shape.autoHeight).toBe(false)
        // V1 固定格：内容高压平至格高并关 autoHeight
        expect(row.cells[1]!.content?.shape.height).toBe(20)
        expect(row.cells[1]!.content?.shape.autoHeight).toBe(false)
    })
})

describe('XOR 与 rowsPath 门（镜像 fromGraph 错误面）', () => {
    it('template + rows 双键同现抛 TemplateRowsConflictError（rows 值任意，键在场即算）', () => {
        const templateNode = baseNode('TableRowTemplate', { cells: [] })

        expect(() =>
            decodeLayer({
                type: 'TableLayer',
                spec: { shape: { width: 100, height: 40 } },
                data: { rowsPath: 'order.items' },
                template: templateNode,
                rows: [
                    { type: 'TableRowLayer', spec: { shape: { width: 100, height: 10 } }, cells: [] },
                ],
            }),
        ).toThrow(TemplateRowsConflictError)

        expect(() =>
            decodeLayer({
                type: 'TableLayer',
                spec: { shape: { width: 100, height: 40 } },
                data: { rowsPath: 'order.items' },
                template: templateNode,
                rows: [],
            }),
        ).toThrow(TemplateRowsConflictError)

        try {
            decodeLayer({
                type: 'TableLayer',
                template: templateNode,
                rows: [],
            })
            expect.unreachable('应当抛错')
        } catch (error) {
            expect(error).toBeInstanceOf(TemplateRowsConflictError)
            expect((error as TemplateRowsConflictError).code).toBe('template_rows_conflict')
            expect((error as Error).name).toBe('TemplateRowsConflictError')
            expect((error as Error).message).toContain('template_rows_conflict')
        }
    })

    it('template: null + rows 走 V1 正常解码（PHP !== null 门）', () => {
        const decoded = decodeLayer({
            type: 'TableLayer',
            spec: { shape: { width: 100, height: 20 } },
            template: null,
            rows: [
                {
                    type: 'TableRowLayer',
                    spec: { shape: { width: 100, height: 20 } },
                    cells: [{ type: 'TableCellLayer', spec: { shape: { width: 100, height: 20 } } }],
                },
            ],
        }) as TableLayer

        expect(decoded.template).toBeNull()
        expect(decoded.rowsPath).toBe('')
        expect(decoded.rows).toHaveLength(1)
    })

    it('模板态缺 data / rowsPath 缺失 / 空串 / 非串 抛 RowsPathMissingError', () => {
        const templateNode = baseNode('TableRowTemplate', { cells: [] })
        const tableBase = { type: 'TableLayer', spec: { shape: { width: 100, height: 40 } }, template: templateNode }

        expect(() => decodeLayer({ ...tableBase })).toThrow(RowsPathMissingError)
        expect(() => decodeLayer({ ...tableBase, data: {} })).toThrow(RowsPathMissingError)
        expect(() => decodeLayer({ ...tableBase, data: { rowsPath: '' } })).toThrow(RowsPathMissingError)
        expect(() => decodeLayer({ ...tableBase, data: { rowsPath: null } })).toThrow(RowsPathMissingError)
        expect(() => decodeLayer({ ...tableBase, data: { rowsPath: 123 } })).toThrow(RowsPathMissingError)

        try {
            decodeLayer({ ...tableBase })
            expect.unreachable('应当抛错')
        } catch (error) {
            expect(error).toBeInstanceOf(RowsPathMissingError)
            expect((error as RowsPathMissingError).code).toBe('rows_path_missing')
            expect((error as Error).name).toBe('RowsPathMissingError')
            expect((error as Error).message).toContain('rows_path_missing')
        }
    })
})

describe('表达式标记往返（镜像三内容层 data 分支与 graph()）', () => {
    it('标记态解码：值字段 := expression，wire value 不读（三类型）', () => {
        const marked = { valueType: 'ExpressionValue', expression: '{{row.x}}', value: '分歧字面' }

        const image = decodeLayer({ type: 'ImageLayer', data: marked }) as ImageLayer
        expect(image.expression).toBe('{{row.x}}')
        expect(image.src).toBe('{{row.x}}')

        const text = decodeLayer({ type: 'TextLayer', data: marked }) as TextLayer
        expect(text.expression).toBe('{{row.x}}')
        expect(text.text).toBe('{{row.x}}')

        const qr = decodeLayer({ type: 'QrCodeLayer', data: marked }) as QrCodeLayer
        expect(qr.expression).toBe('{{row.x}}')
        expect(qr.value).toBe('{{row.x}}')
    })

    it("标记门是 PHP isset 同门：expression 缺失/null 不算标记；'' 算标记", () => {
        // valueType 命中但 expression 键缺失 → 未标记，值字段按字面读取
        const noKey = decodeLayer({ type: 'ImageLayer', data: { valueType: 'ExpressionValue', value: 'a.png' } }) as ImageLayer
        expect(noKey.expression).toBeNull()
        expect(noKey.src).toBe('a.png')

        // expression: null 不算标记（isset 门）
        const nullExpr = decodeLayer({ type: 'ImageLayer', data: { valueType: 'ExpressionValue', expression: null, value: 'a.png' } }) as ImageLayer
        expect(nullExpr.expression).toBeNull()
        expect(nullExpr.src).toBe('a.png')

        // StaticValue 即使带 expression 也不算标记
        const staticWithExpr = decodeLayer({ type: 'TextLayer', data: { valueType: 'StaticValue', expression: '残留', value: '正文' } }) as TextLayer
        expect(staticWithExpr.expression).toBeNull()
        expect(staticWithExpr.text).toBe('正文')

        // expression: '' 算标记：值字段原样 ''（Image 不做 ''→null 归一）
        const emptyExpr = decodeLayer({ type: 'ImageLayer', data: { valueType: 'ExpressionValue', expression: '', value: '忽略' } }) as ImageLayer
        expect(emptyExpr.expression).toBe('')
        expect(emptyExpr.src).toBe('')
    })

    it("标记态 expression: '' 往返原样（三类型）", () => {
        const markedEmpty = { valueType: 'ExpressionValue', expression: '', value: '' }

        const imageWire = baseNode('ImageLayer', { data: markedEmpty })
        expect(encodeLayer(decodeLayer(imageWire))).toEqual(imageWire)

        const textWire = baseNode('TextLayer', {
            spec: {
                shape: { ...FULL_SHAPE, width: 10, height: 10 },
                align: { horizontal: 'left', vertical: 'bottom' },
                position: { x: 0, y: 0, position: 'top-left' },
                fontFamily: { font: '', fontSize: 12, fontColor: '#000000', angle: 0, autowrap: false },
            },
            data: markedEmpty,
        })
        expect(encodeLayer(decodeLayer(textWire))).toEqual(textWire)

        const qrWire = baseNode('QrCodeLayer', { data: markedEmpty })
        expect(encodeLayer(decodeLayer(qrWire))).toEqual(qrWire)
    })

    it('encode 键形：标记态三键；未标记保持现状（Text 三键含 expression 空、Image/Qr 两键）', () => {
        // 未标记：字节面现状零差异
        const imageKeys = Object.keys(encodeLayer(decodeLayer({ type: 'ImageLayer', data: { value: 'a.png' } })).data!)
        expect(imageKeys).toEqual(['valueType', 'value'])
        const qrKeys = Object.keys(encodeLayer(decodeLayer({ type: 'QrCodeLayer' })).data!)
        expect(qrKeys).toEqual(['valueType', 'value'])
        const textKeys = Object.keys(encodeLayer(decodeLayer({ type: 'TextLayer', data: { value: '正文' } })).data!)
        expect(textKeys).toEqual(['valueType', 'expression', 'value'])
        expect(encodeLayer(decodeLayer({ type: 'TextLayer', data: { value: '正文' } })).data!.expression).toBe('')

        // 标记态：三键 ExpressionValue
        const markedImage = encodeLayer(decodeLayer({ type: 'ImageLayer', data: { valueType: 'ExpressionValue', expression: '{{row.a}}' } }))
        expect(markedImage.data).toEqual({ valueType: 'ExpressionValue', expression: '{{row.a}}', value: '{{row.a}}' })

        const markedQr = encodeLayer(decodeLayer({ type: 'QrCodeLayer', data: { valueType: 'ExpressionValue', expression: '{{row.c}}' } }))
        expect(markedQr.data).toEqual({ valueType: 'ExpressionValue', expression: '{{row.c}}', value: '{{row.c}}' })

        const markedText = encodeLayer(decodeLayer({ type: 'TextLayer', data: { valueType: 'ExpressionValue', expression: '{{row.t}}' } }))
        expect(markedText.data).toEqual({ valueType: 'ExpressionValue', expression: '{{row.t}}', value: '{{row.t}}' })
    })
})

describe('V1 兼容（存量字节面不破）', () => {
    it('V1 表 wire 带 data 键：域 rowsPath 恒空串、encode 不落 data/template 键', () => {
        const decoded = decodeLayer({
            type: 'TableLayer',
            spec: { shape: { width: 100, height: 20 } },
            data: { rowsPath: 'ignored.path', valueType: 'StaticValue', value: 'junk' },
            rows: [
                { type: 'TableRowLayer', spec: { shape: { width: 100, height: 20 } }, cells: [] },
            ],
        }) as TableLayer

        expect(decoded.template).toBeNull()
        expect(decoded.rowsPath).toBe('')
        expect(decoded.rows).toHaveLength(1)

        const graph = encodeLayer(decoded)
        expect(Object.hasOwn(graph, 'data')).toBe(false)
        expect(Object.hasOwn(graph, 'template')).toBe(false)
        expect(Object.hasOwn(graph, 'rows')).toBe(true)
    })
})

describe('TableRowTemplate 工厂宽容面（spec §2.6：非法位置不拒绝）', () => {
    it('出现在 canvas.layers 可宽容解码且往返；无表宽上下文不同步行宽', () => {
        const wire: WireGraph = {
            canvas: { width: 100, height: 100 },
            layers: [
                baseNode('TableRowTemplate', {
                    spec: {
                        shape: { ...FULL_SHAPE, width: 55, height: 0, autoHeight: true },
                        align: { horizontal: 'left', vertical: 'top' },
                        position: { x: 0, y: 0, position: 'top-left' },
                    },
                    cells: [
                        baseNode('TableCellLayer', {
                            spec: {
                                shape: { ...FULL_SHAPE, width: 55, height: 0, autoHeight: true },
                                align: { horizontal: 'left', vertical: 'top' },
                                position: { x: 0, y: 0, position: 'top-left' },
                            },
                            content: baseNode('TextLayer', {
                                spec: {
                                    shape: { ...FULL_SHAPE, width: 55, height: 0, autoHeight: true },
                                    align: { horizontal: 'left', vertical: 'bottom' },
                                    position: { x: 0, y: 0, position: 'top-left' },
                                    fontFamily: { font: '', fontSize: 12, fontColor: '#000000', angle: 0, autowrap: false },
                                },
                                data: { valueType: 'ExpressionValue', expression: '{{row.name}}', value: '{{row.name}}' },
                            }),
                        }),
                    ],
                }),
            ],
        }

        const canvas = decodeGraph(wire)
        const template = canvas.layers[0] as TableRowTemplateLayer
        expect(template.type).toBe('TableRowTemplate')
        expect(template.shape.width).toBe(55)
        expect(template.shape.autoWidth).toBe(false)
        expect(template.cells).toHaveLength(1)
        expect(template.cells[0]!.content?.shape.width).toBe(55)

        expect(encodeGraph(canvas)).toEqual(wire)
    })

    it('对齐缺省同 TableRowLayer（left/top）', () => {
        expect(decodeLayer({ type: 'TableRowTemplate' }).align).toEqual({ horizontal: 'left', vertical: 'top' })
    })
})
