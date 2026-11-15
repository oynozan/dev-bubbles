// Methods are upper case, ALL matches any method
export type Route = { method: string, path: string }

export type HttpCall = { method: string, path: string }

export type FileAnalysis = {
    imports: string[]
    routes: Route[]
    calls: HttpCall[]
}

export interface Analyzer {
    match(path: string): boolean
    analyze(path: string, source: string): FileAnalysis
}
