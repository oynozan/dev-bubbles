import { parseSync, Visitor } from 'oxc-parser'
import type { CallExpression } from 'oxc-parser'
import { httpCall, nextRoutes, serverRoute, staticString } from './http.ts'
import type { Analyzer, FileAnalysis, HttpCall } from './types.ts'

const sourceFile = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/

// Building the AST is most of the parse cost and only these constructs need it
const needsAst = /\b(?:require|import)\s*\(|['"`]\//

export const jsTsAnalyzer: Analyzer = {
    match: (path) => sourceFile.test(path) && !path.endsWith('.d.ts'),
    analyze: analyzeJsTs,
}

function analyzeJsTs(path: string, source: string): FileAnalysis {
    // React projects often put JSX in plain .js files
    const parsed = parseSync(path, source, path.endsWith('.js') ? { lang: 'jsx' } : {})
    const imports = new Set(parsed.module.staticImports.map((entry) => entry.moduleRequest.value))
    const exportNames: string[] = []
    for (const entry of parsed.module.staticExports.flatMap((statement) => statement.entries)) {
        if (entry.moduleRequest) imports.add(entry.moduleRequest.value)
        if (entry.exportName.name) exportNames.push(entry.exportName.name)
    }
    const routes = nextRoutes(path, exportNames)
    const calls: HttpCall[] = []
    if (needsAst.test(source)) {
        new Visitor({
            ImportExpression(node) {
                const specifier = staticString(node.source)
                if (specifier) imports.add(specifier)
            },
            CallExpression(node) {
                const required = isRequire(node) ? staticString(node.arguments[0]) : undefined
                if (required) imports.add(required)
                const route = serverRoute(node)
                if (route) routes.push(route)
                const call = httpCall(node)
                if (call) calls.push(call)
            },
        }).visit(parsed.program)
    }
    return { imports: [...imports], routes, calls }
}

function isRequire(call: CallExpression): boolean {
    return call.callee.type === 'Identifier' && call.callee.name === 'require'
}
