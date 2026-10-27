/**
 * 二维码物化的默认实现（对位 go-canvas/image-renderer/qr.go 的 QRMaterializer；
 * 同式复制先例、编码器实现不同源——node 侧用 soldair/node-qrcode，参数面与 go
 * （yeqown 适配 endroid 用法）逐项对位，产物字节面语义一致）：
 *   - 纠错 = QR 'H' 30%（go ErrorCorrectionHighest；node-qrcode 库默认非 H，须显式覆写）；
 *   - size = max(width, 1)（对齐 endroid size=max(图层宽,1)）；
 *   - margin = 0（node-qrcode 库默认 4 模块静区，显式归零，对位 WithBorderWidth(0)）；
 *   - 纯黑前景/纯白背景（不透明，对位 color.Black/White）；
 *   - 显式 PNG 输出。
 *   - 编码模式复刻 bacon chooseMode 三分（pickEncMode 同式复制自 go qr.go）：
 *     纯数字→Numeric、QR 字母数字集→Alphanumeric、其余→Byte，**无 Kanji 分支**
 *     ——node-qrcode 自动模式会对纯中日文升级 Kanji（与 go EncModeAuto 同病），
 *     必须以显式 segment 模式压制，保证与 go/endroid 矩阵一致。
 *
 * 参数映射注（块宽语义）：go WithQRWidth(uint8) = 整数块像素宽，出图 = 模块数×块宽；
 * node-qrcode 的 `scale` 即同语义（每模块像素数），故 blockWidth = min(max(size/模块数,
 * 1), 255) 向零截断后直接作 scale——出图绝对尺寸与 go 同式（维度×块宽），对目标宽
 * 向下量化、目标宽小于模块数时块宽钳 1 出图反大于目标宽；差异由渲染原语内切正方形
 * cover 缩放铺放吸收（ADR 0015 同门），只影响缓存 PNG 绝对尺寸。255 上限对位 go
 * uint8 形参界（node 无此硬界，同式钳保持产物尺寸面一致）。
 */
import QRCode, { type QRCodeSegment } from 'qrcode'
import { Buffer } from 'node:buffer'
import { ResourceMaterializeError, type QRMaterializer } from '@hankchen/canvas'

/** 二维码物化默认实现（固定选项；核心 QRMaterializer 契约的实现） */
export class QRCodeMaterializer implements QRMaterializer {
    async materialize(text: string, width: number): Promise<Uint8Array> {
        const size = Math.max(width, 1) // 对齐 endroid size=max(图层宽,1)
        const segment = segmentFor(text, pickEncMode(text))

        try {
            // 模块数决定块宽量化（create 与 toBuffer 同输入同矩阵）
            const code = QRCode.create([segment], { errorCorrectionLevel: 'H' })
            const blockWidth = Math.min(Math.max(Math.trunc(size / code.modules.size), 1), 255)
            const png = await QRCode.toBuffer([segment], {
                errorCorrectionLevel: 'H',
                margin: 0,
                scale: blockWidth,
                color: { dark: '#000000ff', light: '#ffffffff' },
            })
            return new Uint8Array(png)
        } catch (error) {
            throw new ResourceMaterializeError('qr_generate_failed', `二维码生成失败(${text}): ${(error as Error).message}`)
        }
    }
}

/** 编码模式判定结果（node-qrcode segment 模式名；无 Kanji 分支） */
type QrSegmentMode = 'numeric' | 'alphanumeric' | 'byte'

/**
 * 复刻 bacon Encoder::chooseMode 在 UTF-8 提示下的模式选择（同式复制自 go qr.go
 * pickEncMode）：纯数字→Numeric、QR 字母数字集→Alphanumeric、其余→Byte，无
 * Kanji 分支。与 node-qrcode 自动模式的差别即在此：后者对纯中日文内容升级
 * Kanji 码，两端矩阵不一致
 */
function pickEncMode(text: string): QrSegmentMode {
    if (text === '') {
        return 'byte' // bacon chooseMode 空串守卫，忠实复刻（实际到不了：resolver 已拦空内容）
    }
    if (isAllDigits(text)) {
        return 'numeric'
    }
    if (isAllAlphaNum(text)) {
        return 'alphanumeric'
    }
    return 'byte'
}

/** segment 构造（判别联合按分支收窄，显式模式压制库的 Kanji 自动升级）。
 * byte 分支传 UTF-8 字节面（@types 的 ByteSegment 只收字节序列；运行时对
 * string 与 UTF-8 Buffer 同码） */
function segmentFor(text: string, mode: QrSegmentMode): QRCodeSegment {
    switch (mode) {
        case 'numeric':
            return { data: text, mode: 'numeric' }
        case 'alphanumeric':
            return { data: text, mode: 'alphanumeric' }
        default:
            return { data: Buffer.from(text, 'utf8'), mode: 'byte' }
    }
}

/** 纯 ASCII 数字（PHP ctype_digit 语义，空串由调用方先行分流） */
function isAllDigits(text: string): boolean {
    for (const ch of text) {
        if (ch < '0' || ch > '9') {
            return false
        }
    }
    return true
}

/** QR 字母数字集（PHP/bacon 与 node-qrcode 的字符表一致：0-9 A-Z 空格 $ % * + - . / :） */
function isAllAlphaNum(text: string): boolean {
    for (const ch of text) {
        if ((ch < '0' || ch > '9') && (ch < 'A' || ch > 'Z')) {
            switch (ch) {
                case ' ':
                case '$':
                case '%':
                case '*':
                case '+':
                case '-':
                case '.':
                case '/':
                case ':':
                    break
                default:
                    return false
            }
        }
    }
    return true
}
