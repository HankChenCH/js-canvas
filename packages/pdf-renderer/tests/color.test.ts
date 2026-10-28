import { describe, expect, it } from 'vitest'

import { parseColor } from '../src/color'

/**
 * 颜色解析测试（对位 go pdf-renderer color_test.go）：hex 四形态 + 非法输入报错。
 * parseColor 与 image-renderer 侧同式复制（跨端矩阵平移纪律），防线对称。
 */
describe('parseColor（对位 go color.go parseColor，hex 四形态）', () => {
    it('#rgb 逐位翻倍 + #rrggbb 直解', () => {
        expect(parseColor('#f00')).toEqual({ r: 255, g: 0, b: 0, a: 255 })
        expect(parseColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 255 })
    })

    it('#rgba / #rrggbbaa 带直 alpha', () => {
        expect(parseColor('#f00a')).toEqual({ r: 255, g: 0, b: 0, a: 170 })
        expect(parseColor('#ff000080')).toEqual({ r: 255, g: 0, b: 0, a: 128 })
    })

    it('前导 # 可省略；大小写均可', () => {
        expect(parseColor('3366cc')).toEqual({ r: 0x33, g: 0x66, b: 0xcc, a: 255 })
        expect(parseColor('#ABC')).toEqual({ r: 170, g: 187, b: 204, a: 255 })
    })

    it('非法形态报错（长度越界 / 非十六进制位），消息含原文', () => {
        // 注意 #ff00 是合法 #rgba 形态（4 位逐位翻倍），长度 3/4/6/8 之外才越界
        expect(() => parseColor('#ff00f')).toThrow(/无法解析颜色/)
        expect(() => parseColor('#ff00f')).toThrow(/#ff00f/)
        expect(() => parseColor('#12g45z')).toThrow(/无法解析颜色/)
        expect(() => parseColor('red')).toThrow(/无法解析颜色/)
        expect(() => parseColor('')).toThrow(/无法解析颜色/)
    })
})
