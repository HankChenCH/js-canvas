import { describe, expect, it } from 'vitest'

import { decodeGraph, renderCanvas, withTemplatePreview, docPathToViewPath, viewPathToDocPath } from '../../src/index'
import type { Border, Canvas, Layer, RenderBackend, TableLayer } from '../../src/index'

interface CallRecord {
    op: 'begin' | 'end' | 'rect' | 'image' | 'text'
    [key: string]: unknown
}

/** 录制后端：只记录原语调用序与几何，不产像素 */
function recordingBackend() {
    const calls: CallRecord[] = []
    const backend: RenderBackend = {
        begin() {
            calls.push({ op: 'begin' })
        },
        end() {
            calls.push({ op: 'end' })
        },
        drawRect(x, y, width, height, bgColor) {
            calls.push({ op: 'rect', x, y, width, height, bgColor })
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

const NO_BORDER: Border = { top: null, bottom: null, left: null, right: null }
const REST_SHAPE = { lineHeight: 1, padding: { top: 0, bottom: 0, left: 0, right: 0 }, border: NO_BORDER, backgroundColor: null } as const
const SPEC_REST = { align: { horizontal: 'left', vertical: 'top' }, position: { x: 0, y: 0, position: 'top-left' } } as const

const shape = (width: number, height: number, extra: Record<string, unknown> = {}) => ({
    width, height, autoWidth: false, autoHeight: false, ...REST_SHAPE, ...extra,
})

/** 模板态表格：三格分别带标记文本 / 标记图片 / 标记二维码，另含一个字面文本格 */
function templateGraph(): Canvas {
    return decodeGraph({
        canvas: { width: 400, height: 300 },
        layers: [
            {
                type: 'TableLayer',
                priority: 10,
                spec: { shape: shape(320, 120), ...SPEC_REST },
                data: { rowsPath: 'order.items' },
                template: {
                    type: 'TableRowTemplate',
                    priority: 0,
                    spec: { shape: shape(320, 0, { autoHeight: true }), ...SPEC_REST },
                    cells: [
                        {
                            type: 'TableCellLayer',
                            priority: 0,
                            spec: { shape: shape(80, 40), ...SPEC_REST },
                            content: {
                                type: 'TextLayer',
                                priority: 0,
                                spec: { shape: shape(80, 20), ...SPEC_REST },
                                data: { valueType: 'ExpressionValue', expression: '姓名：{{row.name}}', value: '姓名：{{row.name}}' },
                            },
                        },
                        {
                            type: 'TableCellLayer',
                            priority: 0,
                            spec: { shape: shape(80, 40), ...SPEC_REST },
                            content: {
                                type: 'ImageLayer',
                                priority: 0,
                                spec: { shape: shape(80, 40), ...SPEC_REST },
                                data: { valueType: 'ExpressionValue', expression: '{{row.avatar}}', value: '{{row.avatar}}' },
                            },
                        },
                        {
                            type: 'TableCellLayer',
                            priority: 0,
                            spec: { shape: shape(80, 40), ...SPEC_REST },
                            content: {
                                type: 'QrCodeLayer',
                                priority: 0,
                                spec: { shape: shape(80, 40), ...SPEC_REST },
                                data: { valueType: 'ExpressionValue', expression: '{{row.code}}', value: '{{row.code}}' },
                            },
                        },
                        {
                            type: 'TableCellLayer',
                            priority: 0,
                            spec: { shape: shape(80, 40), ...SPEC_REST },
                            content: { type: 'TextLayer', priority: 0, spec: { shape: shape(80, 20), ...SPEC_REST }, text: '字面' },
                        },
                    ],
                },
            },
            // V1 表：行结构应原样共享引用
            {
                type: 'TableLayer',
                priority: 5,
                spec: { shape: shape(100, 50), ...SPEC_REST },
                rows: [
                    {
                        type: 'TableRowLayer',
                        priority: 0,
                        spec: { shape: shape(100, 25), ...SPEC_REST },
                        cells: [{ type: 'TableCellLayer', priority: 0, spec: { shape: shape(100, 25), ...SPEC_REST }, content: null }],
                    },
                ],
            },
        ],
    })
}

function tableAt(canvas: Canvas, index: number): TableLayer {
    const layer = canvas.layers[index]
    if (layer === undefined || layer.type !== 'TableLayer') throw new Error(`layers[${index}] 不是表格`)
    return layer
}

describe('withTemplatePreview（预览视图变换：模板态表格实例化一行预览行）', () => {
    it('模板表在视图中获得一行真实行：template 保留、行/格结构镜像声明', () => {
        const doc = templateGraph()
        const view = withTemplatePreview(doc)

        const viewTable = tableAt(view, 0)
        expect(viewTable.template).not.toBeNull()
        expect(viewTable.rows).toHaveLength(1)
        const previewRow = viewTable.rows[0]!
        expect(previewRow.type).toBe('TableRowLayer')
        expect(previewRow.shape.width).toBe(320)
        expect(previewRow.shape.autoHeight).toBe(true)
        expect(previewRow.cells).toHaveLength(4)
    })

    it('标记文本格内容原样进预览行（text 恒镜像表达式原文，字面直通）', () => {
        const view = withTemplatePreview(templateGraph())
        const text = tableAt(view, 0).rows[0]!.cells[0]!.content
        expect(text).toMatchObject({ type: 'TextLayer', text: '姓名：{{row.name}}', expression: '姓名：{{row.name}}' })
    })

    it('标记图片/二维码格在预览行内置空：走未物化占位语义（只画盒）', () => {
        const view = withTemplatePreview(templateGraph())
        const cells = tableAt(view, 0).rows[0]!.cells
        const image = cells[1]!.content
        const qr = cells[2]!.content
        expect(image).toMatchObject({ type: 'ImageLayer', src: null, expression: '{{row.avatar}}' })
        expect(qr).toMatchObject({ type: 'QrCodeLayer', value: '', expression: '{{row.code}}' })
    })

    it('字面内容与未涉及子树结构共享：字面文本格同引用、V1 表行同引用', () => {
        const doc = templateGraph()
        const view = withTemplatePreview(doc)
        expect(tableAt(view, 0).rows[0]!.cells[3]!.content).toBe(tableAt(doc, 0).template!.cells[3]!.content)
        expect(tableAt(view, 1).rows).toBe(tableAt(doc, 1).rows)
    })

    it('源文档不被改写：模板态表格 rows 恒空（视图是衍生物，永不回写）', () => {
        const doc = templateGraph()
        withTemplatePreview(doc)
        expect(tableAt(doc, 0).rows).toHaveLength(0)
        expect(tableAt(doc, 0).template!.cells).toHaveLength(4)
    })

    it('视图可直接经渲染模板绘制：预览行文本/占位盒出现在调用序里', () => {
        const view = withTemplatePreview(templateGraph())
        const { calls, backend } = recordingBackend()
        renderCanvas(view, backend)

        expect(calls.some((call) => call.op === 'text' && call.line === '姓名：{{row.name}}')).toBe(true)
        // 标记图片置空：无 image 调用（占位 = 只画盒）
        expect(calls.some((call) => call.op === 'image')).toBe(false)
        // 表盒 + 预览行盒 + 4 格盒 + 字面文本…至少覆盖模板子树
        expect(calls.filter((call) => call.op === 'rect').length).toBeGreaterThanOrEqual(6)
    })
})

describe('预览视图 ↔ 文档路径映射', () => {
    it('视图预览行路径映射回模板子树：rows[0] → template', () => {
        const view = withTemplatePreview(templateGraph())
        expect(viewPathToDocPath(view, ['layers', 0, 'rows', 0])).toEqual(['layers', 0, 'template'])
        expect(viewPathToDocPath(view, ['layers', 0, 'rows', 0, 'cells', 1])).toEqual(['layers', 0, 'template', 'cells', 1])
        expect(viewPathToDocPath(view, ['layers', 0, 'rows', 0, 'cells', 0, 'content'])).toEqual(['layers', 0, 'template', 'cells', 0, 'content'])
    })

    it('非模板子树路径原样返回：根层、V1 表行/格', () => {
        const view = withTemplatePreview(templateGraph())
        expect(viewPathToDocPath(view, ['layers', 1])).toEqual(['layers', 1])
        expect(viewPathToDocPath(view, ['layers', 1, 'rows', 0, 'cells', 0])).toEqual(['layers', 1, 'rows', 0, 'cells', 0])
    })

    it('模板表上 rows 越界映射为 null（预览行只有一行）', () => {
        const view = withTemplatePreview(templateGraph())
        expect(viewPathToDocPath(view, ['layers', 0, 'rows', 1])).toBeNull()
    })

    it('文档模板路径映射到视图：template → rows[0]', () => {
        const doc = templateGraph()
        expect(docPathToViewPath(doc, ['layers', 0, 'template', 'cells', 2])).toEqual(['layers', 0, 'rows', 0, 'cells', 2])
        expect(docPathToViewPath(doc, ['layers', 1, 'rows', 0])).toEqual(['layers', 1, 'rows', 0])
        expect(docPathToViewPath(doc, ['layers', 0, 'rows', 0])).toBeNull()
    })

    it('模板格内容内的嵌套模板表双向映射（rows[0] ↔ template 逐段替换）', () => {
        const doc = decodeGraph({
            canvas: { width: 400, height: 300 },
            layers: [{
                type: 'TableLayer',
                priority: 10,
                spec: { shape: shape(320, 120), ...SPEC_REST },
                data: { rowsPath: 'a' },
                template: {
                    type: 'TableRowTemplate',
                    priority: 0,
                    spec: { shape: shape(320, 40), ...SPEC_REST },
                    cells: [{
                        type: 'TableCellLayer',
                        priority: 0,
                        spec: { shape: shape(320, 40), ...SPEC_REST },
                        content: {
                            type: 'TableLayer',
                            priority: 0,
                            spec: { shape: shape(320, 40), ...SPEC_REST },
                            data: { rowsPath: 'b' },
                            template: {
                                type: 'TableRowTemplate',
                                priority: 0,
                                spec: { shape: shape(320, 20), ...SPEC_REST },
                                cells: [{ type: 'TableCellLayer', priority: 0, spec: { shape: shape(320, 20), ...SPEC_REST }, content: null }],
                            },
                        },
                    }],
                },
            }],
        })
        const view = withTemplatePreview(doc)
        const docPath = ['layers', 0, 'template', 'cells', 0, 'content', 'template', 'cells', 0]
        const viewPath = ['layers', 0, 'rows', 0, 'cells', 0, 'content', 'rows', 0, 'cells', 0]
        expect(docPathToViewPath(doc, docPath)).toEqual(viewPath)
        expect(viewPathToDocPath(view, viewPath)).toEqual(docPath)
        // 视图里嵌套表确实拿到了预览行
        const nested = tableAt(view, 0).rows[0]!.cells[0]!.content as Layer
        expect(nested.type).toBe('TableLayer')
        expect((nested as TableLayer).rows).toHaveLength(1)
    })
})

describe('预览行 auto 高度合成（真实模板行/格/内容常为 autoHeight，声明高被解码归零）', () => {
    it('auto 格取内容动态高、auto 行取最高格；非 auto 声明高原样保留', () => {
        const doc = decodeGraph({
            canvas: { width: 400, height: 300 },
            layers: [{
                type: 'TableLayer',
                priority: 10,
                spec: { shape: shape(320, 120), ...SPEC_REST },
                data: { rowsPath: 'a' },
                template: {
                    type: 'TableRowTemplate',
                    priority: 0,
                    spec: { shape: shape(320, 0, { autoHeight: true }), ...SPEC_REST },
                    cells: [
                        {
                            type: 'TableCellLayer',
                            priority: 0,
                            spec: { shape: shape(160, 0, { autoHeight: true, padding: { top: 5, bottom: 5, left: 0, right: 0 } }), ...SPEC_REST },
                            content: {
                                type: 'TextLayer',
                                priority: 0,
                                spec: {
                                    shape: shape(160, 0, { autoHeight: true, lineHeight: 1.2, padding: { top: 5, bottom: 5, left: 0, right: 0 } }),
                                    ...SPEC_REST,
                                    fontFamily: { font: '', fontSize: 18, fontColor: '#222', angle: 0, autowrap: false },
                                },
                                data: { value: '预览行' },
                            },
                        },
                        {
                            type: 'TableCellLayer',
                            priority: 0,
                            spec: { shape: shape(160, 40), ...SPEC_REST },
                            content: null,
                        },
                    ],
                },
            }],
        })
        const view = withTemplatePreview(doc)
        const row = tableAt(view, 0).rows[0]!
        // 文本动态高 = ceil(18×1.2) + 上下 padding 10 = 32；行高取最高格 = 40
        expect(row.cells[0]!.shape.autoHeight).toBe(true)
        expect(row.cells[0]!.shape.height).toBe(32)
        expect(row.cells[1]!.shape.height).toBe(40)
        expect(row.shape.autoHeight).toBe(true)
        expect(row.shape.height).toBe(40)
        // 源文档不被改写：声明高仍是被解码归零的 0
        expect(tableAt(doc, 0).template!.shape.height).toBe(0)
    })

    it('非 auto 声明高不被合成覆盖；V1 行子树不参与合成（视图与文档几何一致）', () => {
        const doc = templateGraph()
        const view = withTemplatePreview(doc)
        // templateGraph 模板行声明高 0 autoHeight → 合成；V1 表行高 25 原样
        expect(tableAt(view, 1).rows[0]!.shape.height).toBe(tableAt(doc, 1).rows[0]!.shape.height)
    })
})
