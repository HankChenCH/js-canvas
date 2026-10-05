import { describe, expect, it } from 'vitest'

import { decodeGraph, decodeLayer, encodeGraph, encodeLayer } from '../../src/index'
import type { Canvas, ImageLayer, QrCodeLayer, TableLayer, TextLayer, WireGraph, WireLayerNode } from '../../src/index'

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

/** graph → 解码 → 编码 往返恒等（硬契约，对齐 php-canvas-next CanvasTest 同款用例） */
describe('graph 往返恒等', () => {
    it('嵌套表格完整画布（平移 testFromGraphRoundtripWithNestedTable）', () => {
        const wire: WireGraph = {
            canvas: { width: 100, height: 100 },
            layers: [
                {
                    ...baseNode('TextLayer', {
                        priority: 3,
                        spec: {
                            shape: { width: 100, height: 30, backgroundColor: null, lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                            align: { horizontal: 'left', vertical: 'bottom' },
                            position: { x: 0, y: 0, position: 'top-left' },
                            fontFamily: { font: '', fontSize: 12, fontColor: '#000000', angle: 0, autowrap: false },
                        },
                        data: { valueType: 'StaticValue', expression: '', value: '标题' },
                    }),
                },
                {
                    ...baseNode('QrCodeLayer', {
                        priority: 2,
                        spec: {
                            shape: { width: 20, height: 20, backgroundColor: null, lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                            align: { horizontal: 'left', vertical: 'top' },
                            position: { x: 0, y: 0, position: 'top-left' },
                        },
                        data: { valueType: 'StaticValue', value: 'https://example.com' },
                    }),
                },
                {
                    ...baseNode('ImageLayer', {
                        priority: 1,
                        spec: {
                            shape: { width: 100, height: 100, backgroundColor: '#f00', lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                            align: { horizontal: 'center', vertical: 'center' },
                            position: { x: 0, y: 0, position: 'top-left' },
                        },
                        data: { valueType: 'StaticValue', value: 'a.png' },
                    }),
                },
                {
                    ...baseNode('TableLayer', {
                        priority: 0,
                        spec: {
                            shape: { width: 100, height: 20, backgroundColor: '#fff', lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                            align: { horizontal: 'left', vertical: 'top' },
                            position: { x: 0, y: 0, position: 'top-left' },
                        },
                        rows: [
                            {
                                ...baseNode('TableRowLayer', {
                                    spec: {
                                        shape: { width: 100, height: 20, backgroundColor: null, lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                                        align: { horizontal: 'left', vertical: 'top' },
                                        position: { x: 0, y: 0, position: 'top-left' },
                                    },
                                    cells: [
                                        {
                                            ...baseNode('TableCellLayer', {
                                                spec: {
                                                    shape: { width: 100, height: 20, backgroundColor: '#eee', lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                                                    align: { horizontal: 'left', vertical: 'top' },
                                                    position: { x: 0, y: 0, position: 'top-left' },
                                                },
                                                content: {
                                                    ...baseNode('TextLayer', {
                                                        spec: {
                                                            shape: { width: 100, height: 20, backgroundColor: null, lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                                                            align: { horizontal: 'left', vertical: 'bottom' },
                                                            position: { x: 0, y: 0, position: 'top-left' },
                                                            fontFamily: { font: '', fontSize: 10, fontColor: '#000000', angle: 0, autowrap: false },
                                                        },
                                                        data: { valueType: 'StaticValue', expression: '', value: '表格文本' },
                                                    }),
                                                },
                                            }),
                                        },
                                    ],
                                }),
                            },
                        ],
                    }),
                },
            ],
        }

        const rebuilt = encodeGraph(decodeGraph(wire))

        expect(rebuilt).toEqual(wire)
        expect(decodeGraph(rebuilt).layers).toHaveLength(4)
    })

    it('ImageLayer 单层往返（平移 ImageLayerTest::testFromGraphRoundtrip）', () => {
        const wire = baseNode('ImageLayer', {
            spec: {
                shape: { width: 30, height: 20, backgroundColor: '#fff', lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                align: { horizontal: 'center', vertical: 'center' },
                position: { x: 1, y: 2, position: 'top-left' },
            },
            data: { valueType: 'StaticValue', value: 'https://example.com/a.png' },
        })

        expect(encodeLayer(decodeLayer(wire))).toEqual(wire)
    })

    it('TextLayer 单层往返（平移 TextLayerTest::testFromGraphRoundtrip）', () => {
        const wire = baseNode('TextLayer', {
            priority: 5,
            spec: {
                shape: { width: 100, height: 50, backgroundColor: '#fff', lineHeight: 1, padding: { top: 2, bottom: 2, left: 2, right: 2 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                align: { horizontal: 'left', vertical: 'bottom' },
                position: { x: 3, y: 4, position: 'top-left' },
                fontFamily: { font: 'https://cdn.example.com/fonts/msyh.ttf', fontSize: 14, fontColor: '#333', angle: 90, autowrap: true },
            },
            data: { valueType: 'StaticValue', expression: '', value: '正文内容' },
        })

        const rebuilt = decodeLayer(wire) as TextLayer
        expect(encodeLayer(rebuilt)).toEqual(wire)
        expect(rebuilt.text).toBe('正文内容')
        expect(rebuilt.fontSize).toBe(14)
    })

    it('QrCodeLayer 单层往返（平移 QrCodeLayerTest::testFromGraphRoundtrip）', () => {
        const wire = baseNode('QrCodeLayer', {
            spec: {
                shape: { width: 60, height: 60, backgroundColor: null, lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                align: { horizontal: 'left', vertical: 'top' },
                position: { x: 2, y: 2, position: 'top-left' },
            },
            data: { valueType: 'StaticValue', value: 'https://example.com' },
        })

        const rebuilt = decodeLayer(wire) as QrCodeLayer
        expect(encodeLayer(rebuilt)).toEqual(wire)
        expect(rebuilt.value).toBe('https://example.com')
    })

    it('表格三层嵌套往返（平移 TableLayersTest::testTableFromGraphRoundtrip）', () => {
        const wire = baseNode('TableLayer', {
            priority: 2,
            spec: {
                shape: { width: 100, height: 40, backgroundColor: '#fff', lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                align: { horizontal: 'left', vertical: 'top' },
                position: { x: 0, y: 0, position: 'top-left' },
            },
            rows: [
                {
                    ...baseNode('TableRowLayer', {
                        spec: {
                            shape: { width: 100, height: 20, backgroundColor: null, lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                            align: { horizontal: 'left', vertical: 'top' },
                            position: { x: 0, y: 0, position: 'top-left' },
                        },
                        cells: [
                            {
                                ...baseNode('TableCellLayer', {
                                    spec: {
                                        shape: { width: 50, height: 20, backgroundColor: '#eee', lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                                        align: { horizontal: 'left', vertical: 'top' },
                                        position: { x: 0, y: 0, position: 'top-left' },
                                    },
                                    content: {
                                        ...baseNode('TextLayer', {
                                            spec: {
                                                shape: { width: 50, height: 20, backgroundColor: null, lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: { top: null, bottom: null, left: null, right: null }, autoWidth: false, autoHeight: false },
                                                align: { horizontal: 'left', vertical: 'bottom' },
                                                position: { x: 0, y: 0, position: 'top-left' },
                                                fontFamily: { font: '', fontSize: 10, fontColor: '#000000', angle: 0, autowrap: false },
                                            },
                                            data: { valueType: 'StaticValue', expression: '', value: '单元格' },
                                        }),
                                    },
                                }),
                            },
                        ],
                    }),
                },
            ],
        })

        const rebuilt = decodeLayer(wire) as TableLayer
        expect(encodeLayer(rebuilt)).toEqual(wire)
        const content = rebuilt.rows[0]!.cells[0]!.content
        expect(content?.type).toBe('TextLayer')
        expect((content as TextLayer | null)?.text).toBe('单元格')
    })

    it('auto 标志编码回 wire（平移 testAutoFlags 的 graph 断言）', () => {
        const graph = encodeLayer(
            decodeLayer({
                type: 'ImageLayer',
                spec: { shape: { width: 'auto', height: 'auto' } },
            }),
        )

        expect(graph.spec?.shape?.autoWidth).toBe(true)
        expect(graph.spec?.shape?.autoHeight).toBe(true)
        expect(graph.spec?.shape?.width).toBe(0)
        expect(graph.spec?.shape?.height).toBe(0)
    })

    it('最小 wire 编码出完整 canonical 结构（平移 testGraphStructure）', () => {
        const graph = encodeGraph(
            decodeGraph({
                canvas: { width: 0, height: 0 },
                layers: [{ type: 'ImageLayer', priority: 2, spec: { shape: { width: 10, height: 20 } } }],
            }),
        )

        expect(graph).toEqual({
            canvas: { width: 0, height: 0 },
            layers: [
                {
                    type: 'ImageLayer',
                    priority: 2,
                    spec: {
                        shape: {
                            width: 10,
                            height: 20,
                            autoWidth: false,
                            autoHeight: false,
                            lineHeight: 1,
                            padding: { top: 0, bottom: 0, left: 0, right: 0 },
                            border: { top: null, bottom: null, left: null, right: null },
                            backgroundColor: null,
                        },
                        align: { horizontal: 'center', vertical: 'center' },
                        position: { x: 0, y: 0, position: 'top-left' },
                    },
                    data: { valueType: 'StaticValue', value: null },
                },
            ],
        })
    })

    it('text 编码保留完整 font 原值且 data 恒带 expression 占位（平移 testGraphKeepsFullFontValue）', () => {
        const graph = encodeLayer(
            decodeLayer({
                type: 'TextLayer',
                spec: {
                    shape: { width: 10, height: 10 },
                    fontFamily: { font: 'https://cdn.example.com/fonts/msyh.ttf', fontSize: 12, fontColor: '#f00' },
                },
                data: { value: '文本' },
            }),
        )

        expect(graph.spec?.fontFamily?.font).toBe('https://cdn.example.com/fonts/msyh.ttf')
        expect(graph.data?.value).toBe('文本')
        expect(graph.data?.expression).toBe('')
        expect(graph.data?.valueType).toBe('StaticValue')
    })

    it('qr 编码恒携带 value（与是否物化无关，平移 testGraphAlwaysCarriesValue）', () => {
        expect(encodeLayer(decodeLayer({ type: 'QrCodeLayer', spec: { shape: { width: 60, height: 60 } } })).data?.value).toBe('')
        expect(
            encodeLayer(decodeLayer({ type: 'QrCodeLayer', data: { value: 'https://example.com/中文' } })).data?.value,
        ).toBe('https://example.com/中文')
    })

    it('table 编码携带全量行而非仅首行（平移 testGraphContainsFullRowsNotOnlyFirst）', () => {
        const graph = encodeLayer(
            decodeLayer({
                type: 'TableLayer',
                spec: { shape: { width: 100, height: 40 } },
                rows: [
                    {
                        type: 'TableRowLayer',
                        spec: { shape: { width: 100, height: 10 } },
                        cells: [{ type: 'TableCellLayer', spec: { shape: { width: 100, height: 10, backgroundColor: '#f00' } } }],
                    },
                    {
                        type: 'TableRowLayer',
                        spec: { shape: { width: 100, height: 30 } },
                        cells: [{ type: 'TableCellLayer', spec: { shape: { width: 100, height: 30, backgroundColor: '#0f0' } } }],
                    },
                ],
            }),
        )

        const rows = graph.rows as WireLayerNode[]
        expect(rows).toHaveLength(2)
        expect((rows[0]!.cells as WireLayerNode[])[0]!.spec?.shape?.backgroundColor).toBe('#f00')
        expect((rows[1]!.cells as WireLayerNode[])[0]!.spec?.shape?.backgroundColor).toBe('#0f0')
        expect(rows[0]!.cells).toHaveLength(1)
    })
})

/**
 * name/visible 契约（layer-panel-ux 工单 01，PHP AbstractLayerTest::testNameVisible* 同款口径）：
 * 缺省态键省略、带值条件写键（键序 type → name → visible → priority，三端字节 parity）、
 * 解码读取与归一、graph → 解码 → 编码往返恒等
 */
describe('name/visible 条件键', () => {
    it('缺省图层编码不落 name/visible 键（字节面与无字段版本一致）', () => {
        const graph = encodeLayer(decodeLayer(baseNode('ImageLayer', { data: { valueType: 'StaticValue', value: null } })))
        expect(JSON.stringify(graph)).not.toContain('"name"')
        expect(JSON.stringify(graph)).not.toContain('"visible"')
        expect(graph.name).toBeUndefined()
        expect(graph.visible).toBeUndefined()
    })

    it('解码回填缺省：无键 → name 空、visible true', () => {
        const layer = decodeLayer(baseNode('ImageLayer')) as ImageLayer
        expect(layer.name).toBe('')
        expect(layer.visible).toBe(true)
    })

    it('带值编码条件写键且键序钉在 type 之后、priority 之前（JSON 字节面锁定）', () => {
        const doc: ImageLayer = {
            ...(decodeLayer(baseNode('ImageLayer')) as ImageLayer),
            name: '标题层',
            visible: false,
        }
        const encoded = JSON.stringify(encodeLayer(doc))
        // 键序 + 条件写键逐字节断言（Go layer 包同名断言、PHP testNameVisibleByteFace 同口径）
        expect(encoded.startsWith('{"type":"ImageLayer","name":"标题层","visible":false,"priority":0,')).toBe(true)

        // 往返恒等
        expect(encodeLayer(decodeLayer(encodeLayer(doc)))).toEqual(encodeLayer(doc))
    })

    it('第三方缺省值形态（name 空串、visible true）解码后编码归一省略', () => {
        const wire = baseNode('ImageLayer', { name: '', visible: true })
        const graph = encodeLayer(decodeLayer(wire))
        expect(graph.name).toBeUndefined()
        expect(graph.visible).toBeUndefined()
    })

    it('表格子树往返保留 name/visible（容器子层合法携带，契约面仅根图层使用）', () => {
        const wire = baseNode('TableLayer', {
            rows: [
                {
                    ...baseNode('TableRowLayer', { name: '行一', visible: false, cells: [] }),
                },
            ],
        })

        const rebuilt = decodeLayer(wire) as TableLayer
        expect(rebuilt.rows[0]!.name).toBe('行一')
        expect(rebuilt.rows[0]!.visible).toBe(false)
        expect(encodeLayer(rebuilt)).toEqual(wire)
    })
})

/** 编码整形收整（decode toInt 同面字段）：JS 领域无 int 型别，编辑器手势（画拉/
 *  缩放/拖动按 zoom 折算、面板数字输入）会让几何字段携带分数——wire 契约的这些
 *  字段是整数（PHP graph() 经 intval 型别、Go wire int 字段直接 unmarshal），
 *  编码须与解码同法向零截断，分数几何不出 wire 边界。 */
describe('编码整形收整（wire int 面兼容）', () => {
    /** 解码一份 canonical 画布再把几何字段改成分数——模拟编辑手势产出（领域只读
     *  是型别层面的，运行时字段可变，同编辑器 transact 写法） */
    function fractionalDoc(): Canvas {
        const doc = decodeGraph(wireFromBase()) as unknown as {
            width: number
            height: number
            layers: Record<string, any>[]
        }
        doc.width = 794.6
        doc.height = 1123.2
        // 领域形态直改（同编辑器 transact 手势写法）：shape/position/fontSize/angle
        const layer = doc.layers[0]! as Record<string, any>
        const shape = layer.shape as Record<string, any>
        layer.priority = 3.9
        layer.position = { ...layer.position, x: 138.64, y: -12.7 }
        shape.width = 138.641975
        shape.height = 20.5
        shape.lineHeight = 1.5
        shape.border = {
            top: { width: 1.9, color: '#000000' },
            bottom: null,
            left: null,
            right: null,
        }
        layer.fontSize = 12.7
        layer.angle = -0.5
        return doc as unknown as Canvas
    }

    function wireFromBase(): WireGraph {
        return {
            canvas: { width: 794, height: 1123 },
            layers: [
                baseNode('TextLayer', {
                    priority: 3,
                    spec: {
                        shape: {
                            width: 138, height: 20, autoWidth: false, autoHeight: false, lineHeight: 1.5,
                            padding: { top: 0, bottom: 0, left: 0, right: 0 },
                            border: { top: { width: 1, color: '#000000' }, bottom: null, left: null, right: null },
                            backgroundColor: null,
                        },
                        align: { horizontal: 'left', vertical: 'top' },
                        position: { x: 138, y: -12, position: 'top-left' },
                        fontFamily: { font: '', fontSize: 12, fontColor: '#000000', angle: 0, autowrap: false },
                    },
                    data: { valueType: 'StaticValue', expression: '', value: '标题' },
                }),
            ],
        }
    }

    it('shape/position/priority/fontSize/angle/canvas/border 向零截断；lineHeight/padding 浮点不收', () => {
        const wire = encodeGraph(fractionalDoc())
        expect(wire.canvas).toEqual({ width: 794, height: 1123 })
        const layer = (wire.layers ?? [])[0]! as NonNullable<WireGraph['layers']>[number]
        expect(layer.priority).toBe(3)
        expect(layer.spec!.shape!.width).toBe(138)
        expect(layer.spec!.shape!.height).toBe(20)
        expect(layer.spec!.shape!.lineHeight).toBe(1.5)
        expect(layer.spec!.shape!.border!.top!.width).toBe(1)
        expect(layer.spec!.position!.x).toBe(138)
        expect(layer.spec!.position!.y).toBe(-12)
        expect(layer.spec!.fontFamily!.fontSize).toBe(12)
        // -0.5 → -0 归一 0（PHP 整数域无 -0，decode normZero 同门）
        expect(Object.is(layer.spec!.fontFamily!.angle, -0)).toBe(false)
        expect(layer.spec!.fontFamily!.angle).toBe(0)
    })

    it('收整后 wire 与原整数 wire 字节恒等（decode∘encode 往返不因手势分数漂移）', () => {
        const wire = encodeGraph(fractionalDoc())
        expect(JSON.stringify(wire)).toBe(JSON.stringify(wireFromBase()))
        // 收整 wire 再 decode 出的文档与整数基线文档同构
        expect(decodeGraph(wire)).toEqual(decodeGraph(wireFromBase()))
    })
})
