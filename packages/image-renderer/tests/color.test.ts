import { describe, expect, it } from 'vitest'

import { parseColor } from '../src/color'

/** go color_test 同款四形态 + 非法面；期望值 = 手算字面量（独立事实源） */
describe('parseColor 十六进制颜色解析（对位 go color.go）', () => {
    it('#rgb 三位：逐位翻倍，alpha 补满 255', () => {
        expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 255 })
        expect(parseColor('#123')).toEqual({ r: 0x11, g: 0x22, b: 0x33, a: 255 })
    })

    it('#rgba 四位：逐位翻倍含 alpha', () => {
        expect(parseColor('#f00f')).toEqual({ r: 255, g: 0, b: 0, a: 255 })
        expect(parseColor('#f008')).toEqual({ r: 255, g: 0, b: 0, a: 0x88 })
    })

    it('#rrggbb 六位：alpha 恒 255（直 alpha 无预乘）', () => {
        expect(parseColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 255 })
        expect(parseColor('#128c7e')).toEqual({ r: 0x12, g: 0x8c, b: 0x7e, a: 255 })
    })

    it('#rrggbbaa 八位：直 alpha 原样', () => {
        expect(parseColor('#ff000080')).toEqual({ r: 255, g: 0, b: 0, a: 128 })
        expect(parseColor('#00000000')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    })

    it('前导 # 可省略', () => {
        expect(parseColor('f00')).toEqual({ r: 255, g: 0, b: 0, a: 255 })
        expect(parseColor('ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    })

    it('大写十六进制位接受', () => {
        expect(parseColor('#FF00AA')).toEqual({ r: 255, g: 0, b: 0xaa, a: 255 })
    })

    it('非法长度报错中止（渲染失败即抛纪律）', () => {
        expect(() => parseColor('')).toThrow(/无法解析颜色/)
        expect(() => parseColor('#ff')).toThrow(/无法解析颜色/)
        expect(() => parseColor('#fffff')).toThrow(/无法解析颜色/)
        expect(() => parseColor('#fffffff')).toThrow(/无法解析颜色/)
    })

    it('非法十六进制位报错（PHP 颜色名/rgb() 串本项目不使用）', () => {
        expect(() => parseColor('#zzz')).toThrow(/非法十六进制位/)
        expect(() => parseColor('nope')).toThrow()
        expect(() => parseColor('#ff00zz')).toThrow(/非法十六进制位/)
    })
})
