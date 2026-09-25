import { describe, expect, it } from 'vitest'

import {
    LINE_END_FORBIDDEN,
    LINE_START_FORBIDDEN,
    createHeuristicMeasurer,
    createUax14LineBreaker,
} from '../../src/index'

/** 度量器按字号 10 估算：半角字符 5.5px，全角字符 10px（对齐 phpunit 同款助手） */
function measurer(fontSize = 10) {
    return createHeuristicMeasurer(fontSize)
}

describe('启发式度量器（phpunit HeuristicMeasurerTest 逐值平移）', () => {
    it('半角可打印 ASCII 计 0.55 字宽：3 × 0.55 × 12px', () => {
        expect(createHeuristicMeasurer(12).measure('abc')).toBeCloseTo(0.55 * 3 * 12, 3)
    })

    it('全角 CJK 计 1 字宽：2 × 12px', () => {
        expect(createHeuristicMeasurer(12).measure('中文')).toBeCloseTo(2.0 * 12, 3)
    })

    it('混排按字符分类累加：(0.55 + 1.0) × 10px', () => {
        expect(createHeuristicMeasurer(10).measure('a中')).toBeCloseTo((0.55 + 1.0) * 10, 3)
    })

    it('空文本度量为 0', () => {
        expect(createHeuristicMeasurer(12).measure('')).toBe(0)
    })
})

describe('禁则表与 PHP 同表', () => {
    it('行首禁则表 27 项逐字符一致', () => {
        expect(LINE_START_FORBIDDEN).toEqual([
            '，', '。', '、', '；', '：', '！', '？',
            '」', '』', '）', '】', '》', '〉', '…', '—', '～', '·',
            '!', '?', '%', ',', '.', ';', ':', ')', ']', '}',
        ])
    })

    it('行末禁则表 11 项逐字符一致', () => {
        expect(LINE_END_FORBIDDEN).toEqual([
            '「', '『', '（', '【', '《', '〈', '“', '‘',
            '(', '[', '{',
        ])
    })
})

describe('UAX #14 简化断行器（phpunit Uax14LineBreakerTest 逐值平移）', () => {
    const breaker = createUax14LineBreaker()

    it('CJK 字间皆可断：每字 10px、盒宽 20px → 每行两字', () => {
        expect(breaker('一二三四五', 20, measurer())).toEqual(['一二', '三四', '五'])
    })

    it('拉丁优先词边界断行："hello w" 放到 40px 时 o 溢出，回退空格断点', () => {
        expect(breaker('hello world', 40, measurer())).toEqual(['hello', 'world'])
    })

    it('连字符断点保留在行尾', () => {
        expect(breaker('co-op', 20, measurer())).toEqual(['co-', 'op'])
    })

    it('行首禁则上移："，" 不落行首，上移到上一行行尾（允许轻微溢出）', () => {
        expect(breaker('一二三，四五六', 30, measurer())).toEqual(['一二三，', '四五六'])
    })

    it('行末禁则下移："（" 不留行尾，下移到下一行行首', () => {
        expect(breaker('一二（三四', 30, measurer())).toEqual(['一二', '（三四'])
    })

    it('断点处剔除行尾空白', () => {
        expect(breaker('ab cd', 20, measurer())).toEqual(['ab', 'cd'])
    })

    it('显式换行保留', () => {
        expect(breaker('ab\ncd', 100, measurer())).toEqual(['ab', 'cd'])
    })

    it('空段保留为空行（尊重显式换行的版式意图）', () => {
        expect(breaker('a\n\nb', 100, measurer())).toEqual(['a', '', 'b'])
    })

    it('空文本不产行', () => {
        expect(breaker('', 100, measurer())).toEqual([])
    })

    it('无词边界的长词硬断', () => {
        expect(breaker('abcdefghij', 20, measurer())).toEqual(['abc', 'def', 'ghi', 'j'])
    })

    it('单字符超宽仍然渲染（断行过程必然前进）', () => {
        expect(breaker('一', 5, measurer())).toEqual(['一'])
    })

    it('emoji ZWJ 组合序列按一个图素簇计宽与断行（Intl.Segmenter，不拆碎）', () => {
        // PHP 用例是三人家庭 emoji；本端字素切分经 Intl.Segmenter（UAX #29），ZWJ 序列完整
        const family = '👨‍👩‍👧'
        expect(breaker(family + '👍', 15, measurer())).toEqual([family, '👍'])
    })

    it('组合字符（含变音符）按单簇断行不拆散', () => {
        // e + U+0301 组合尖音符 = 一个用户感知字符；宽度按码点计（0.55 + 1.0）× 字号，
        // 断行以簇为最小单元——整簇上移/下移，不会拆出孤立变音符
        expect(breaker('ééé', 10, measurer())).toEqual(['é', 'é', 'é'])
    })
})
