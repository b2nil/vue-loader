import webpack = require('webpack')
import * as qs from 'querystring'
import * as loaderUtils from 'loader-utils'
import { VueLoaderOptions } from './'
import { formatError } from './formatError'
import {
  compileTemplate,
  SFCDescriptor,
  SFCTemplateCompileOptions,
  TemplateCompiler,
} from '@vue/compiler-sfc'
import { getDescriptor } from './descriptorCache'
import { getResolvedScript } from './resolveScript'

export function getTemplateCompilerOptions(
  options: VueLoaderOptions,
  descriptor: SFCDescriptor,
  scopeId: string,
  loaderContext: webpack.loader.LoaderContext
):
  | Omit<SFCTemplateCompileOptions, 'source' | 'filename' | 'inMap'>
  | undefined {
  const block = descriptor.template
  if (!block) {
    return
  }

  const isProd = loaderContext.mode === 'production'
  const isServer = options.isServerBuild ?? loaderContext.target === 'node'
  const hasScoped = descriptor.styles.some((s) => s.scoped)
  const resolvedScript = getResolvedScript(descriptor, isServer)

  let compiler: TemplateCompiler | undefined
  if (typeof options.compiler === 'string') {
    compiler = require(options.compiler)
  } else {
    compiler = options.compiler
  }

  return {
    id: scopeId,
    scoped: hasScoped,
    slotted: descriptor.slotted,
    isProd,
    ssr: isServer,
    ssrCssVars: descriptor.cssVars,
    compiler,
    compilerOptions: {
      ...options.compilerOptions,
      scopeId: hasScoped ? `data-v-${scopeId}` : undefined,
      bindingMetadata: resolvedScript ? resolvedScript.bindings : undefined,
    },
    transformAssetUrls: options.transformAssetUrls || true,
  }
}

// Loader that compiles raw template into JavaScript functions.
// This is injected by the global pitcher (../pitch) for template
// selection requests initiated from vue files.
const TemplateLoader: webpack.loader.Loader = function (source, inMap) {
  source = String(source)
  const loaderContext = this

  // although this is not the main vue-loader, we can get access to the same
  // vue-loader options because we've set an ident in the plugin and used that
  // ident to create the request for this loader in the pitcher.
  const options = (loaderUtils.getOptions(loaderContext) ||
    {}) as VueLoaderOptions
  const query = qs.parse(loaderContext.resourceQuery.slice(1))
  const scopeId = query.id as string
  const descriptor = getDescriptor(loaderContext.resourcePath)

  const compiled = compileTemplate({
    ...getTemplateCompilerOptions(options, descriptor, scopeId, loaderContext),
    id: scopeId,
    filename: loaderContext.resourcePath,
    source,
    inMap,
  })

  // tips
  if (compiled.tips.length) {
    compiled.tips.forEach((tip) => {
      loaderContext.emitWarning(tip)
    })
  }

  // errors
  if (compiled.errors && compiled.errors.length) {
    compiled.errors.forEach((err) => {
      if (typeof err === 'string') {
        loaderContext.emitError(err)
      } else {
        formatError(
          err,
          inMap ? inMap.sourcesContent![0] : (source as string),
          loaderContext.resourcePath
        )
        loaderContext.emitError(err)
      }
    })
  }

  const { code, map } = compiled
  loaderContext.callback(null, code, map)
}

export default TemplateLoader
