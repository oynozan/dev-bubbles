import type {
    Argument,
    CallExpression,
    Expression,
    ExpressionStatement,
    ObjectExpression,
    PropertyKey,
    TemplateLiteral,
} from 'oxc-parser'
import type { HttpCall, Route } from './types.ts'

const serverMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'])
const axiosMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])
const nextMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

const appRouterFile = /(?:^|\/)app\/(?:(.*)\/)?route\.(?:ts|js|tsx|jsx)$/
const pagesApiFile = /(?:^|\/)pages\/(api\/.*)\.(?:ts|js|tsx|jsx)$/

/* Routes */

// Registrations are bare statements, so awaited, returned or assigned client calls never count
export function registeredRoutes(statement: ExpressionStatement): Route[] {
    const routes: Route[] = []
    let expression = statement.expression
    while (expression.type === 'CallExpression' && expression.callee.type === 'MemberExpression') {
        const route = serverRoute(expression)
        if (!route) break
        routes.unshift(route)
        expression = expression.callee.object
    }
    return routes
}

function serverRoute(call: CallExpression): Route | undefined {
    const { callee, arguments: args } = call
    if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return undefined
    const method = callee.property.name
    // A handler argument keeps Map.get and Map.delete out
    const hasHandler = args.length >= 2 && args.at(-1)?.type !== 'ObjectExpression'
    if (!serverMethods.has(method) || !hasHandler || isIdentifier(callee.object, 'axios')) return undefined
    const path = localPath(args[0])
    // Server routes name parameters with :id, so an interpolated path is a client call
    return path === undefined || path.includes('${') ? undefined : { method: method.toUpperCase(), path }
}

export function nextRoutes(filePath: string, exportNames: string[]): Route[] {
    const appRoute = appRouterFile.exec(filePath)
    if (appRoute) {
        const path = routePath(appRoute[1] ?? '')
        return exportNames.filter((name) => nextMethods.has(name)).map((method) => ({ method, path }))
    }
    const pagesRoute = pagesApiFile.exec(filePath)
    if (pagesRoute) return [{ method: 'ALL', path: routePath(pagesRoute[1].replace(/\/index$/, '')) }]
    return []
}

function routePath(folder: string): string {
    const isRouteGroup = (segment: string) => segment.startsWith('(') && segment.endsWith(')')
    return '/' + folder.split('/').filter((segment) => segment !== '' && !isRouteGroup(segment)).join('/')
}

/* Calls */

export function httpCall(call: CallExpression): HttpCall | undefined {
    const { callee } = call
    const [first, second] = call.arguments
    if (isIdentifier(callee, 'fetch')) return clientCall(first, optionsMethod(second))
    if (isIdentifier(callee, 'axios')) {
        return first?.type === 'ObjectExpression'
            ? clientCall(propertyValue(first, 'url'), optionsMethod(first))
            : clientCall(first, optionsMethod(second))
    }
    const isAxiosMethod = callee.type === 'MemberExpression' && !callee.computed && isIdentifier(callee.object, 'axios')
        && callee.property.type === 'Identifier' && axiosMethods.has(callee.property.name)
    return isAxiosMethod ? clientCall(first, callee.property.name.toUpperCase()) : undefined
}

function clientCall(url: Argument | undefined, method: string): HttpCall | undefined {
    const path = localPath(url)
    return path === undefined ? undefined : { method, path }
}

function optionsMethod(options: Argument | undefined): string {
    const method = options?.type === 'ObjectExpression' ? staticString(propertyValue(options, 'method')) : undefined
    return method?.toUpperCase() ?? 'GET'
}

function propertyValue(object: ObjectExpression, name: string): Expression | undefined {
    for (const property of object.properties) {
        if (property.type !== 'Property' || property.computed) continue
        const key = property.key.type === 'Identifier' ? property.key.name : staticString(property.key)
        if (key === name) return property.value
    }
    return undefined
}

/* Matching */

export function matchesRoute(call: HttpCall, route: Route): boolean {
    if (route.method !== 'ALL' && route.method !== call.method) return false
    const callSegments = pathSegments(call.path)
    const routeSegments = pathSegments(route.path)
    for (const [index, routeSegment] of routeSegments.entries()) {
        if (isRestSegment(routeSegment)) return index < callSegments.length || routeSegment.startsWith('[[')
        const callSegment = callSegments[index]
        if (callSegment === undefined) return false
        if (callSegment !== routeSegment && !isParamSegment(callSegment) && !isParamSegment(routeSegment)) return false
    }
    return callSegments.length === routeSegments.length
}

export function isCatchAllRoute(route: Route): boolean {
    return pathSegments(route.path).some(isRestSegment)
}

function pathSegments(path: string): string[] {
    return path.split('/').filter((segment) => segment !== '')
}

function isRestSegment(segment: string): boolean {
    return segment.startsWith('[...') || segment.startsWith('[[...') || segment.startsWith('*')
}

function isParamSegment(segment: string): boolean {
    return segment.startsWith(':') || segment.startsWith('[') || segment.includes('${')
}

/* Literals */

export function staticString(node: Argument | PropertyKey | undefined): string | undefined {
    if (node?.type === 'Literal') return typeof node.value === 'string' ? node.value : undefined
    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) return templateText(node)
    return undefined
}

function localPath(node: Argument | undefined): string | undefined {
    const url = node?.type === 'TemplateLiteral' ? templateText(node) : staticString(node)
    if (!url?.startsWith('/') || url.startsWith('//')) return undefined
    const path = url.split(/[?#]/)[0]
    return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

function templateText(template: TemplateLiteral): string {
    return template.quasis.map((quasi, index) => {
        const text = quasi.value.cooked ?? quasi.value.raw
        const expression = template.expressions[index]
        return expression ? text + placeholder(expression) : text
    }).join('')
}

function placeholder(expression: Expression): string {
    return expression.type === 'Identifier' ? `\${${expression.name}}` : '${}'
}

function isIdentifier(node: Expression, name: string): boolean {
    return node.type === 'Identifier' && node.name === name
}
