/**
 * URL 判定小件（对位 go resolver/resolver.go isRemoteURL/IsNumeric 的渲染端消费面）。
 * 与 resolver 默认实现（resolver.ts）共用同一口径，防两处判定漂移。
 */

/**
 * isRemoteURL 是否远程 URL：协议无关，凡可解析出 scheme 与 host 即视为远程
 * （对齐 PHP FILTER_VALIDATE_URL 的「须带协议与主机」；支持的协议面由注入的
 * Downloader 决定），其余一律按本地路径直接使用
 */
export function isRemoteURL(s: string): boolean {
    try {
        const u = new URL(s)
        return u.protocol !== '' && u.host !== ''
    } catch {
        return false
    }
}

/**
 * isNumeric 纯数字判定：近似 PHP is_numeric（整型/浮点字面量）。纯数字字体 id 是
 * 旧库 GD 内置字体编号，语义 = 「无字体文件」→渲染端内置默认字体；本函数是 resolver
 * 跳过字体物化与渲染后端回退默认字体的**同一口径**（对位 go resolver.IsNumeric 导出
 * 防漂移的分工）
 */
export function isNumeric(s: string): boolean {
    if (s === '') return false
    return Number.isFinite(Number(s))
}
