/**
 * visible=false 根图层渲染跳过（layer-panel-ux 工单 01，隐藏 = 最终输出排除，Figma 语义）：
 * renderCanvas 与工具层共用的 forEachLayerBox 根遍历同门跳过——与 PHP AbstractRenderer::render
 * / Go renderer.Render 一致；容器子层不下钻显隐（显隐面仅根图层）。
 */
import { describe, expect, it } from 'vitest'

import { decodeGraph, forEachLayerBox, renderCanvas } from '../../src/index'
import type { Canvas, Layer, RenderBackend } from '../../src/index'

interface Record_ {
    op: string
    x: number
    y: number
}

function recordingBackend(): { records: Record_[]; backend: RenderBackend } {
    const records: Record_[] = []
    const backend: RenderBackend = {
        begin() {},
        end() {},
        drawRect(x, y) {
            records.push({ op: 'rect', x, y })
        },
        drawImage(_src, x, y) {
            records.push({ op: 'image', x, y })
        },
        drawText(_line, x, y) {
            records.push({ op: 'text', x, y })
        },
    }
    return { records, backend }
}

/** 最小文本层造数（decode 缺省形态） */
function textLayer(overrides: Record<string, unknown> = {}): Layer {
    return decodeGraph({
        canvas: { width: 0, height: 0 },
        layers: [{ type: 'TextLayer', spec: { shape: { width: 40, height: 20 } }, ...overrides }],
    }).layers[0]!
}

const visible = () => textLayer({ spec: { shape: { width: 40, height: 20, backgroundColor: '#0f0' } }, data: { valueType: 'StaticValue', value: 'V' } })
const hidden = () => textLayer({ visible: false, spec: { shape: { width: 40, height: 20, backgroundColor: '#f00' } }, data: { valueType: 'StaticValue', value: 'H' } })

describe('visible=false 根图层渲染跳过', () => {
    it('renderCanvas 不绘制隐藏根层（隐藏层在渲染序末位，跳过后零原语）', () => {
        const canvas: Canvas = { width: 100, height: 100, layers: [visible(), hidden()] }
        const { records, backend } = recordingBackend()

        renderCanvas(canvas, backend)

        // 只有可见层的 rect + 一行文本（缺省 bottom 对齐，text y = 盒高）；隐藏层零记录
        expect(records).toEqual([
            { op: 'rect', x: 0, y: 0 },
            { op: 'text', x: 0, y: 20 },
        ])
    })

    it('forEachLayerBox 同门跳过（工具层几何遍历与绘制不漂移）', () => {
        const canvas: Canvas = { width: 100, height: 100, layers: [visible(), hidden()] }
        const visited: Layer[] = []

        forEachLayerBox(canvas, (layer) => visited.push(layer))

        expect(visited).toHaveLength(1)
        expect(visited[0]!.visible).toBe(true)
    })

    it('容器子层不下钻显隐：子层无 visible 语义，结构树原样遍历', () => {
        // 行内文本格的 wire 不带 visible 键 → 解码缺省 true → 遍历不缺
        const canvas = decodeGraph({
            canvas: { width: 600, height: 100 },
            layers: [
                {
                    type: 'TableLayer',
                    spec: { shape: { width: 600, height: 100 } },
                    rows: [
                        {
                            type: 'TableRowLayer',
                            spec: { shape: { width: 600, height: 100 } },
                            cells: [
                                {
                                    type: 'TableCellLayer',
                                    spec: { shape: { width: 300, height: 100 } },
                                    content: {
                                        type: 'TextLayer',
                                        spec: { shape: { width: 300, height: 100 } },
                                        data: { valueType: 'StaticValue', value: '格' },
                                    },
                                },
                            ],
                        },
                    ],
                },
            ],
        })
        const visited: Layer[] = []

        forEachLayerBox(canvas, (layer) => visited.push(layer))

        expect(visited.map((l) => l.type)).toEqual(['TableLayer', 'TableRowLayer', 'TableCellLayer', 'TextLayer'])
    })
})
