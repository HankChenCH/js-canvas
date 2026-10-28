/**
 * URL 判定小件（对位 go resolver/resolver.go isRemoteURL/IsNumeric 的渲染端消费面；
 * 同式复制先例 = pdf-renderer src/url.ts，两后端包互不 import 的红线内各自持有）。
 * 与 resolver 默认实现（resolver.ts）、字体装配（typography.ts isBuiltinFont）
 * 共用同一口径，防多处判定漂移。
 */

/**
 * isRemoteURL 是否远程 URL：协议无关，凡可解析出 scheme 与 host 即视为远程
 * （对齐 PHP FILTER_VALIDATE_URL 的「须带协议与主机」；支持的协议面由注入的
 * fetch/Downloader 决定），其余一律按本地路径直接使用
 */
export function isRemoteURL(s: string): boolean {
    try {
        const url = new URL(s)
        return url.protocol !== '' && url.host !== ''
    } catch {
        return false
    }
}

/**
 * isNumeric 纯数字判定：近似 PHP is_numeric（整型/浮点字面量）。纯数字字体 id 是
 * 旧库 GD 内置字体编号，语义 = 「无字体文件」→渲染端内置默认字体；本函数是 resolver
 * 跳过字体物化与 typography.isBuiltinFont 回退默认字体的**同一口径**（对位 go
 * resolver.IsNumeric 导出防漂移的分工）
 */
export function isNumeric(s: string): boolean {
    if (s === '') return false
    return Number.isFinite(Number(s))
}
