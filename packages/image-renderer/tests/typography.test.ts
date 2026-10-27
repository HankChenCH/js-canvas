/**
 * napi 真实度量器测试（08 号决议 v1 单组件；go typography/measurer.go 移植面）：
 * 真实宽度与绘制同源、内置默认字体判定同口径、加载失败降级启发式（布局不中断）、
 * TTC 在度量侧降级（拒收只在绘制端 fail-fast 的刻意差异）。
 */
import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { createHeuristicMeasurer } from '@hankchen/canvas'

import { createNapiMeasurerFactory, isBuiltinFont, registerFontData } from '../src/typography'

function probeSystemFont(): string | null {
    const candidates = [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/System/Library/Fonts/Supplemental/Times New Roman.ttf',
    ]
    for (const p of candidates) {
        try {
            if (statSync(p).isFile()) return p
        } catch {
            // 试下一个候选
        }
    }
    return null
}

const SYSTEM_FONT = probeSystemFont()

describe('isBuiltinFont 判定（对位 go IsBuiltinFont/IsNumeric 同口径）', () => {
    it('空串与纯数字（含浮点字面量）为内置', () => {
        expect(isBuiltinFont('')).toBe(true)
        expect(isBuiltinFont('1')).toBe(true)
        expect(isBuiltinFont('42')).toBe(true)
        expect(isBuiltinFont('1.5')).toBe(true)
        expect(isBuiltinFont('-3')).toBe(true)
    })

    it('路径/族名/非数字 id 不是内置', () => {
        expect(isBuiltinFont('/fonts/Arial.ttf')).toBe(false)
        expect(isBuiltinFont('Arial')).toBe(false)
        expect(isBuiltinFont('abc')).toBe(false)
        expect(isBuiltinFont('1x')).toBe(false)
    })
})

describe('createNapiMeasurerFactory（核心 TextMeasurerFactory 契约）', () => {
    it('内置默认字体度量出正宽度', () => {
        const measurer = createNapiMeasurerFactory('', 12)
        expect(measurer.measure('abc')).toBeGreaterThan(0)
        expect(measurer.measure('中文')).toBeGreaterThan(0)
    })

    describe.skipIf(SYSTEM_FONT === null)('真实字体', () => {        const font = SYSTEM_FONT as string

        it('真实度量宽度为正且与绘制度量同源（宽度随字号线性）', () => {
            const small = createNapiMeasurerFactory(font, 12)
            const large = createNapiMeasurerFactory(font, 24)
            const w12 = small.measure('Hello')
            const w24 = large.measure('Hello')
            expect(w12).toBeGreaterThan(0)
            // 同字体同文本，字号翻倍宽度近似翻倍（真实度量表语义，启发式亦线性——
            // 此处只锚定「宽度随字号缩放」不锚定具体字形宽）
            expect(w24).toBeGreaterThan(w12 * 1.5)
        })

        it('CJK 宽度大于拉丁（真实字形的宽差异被度量出来）', () => {
            const measurer = createNapiMeasurerFactory(font, 16)
            expect(measurer.measure('中文中文')).toBeGreaterThan(measurer.measure('abab'))
        })

        it('加载失败降级核心启发式（缺文件/远程未物化，布局不中断）', () => {
            const measurer = createNapiMeasurerFactory('/nonexistent/go-canvas-font.ttf', 12)
            const heuristic = createHeuristicMeasurer(12)
            expect(measurer.measure('abc中文')).toBe(heuristic.measure('abc中文'))
        })

        it('TTC 在度量侧降级启发式（拒收只在绘制端 fail-fast）', () => {
            const ttc = ['/System/Library/Fonts/Supplemental/AmericanTypewriter.ttc'].find((p) => {
                try {
                    return statSync(p).isFile()
                } catch {
                    return false
                }
            })
            if (ttc === undefined) return
            const measurer = createNapiMeasurerFactory(ttc, 12)
            const heuristic = createHeuristicMeasurer(12)
            expect(measurer.measure('abc')).toBe(heuristic.measure('abc'))
        })

        it('registerFontData 登记的字节可按 ref 度量（远程字体物化缝）', () => {
            registerFontData('https://fonts.example/go-canvas-test.ttf', readFontBytes(font))
            const measurer = createNapiMeasurerFactory('https://fonts.example/go-canvas-test.ttf', 14)
            expect(measurer.measure('Hello')).toBeGreaterThan(0)
        })
    })
})

/** 读探针字体字节（registerFontData 缝的测试输入） */
function readFontBytes(path: string): Uint8Array {
    return new Uint8Array(readFileSync(path))
}
