/**
 * 文本子系统契约与对齐版默认实现（镜像 php-canvas-next Text\* 与 go-canvas text 包）：
 * 度量与断行分离——断行器只关心"这一段放不放得下"，宽度从哪来（启发式估算/字体
 * 度量表/驱动测量）由实现决定；度量器经工厂注入（默认启发式，对齐两端默认行为，
 * 增强模式显式配置不隐式切换）。
 *
 * 断行的最小单元是用户感知字符：字素簇经 Intl.Segmenter（UAX #29）切分，emoji 的
 * ZWJ 组合序列、组合字符都算一个单元。（Go 核心因零依赖约束默认码点切分并留注入缝；
 * 浏览器基线桌面 evergreen 自带 Intl.Segmenter，无需降级路径。）
 */

/** 文本宽度度量器（已配置好字体/字号等上下文） */
export interface TextMeasurer {
    /** 度量一段文本的渲染宽度（像素） */
    measure(text: string): number
}

/** 度量器工厂（策略注入点）：函数类型即工厂。图层字号各不相同，注入工厂而非度量器
 * 实例，保证所有图层按自身字体/字号得到同一种度量策略 */
export type TextMeasurerFactory = (font: string, fontSize: number) => TextMeasurer

/** 断行器：把文本按盒宽断行为若干行。显式换行符保留（空段产出空行），
 * 返回行内容不含换行符 */
export type LineBreaker = (text: string, boxWidth: number, measurer: TextMeasurer) => string[]

/** 行首禁则：收尾类标点不能出现在行首（与 PHP Uax14LineBreaker 同表，工单 03） */
export const LINE_START_FORBIDDEN: readonly string[] = [
    '，', '。', '、', '；', '：', '！', '？',
    '」', '』', '）', '】', '》', '〉', '…', '—', '～', '·',
    '!', '?', '%', ',', '.', ';', ':', ')', ']', '}',
]

/** 行末禁则：起始类标点不能出现在行末（与 PHP 同表） */
export const LINE_END_FORBIDDEN: readonly string[] = [
    '「', '『', '（', '【', '《', '〈', '“', '‘',
    '(', '[', '{',
]

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** 字素簇切分（UAX #29）：最小单元 = 用户感知字符 */
export function splitGraphemes(text: string): string[] {
    if (text === '') return []
    return Array.from(GRAPHEME_SEGMENTER.segment(text), (seg) => seg.segment)
}

/** 可打印 ASCII 的字宽计权（PHP HeuristicMeasurer::HALF_WIDTH） */
const HALF_WIDTH = 0.55

function isPrintableAscii(codePoint: string): boolean {
    return codePoint.length === 1 && codePoint >= ' ' && codePoint <= '~'
}

/**
 * 字符数启发式度量器（默认注入点）：不看字体文件，按码点分类估算宽度——
 * 可打印 ASCII 计 0.55 字宽，其余（CJK/全角/其他）计 1，再乘字号。
 * 与旧库 php-canvas 的 autowrap 计权一致，保证迁移期观感接近（对齐三端默认行为）
 */
export function createHeuristicMeasurer(fontSize: number): TextMeasurer {
    return {
        measure(text) {
            let units = 0
            for (const codePoint of text) {
                units += isPrintableAscii(codePoint) ? HALF_WIDTH : 1
            }
            return units * fontSize
        },
    }
}

/** 启发式度量器工厂：估算与具体字体文件无关，只依赖字号（忽略 font 实参） */
export const heuristicMeasurerFactory: TextMeasurerFactory = (_font, fontSize) =>
    createHeuristicMeasurer(fontSize)

/**
 * 度量源最小结构面：CanvasRenderingContext2D 的结构等价（canvas-next 零 DOM 红线
 * ——不引 DOM lib，宿主传真实 2D 上下文即结构契合；测试以结构替身注桩）。建议宿主
 * 用专用离屏上下文，与渲染面互不干扰（字体经 FontFace 注册后 document 全局可解析，
 * 离屏度量与渲染面同效）
 */
export interface MeasureTextSource {
    /** ctx.font 简写（CSS font 属性），度量前按图层字体与字号设置 */
    font: string
    measureText(text: string): { width: number }
}

export interface MeasureTextMeasurerOptions {
    /**
     * 图层字体引用 → CSS font 族简写（内置引用 → sans-serif、URL → 注册族名）。
     * 缺省恒等映射 + 空引用 sans-serif 兜底——URL 引用的正确映射（注册族名派生）
     * 属渲染端知识，由宿主注入（browser-renderer 的 canvasFontCssFamily 同源）
     */
    readonly fontCssFamily?: (font: string) => string
}

/**
 * 浏览器 measureText 度量器工厂（与启发式工厂并列的增强注入面）：canvas 2D context
 * 按图层字体引用与字号构造度量器——每次度量前设置 ctx.font 简写（drawText 每次绘制
 * 同样先设 font，同 this 用前设置的纪律；简写字面与绘制端 fontShorthand 不强求一致
 * ——注册族名 fnv-1a base36 CSS 安全，度量端免引号并附 sans-serif 回落，注册命中与
 * 未注册回落两态与绘制端行为一致），宽度取 metrics.width 像素浮点（取整决策留在
 * 求值点，layerWidth 定 ceil）。经 TextLayoutPolicies.measurerFactory 由宿主显式注入，
 * 宽自适应求值与断行从此走真实字体度量；不注入恒启发式（增强模式不隐式切换）。
 * 注意：ctx.font 非法赋值被浏览器静默忽略、度量会残留上一简写——URL/数字内置引用
 * 必须由宿主经 fontCssFamily 注入正确映射，缺省恒等映射只对 CSS 安全引用成立
 */
export function createMeasureTextMeasurerFactory(
    context: MeasureTextSource,
    options?: MeasureTextMeasurerOptions,
): TextMeasurerFactory {
    const resolveFamily =
        options?.fontCssFamily ?? ((font: string) => (font.trim() === '' ? 'sans-serif' : font))

    return (font, fontSize) => {
        const shorthand = `${fontSize}px ${resolveFamily(font)}`
        return {
            measure(text) {
                context.font = shorthand
                return context.measureText(text).width
            },
        }
    }
}

function joinClusters(clusters: string[]): string {
    return clusters.join('')
}

function isBlank(cluster: string): boolean {
    return cluster === ' ' || cluster === '\t'
}

function isLineStartForbidden(cluster: string): boolean {
    return LINE_START_FORBIDDEN.includes(cluster)
}

function isLineEndForbidden(cluster: string): boolean {
    return LINE_END_FORBIDDEN.includes(cluster)
}

/**
 * UAX #14 简化版断行器（默认实现，逐条镜像 PHP 同名类 / go-canvas 同名移植）：
 * - 以字素簇为最小单元，emoji 等组合序列不被拆碎；
 * - CJK 字间皆可断；拉丁文本优先在空格/连字符处断行（词边界优先，装不下再逐字硬断）；
 * - 禁则处理（kinsoku）：行首不出现收尾类标点（上移到上一行，允许轻微溢出），
 *   行末不出现起始类标点（下移到下一行行首）；
 * - 断点处剔除行尾与行首的空白。
 *
 * 完整 UAX #14 规则表与 Knuth–Plass 全局最优断行不在实现范围内，
 * 需要时经 LineBreaker 注入更强实现
 */
export function createUax14LineBreaker(): LineBreaker {
    return (text, boxWidth, measurer) => {
        if (text === '') return []

        const lines: string[] = []
        for (const segment of text.split('\n')) {
            const chars = splitGraphemes(segment)
            if (chars.length === 0) {
                // 空段保留为空行，尊重显式换行的版式意图
                lines.push('')
                continue
            }

            let current: string[] = []
            for (const char of chars) {
                // 行首第一个字符无条件收录，保证断行过程必然前进
                if (current.length === 0 || measurer.measure(joinClusters(current) + char) <= boxWidth) {
                    current.push(char)
                    continue
                }

                const broken = resolveBreak(current, char)
                if (broken.line.length > 0) lines.push(joinClusters(broken.line))
                current = broken.rest
            }

            if (current.length > 0) lines.push(joinClusters(current))
        }

        return lines
    }
}

/** 在 current 末尾放不下 char 时确定断点，返回 [上一行, 余下内容]（字素簇序列） */
function resolveBreak(current: string[], char: string): { line: string[]; rest: string[] } {
    let line = current
    let rest = [char]

    // 词边界优先：空格断点弃在行尾，连字符断点保留在行尾
    const breakAt = findWordBoundary(current)
    if (breakAt !== -1) {
        const keep = current[breakAt] === '-' ? 1 : 0
        const head = current.slice(0, breakAt + keep)
        const tail = current.slice(breakAt + 1)
        if (head.length > 0) {
            line = head
            rest = [...tail, char]
        }
    }

    line = trimRightBlank(line)
    rest = trimLeftBlank(rest)

    return applyKinsoku(line, rest)
}

/** 词边界断点（空格/连字符所在下标，从行尾向前找），没有则 -1；下标 0 不作断点（PHP i > 0） */
function findWordBoundary(line: string[]): number {
    for (let i = line.length - 1; i > 0; i--) {
        const cluster = line[i]
        if (cluster === ' ' || cluster === '-') return i
    }
    return -1
}

/**
 * 禁则修正：收尾类标点上移到上一行行尾，起始类标点下移到下一行行首。
 * 按字素簇整体比对与搬移（簇切分下复合簇不会误命中单码点禁则表）
 */
function applyKinsoku(line: string[], rest: string[]): { line: string[]; rest: string[] } {
    while (rest.length > 0 && isLineStartForbidden(rest[0]!)) {
        line = [...line, rest[0]!]
        rest = rest.slice(1)
    }

    while (line.length > 0 && isLineEndForbidden(line[line.length - 1]!)) {
        rest = [line[line.length - 1]!, ...rest]
        line = line.slice(0, -1)
    }

    return { line, rest }
}

/** 剔除行尾空白簇（PHP rtrim " \t"） */
function trimRightBlank(line: string[]): string[] {
    while (line.length > 0 && isBlank(line[line.length - 1]!)) {
        line = line.slice(0, -1)
    }
    return line
}

/** 剔除行首空白簇（PHP ltrim " \t"） */
function trimLeftBlank(rest: string[]): string[] {
    while (rest.length > 0 && isBlank(rest[0]!)) {
        rest = rest.slice(1)
    }
    return rest
}
