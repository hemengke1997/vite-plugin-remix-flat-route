import type * as Vite from 'vite'
import { type RouteObject } from 'react-router-dom'
import { pascalSnakeCase } from 'change-case'
import fs from 'node:fs'
import path from 'node:path'
import { findEntry, getRouteManifestModuleExports, getRouteModuleExports } from './remix'
import { type PluginContext, type Route, type RouteExports, type RouteManifest } from './types'
import { type LegacyRoute, type LegacyRouteManifest, type LegacyRouteObject } from './types.legacy'

export function stringifyRoutes(routes: Route[], ctx: PluginContext) {
  const staticImport: string[] = []
  const routesString = routesToString(routes, staticImport, ctx)

  return {
    componentsString: staticImport.join('\n'),
    routesString,
  }
}

function routesToString(routes: Route[] | LegacyRoute[], staticImport: string[], ctx: PluginContext) {
  if (ctx.isLegacyMode) {
    return `[${(routes as LegacyRoute[]).map((route) => legacyRouteToString(route, staticImport, ctx)).join(',')}]`
  } else {
    return `[${(routes as Route[]).map((route) => dataApiRouteToString(route, staticImport, ctx)).join(',')}]`
  }
}

function _setProps<T>(props: Map<T, string | boolean>, name: T, value: string | boolean) {
  if (value) {
    props.set(name, `${value}`)
  }
}

/**
 * @description 判断是否在导出中
 * @param route 路由对象
 * @param exportName 导出名称
 * @example route.hasComponent
 */
function isInExports<T>(route: Route | LegacyRoute, exportName: string) {
  return route[`has${capitalize(exportName)}` as keyof RouteExports<T>]
}

/**
 * @description 从导出中转换 React Element
 */
function reactElementInExports(
  route: Route | LegacyRoute,
  {
    importee,
    namedExport,
    field = namedExport,
  }: {
    // 路由字段名称
    field?: string
    // 导入文件名称
    importee: string
    // named export 名称
    namedExport: string
  },
) {
  return isInExports(route, field || namedExport) ? `React.createElement(${importee}.${namedExport})` : ''
}

/**
 * @description 从导出中转换常量
 */
function constantInExports(
  route: Route | LegacyRoute,
  {
    importee,
    namedExport,
    field = namedExport,
  }: {
    // 路由字段名称
    field?: string
    // 导入文件名称
    importee: string
    // named export 名称
    namedExport: string
  },
) {
  return isInExports(route, field || namedExport) ? `${importee}.${namedExport}` : ''
}

/**
 * @description 设置 Data API 到 props
 */
function setDataApiToProps<R extends Record<string, any>>(
  props: Map<keyof R, string>,
  {
    route,
    importee,
    meta,
  }: {
    route: Route | LegacyRoute
    importee: string
    meta: boolean
  },
) {
  const setProps = (name: keyof RouteObject, value: string | boolean) => {
    _setProps(props, name, value)
  }

  // React Element Exports

  setProps(
    'element',
    reactElementInExports(route, {
      importee,
      namedExport: 'Component',
      field: meta ? 'metaComponent' : '',
    }),
  )

  setProps(
    'errorElement',
    reactElementInExports(route, {
      importee,
      namedExport: 'ErrorBoundary',
      field: meta ? 'metaErrorBoundary' : '',
    }),
  )

  // Constant/Function Exports
  setProps(
    'loader',
    constantInExports(route, {
      importee,
      namedExport: 'loader',
      field: meta ? 'metaLoader' : '',
    }),
  )
  setProps(
    'action',
    constantInExports(route, {
      importee,
      namedExport: 'action',
      field: meta ? 'metaAction' : '',
    }),
  )

  setProps(
    'handle',
    constantInExports(route, {
      importee,
      namedExport: 'handle',
      field: meta ? 'metaHandle' : '',
    }),
  )

  setProps(
    'shouldRevalidate',
    constantInExports(route, {
      importee,
      namedExport: 'shouldRevalidate',
      field: meta ? 'metaShouldRevalidate' : '',
    }),
  )

  setProps(
    'lazy',
    constantInExports(route, {
      importee,
      namedExport: 'lazy',
      field: meta ? 'metaLazy' : '',
    }),
  )
}

/**
 * 数据路由模式下的路由转换
 */
function dataApiRouteToString(route: Route, staticImport: string[], ctx: PluginContext): string {
  const importee = pascalSnakeCase(route.id)
  const props = new Map<keyof RouteObject, string>()
  const componentPath = path.resolve(ctx.remixOptions.appDirectory, route.file)

  const metaFile = route.metaFile ? path.resolve(ctx.remixOptions.appDirectory, route.metaFile) : null

  const setProps = (name: keyof RouteObject, value: string | boolean) => {
    _setProps(props, name, value)
  }
  setProps('path', route.index && !route.path ? `'/'` : `'${route.path}'`)
  setProps('id', `'${route.id}'`)
  setProps('index', `${route.index}`)

  // 只要是默认导出，就视为懒加载组件
  if (route.hasDefaultExport) {
    setProps(
      'lazy',
      /*js*/ `async () => {
          const { default: Component, ...rest } = await import('${componentPath}');
          return {
            Component,
            ...rest
          }
        }`,
    )
  }

  if (metaFile) {
    // 如果存在 metaFile，认为是 meta 约定
    // metaFile 中导出的所有属性认为是 Data API
    // @see https://reactrouter.com/en/main/route/route

    const metaImportee = `${importee}_Meta`
    staticImport.push(`import * as ${metaImportee} from '${metaFile}';`)
    setDataApiToProps(props, { route, importee: metaImportee, meta: true })

    if (route.hasComponent) {
      // 命名导出
      // 非懒加载组件
      staticImport.push(`import * as ${importee} from '${componentPath}';`)
      setDataApiToProps(props, { route, importee, meta: false })
    }
  } else {
    // 遵循 react-router-dom 的约定
    // 可自行导出 react-router-dom 支持的属性
    // @see https://reactrouter.com/en/main/route/route

    // eslint-disable-next-line no-lonely-if
    if (!route.hasDefaultExport) {
      // 非懒加载，把所有导出都认为是 Data API
      staticImport.push(`import * as ${importee} from '${componentPath}';`)
      setDataApiToProps(props, { route, importee, meta: false })
    }
  }

  if (route.children.length) {
    const children = routesToString(route.children, staticImport, ctx)
    setProps('children', children)
  }

  return `{${[...props.entries()].map(([k, v]) => `${k}:${v}`).join(',')}}`
}

/**
 * 传统路由模式下的路由转换
 */
function legacyRouteToString(route: LegacyRoute, staticImport: string[], ctx: PluginContext): string {
  const componentPath = path.resolve(ctx.remixOptions.appDirectory, route.file)
  const componentName = pascalSnakeCase(route.id)
  const metaPath = route.meta ? path.resolve(ctx.remixOptions.appDirectory, route.meta) : null

  const isLazyComponent = route.hasDefaultExport

  const props = new Map<keyof LegacyRouteObject, string>()

  const setProps = (name: keyof LegacyRouteObject, value: string | boolean) => {
    _setProps(props, name, value)
  }

  if (metaPath) {
    staticImport.push(`import * as ${componentName}_Meta from '${metaPath}';`)
    setProps('meta', `${componentName}_Meta`)
  }

  if (isLazyComponent) {
    setProps('lazyComponent', `() => import('${componentPath}')`)
  } else if (route.hasComponent) {
    staticImport.push(`import * as ${componentName} from '${componentPath}';`)
    setProps(
      'element',
      reactElementInExports(route, {
        importee: componentName,
        namedExport: 'Component',
      }),
    )
  }

  setProps('path', route.index && !route.path ? `'/'` : `'${route.path}'`)
  setProps('id', `'${route.id}'`)
  setProps('index', `${route.index}`)

  if (route.children?.length) {
    const children = routesToString(route.children, staticImport, ctx)
    setProps('children', children)
  }

  return `{${[...props.entries()].map(([k, v]) => `${k}:${v}`).join(',')}}`
}

function resolveMetaFilePath(routeFile: string, ctx: PluginContext) {
  const routeFileDir = path.dirname(routeFile)
  let metaFile = findEntry(path.join(ctx.remixOptions.appDirectory, routeFileDir), ctx.meta)
  if (metaFile) {
    metaFile = path.join(routeFileDir, metaFile)
  }
  return metaFile
}

export async function processRouteManifest(viteChildCompiler: Vite.ViteDevServer, ctx: PluginContext) {
  const routeManifestExports = await getRouteManifestModuleExports(viteChildCompiler, ctx)

  let routeManifest
  if (ctx.isLegacyMode) {
    routeManifest = ctx.routeManifest as LegacyRouteManifest
    for (const [key, route] of Object.entries(routeManifest)) {
      const sourceExports = routeManifestExports[key]

      routeManifest[key] = {
        ...route,
        file: route.file,
        id: route.id,
        path: route.path,
        index: route.index,
        caseSensitive: route.caseSensitive,

        // lazy Component
        hasDefaultExport: sourceExports.includes('default'),
        // Non-Lazy Component
        hasComponent: sourceExports.includes('Component'),

        meta: resolveMetaFilePath(route.file, ctx),
      }
    }
  } else {
    routeManifest = ctx.routeManifest as RouteManifest

    for (const [key, route] of Object.entries(routeManifest)) {
      const metaFile = resolveMetaFilePath(route.file, ctx)

      let metaSourceExports: string[] = []

      if (metaFile) {
        metaSourceExports = await getRouteModuleExports(viteChildCompiler, ctx, metaFile)
      }

      const sourceExports = routeManifestExports[key]

      routeManifest[key] = {
        ...route,
        file: route.file,
        id: route.id,
        parentId: route.parentId,
        path: route.path,
        index: route.index,
        caseSensitive: route.caseSensitive,
        /**
         * @see https://reactrouter.com/en/main/route/route
         */
        hasAction: sourceExports.includes('action'),
        hasLoader: sourceExports.includes('loader'),
        hasHandle: sourceExports.includes('handle'),
        hasShouldRevalidate: sourceExports.includes('shouldRevalidate'),
        hasErrorBoundary: sourceExports.includes('ErrorBoundary'),
        /**
         * @ses https://reactrouter.com/en/main/route/lazy
         * Lazy Component
         */
        hasLazy: sourceExports.includes('lazy'),
        hasComponent: sourceExports.includes('Component'),

        hasDefaultExport: sourceExports.includes('default'),

        // meta相关
        metaFile,
        hasMetaAction: metaSourceExports.includes('action'),
        hasMetaLoader: metaSourceExports.includes('loader'),
        hasMetaHandle: metaSourceExports.includes('handle'),
        hasMetaShouldRevalidate: metaSourceExports.includes('shouldRevalidate'),
        hasMetaErrorBoundary: metaSourceExports.includes('ErrorBoundary'),
      }
    }
  }

  return routeManifest
}

export function validateRouteDir(dir: string): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`[vite-plugin-remix-flat-routes] routes directory not found: ${dir}`)
  }
}

function capitalize(str: string) {
  if (!str) return str
  return str.charAt(0).toUpperCase() + str.slice(1)
}
