/// <reference types="node" />
// 同步校验用 node:fs 读两份 fixture；tsconfig types:[] 不自动收 @types/node，此文件显式引
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import fixture from '../fixtures/layout-snapshot.json'
import { decodeGraph, encodeGraph, heuristicMeasurerFactory, renderCanvas } from '../../src/index'
import type { RenderBackend } from '../../src/index'

/**
 * 布局快照 fixture（三端一份契约数据）：PHP 导出脚本对固定用例集产出
 * "graph + 绘制原语记录"，go-canvas 已消费同份 JSON（renderer/layoutsnapshot_test.go），
 * 本端逐记录断言——快照 diff 即三端布局行为 diff。
 *
 * 断言规则（对齐 Go 侧）：
 * - graph wire 互通：解码 → 再编码须与输入逐字段一致（fixture graph 为重放一次的规范形）；
 * - 绘制记录：op/盒子坐标/文本行数/行内容/行 x 逐字段严格一致；
 * - 文本行 y 是预期差异字段（白名单）：PHP getTextOrigin bottom+autowrap 分支的 GD 基线
 *   魔数 -round(fontSize*0.1) 不移植，本端按纯对齐锚点语义断言 gotY === y + expectedYDiff，
 *   并反向锁死 expectedYDiff 只允许出现在 text 记录（rect/image 恒 0）——白名单外零容忍；
 * - 度量模式锁定：fixture 由 PHP 启发式度量器导出，本端显式注入 heuristicMeasurerFactory
 *   断言（增强模式 measureText 是宿主显式注入的编辑期行为，不参与三端契约）。
 *
 * fixture 是 go-canvas testdata 的镜像副本（工作区两仓库并列时同步校验；CI 单仓
 * checkout 无此目录则跳过）——再生成走 go-canvas 仓库 `make layout-snapshot`。
 */

interface SnapshotMeta {
    contract: string
    generator: string
    notes: string[]
}

/** 记录 schema 按 op 分叉：text = {x, y, line, expectedYDiff}，rect/image = {x, y, w, h} */
interface SnapshotRecord {
    op: string
    x: number
    y: number
    w?: number
    h?: number
    line?: string
    expectedYDiff?: number
}

interface SnapshotCase {
    name: string
    graph: object
    records: SnapshotRecord[]
}

const { meta, cases } = fixture as unknown as { meta: SnapshotMeta; cases: SnapshotCase[] }

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

/** go-canvas 同源副本路径（工作区并列布局；单仓 checkout 不存在 → 同步校验跳过）。
 *  以本测试文件位置锚定（不随 vitest 启动 cwd 漂移——漂移会把同步校验静默变跳过）。 */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const localFixturePath = join(packageRoot, 'tests/fixtures/layout-snapshot.json')
const goSnapshotPath = join(packageRoot, '../../../go-canvas/renderer/testdata/layout-snapshot.json')

describe('布局快照 fixture（layout-snapshot v1）', () => {
    it('契约版本钉死：meta.contract 必须是本测试消费的 v1（v2 起断言口径需重审）', () => {
        expect(meta.contract).toBe('layout-snapshot v1')
    })

    // 与 go-canvas testdata 的镜像副本同步校验：工作区两仓库并列时不漂移；
    // CI 单仓 checkout 无 go-canvas 目录 → 跳过（再生成走 go-canvas make layout-snapshot）
    it.skipIf(!existsSync(goSnapshotPath))(
        '与 go-canvas testdata 同源：字节级一致（镜像副本不漂移）',
        () => {
            expect(readFileSync(localFixturePath, 'utf8')).toBe(readFileSync(goSnapshotPath, 'utf8'))
        },
    )

    it('用例集非空（PHP 导出脚本同源）', () => {
        expect(cases.length).toBeGreaterThan(0)
    })

    it('预期差异白名单：expectedYDiff 键只允许标注在 text 记录上（rect/image 无此字段）', () => {
        const offenders = cases.flatMap((c) =>
            c.records.filter((r) => r.op !== 'text' && 'expectedYDiff' in r).map((r) => `${c.name}:${r.op}`),
        )
        expect(offenders).toEqual([])
        // 且白名单真的在用：bottom+autowrap 用例至少带一条非零标注（口径失守即 fixture 退化）
        expect(cases.some((c) => c.records.some((r) => r.op === 'text' && r.expectedYDiff !== 0))).toBe(true)
    })

    it.each(cases.map((c) => [c.name, c] as const))('%s：wire 互通 + 绘制记录逐条一致', (_name, c) => {
        // 1) graph wire 互通：解码 → 再编码与输入逐字段一致
        const doc = decodeGraph(c.graph)
        expect(encodeGraph(doc)).toEqual(c.graph)

        // 2) 布局一致：渲染模板驱动录制后端，与快照 paint 序逐条比对
        //    度量模式锁定：显式启发式工厂（fixture 的导出口径），不走可变缺省
        const { records, backend } = snapshotBackend()
        renderCanvas(doc, backend, { measurerFactory: heuristicMeasurerFactory })

        expect(records).toHaveLength(c.records.length)
        c.records.forEach((want, i) => {
            const got = records[i]!
            expect(got.op).toBe(want.op)
            if (want.op === 'text') {
                expect(got.line).toBe(want.line)
                expect(got.x).toBe(want.x)
                // 预期差异字段：纯对齐锚点语义 = PHP y + GD 基线魔数标注
                expect(got.y).toBe(want.y + (want.expectedYDiff ?? 0))
            } else {
                expect([got.x, got.y, got.w, got.h]).toEqual([want.x, want.y, want.w, want.h])
            }
        })
    })
})
