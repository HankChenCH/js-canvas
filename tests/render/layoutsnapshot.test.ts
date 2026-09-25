import { describe, expect, it } from 'vitest'

import fixture from '../fixtures/layout-snapshot.json'
import { decodeGraph, encodeGraph, renderCanvas } from '../../src/index'
import type { RenderBackend } from '../../src/index'

/**
 * 布局快照 fixture（三端一份契约数据）：PHP 导出脚本对固定用例集产出
 * "graph + 绘制原语记录"，go-canvas 已消费同份 JSON（renderer/layoutsnapshot_test.go），
 * 本端逐记录断言——快照 diff 即三端布局行为 diff。
 *
 * 断言规则（对齐 Go 侧）：
 * - graph wire 互通：解码 → 再编码须与输入逐字段一致（fixture graph 为重放一次的规范形）；
 * - 绘制记录：op/盒子坐标/文本行数/行内容/行 x 逐字段严格一致；
 * - 文本行 y 是预期差异字段：PHP getTextOrigin bottom+autowrap 分支的 GD 基线魔数
 *   -round(fontSize*0.1) 不移植，本端按纯对齐锚点语义断言 gotY === y + expectedYDiff。
 */

interface SnapshotRecord {
    op: string
    x: number
    y: number
    w: number
    h: number
    line: string
    expectedYDiff: number
}

interface SnapshotCase {
    name: string
    graph: object
    records: SnapshotRecord[]
}

const cases = (fixture as unknown as { cases: SnapshotCase[] }).cases

/** 录制后端：按快照记录的扁平 paint 序收录原语调用（不产像素） */
function snapshotBackend() {
    const records: SnapshotRecord[] = []
    const backend: RenderBackend = {
        begin() {},
        end() {},
        drawRect(x, y, width, height) {
            records.push({ op: 'rect', x, y, w: width, h: height, line: '', expectedYDiff: 0 })
        },
        drawImage(_src, x, y, width, height) {
            records.push({ op: 'image', x, y, w: width, h: height, line: '', expectedYDiff: 0 })
        },
        drawText(line, x, y) {
            records.push({ op: 'text', x, y, w: 0, h: 0, line, expectedYDiff: 0 })
        },
    }
    return { records, backend }
}

describe('布局快照 fixture（layout-snapshot v1）', () => {
    it('用例集非空（PHP 导出脚本同源）', () => {
        expect(cases.length).toBeGreaterThan(0)
    })

    it.each(cases.map((c) => [c.name, c] as const))('%s：wire 互通 + 绘制记录逐条一致', (_name, c) => {
        // 1) graph wire 互通：解码 → 再编码与输入逐字段一致
        const doc = decodeGraph(c.graph)
        expect(encodeGraph(doc)).toEqual(c.graph)

        // 2) 布局一致：渲染模板驱动录制后端，与快照 paint 序逐条比对
        const { records, backend } = snapshotBackend()
        renderCanvas(doc, backend)

        expect(records).toHaveLength(c.records.length)
        c.records.forEach((want, i) => {
            const got = records[i]!
            expect(got.op).toBe(want.op)
            if (want.op === 'text') {
                expect(got.line).toBe(want.line)
                expect(got.x).toBe(want.x)
                // 预期差异字段：纯对齐锚点语义 = PHP y + GD 基线魔数标注
                expect(got.y).toBe(want.y + want.expectedYDiff)
            } else {
                expect([got.x, got.y, got.w, got.h]).toEqual([want.x, want.y, want.w, want.h])
            }
        })
    })
})
