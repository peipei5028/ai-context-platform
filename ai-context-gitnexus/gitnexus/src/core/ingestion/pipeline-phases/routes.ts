/**
 * Phase: routes
 *
 * Builds the route registry (Next.js, Expo, PHP, Laravel, decorator-based)
 * and creates Route graph nodes + HANDLES_ROUTE edges.
 * Also links middleware, processes fetch() calls, and scans HTML templates.
 *
 * @deps    parse
 * @reads   allPaths, allExtractedRoutes, allDecoratorRoutes, allFetchCalls
 * @writes  graph (Route nodes, HANDLES_ROUTE, FETCHES_FROM edges)
 * @output  routeRegistry, handlerContents
 */

import type { PipelinePhase, PipelineContext, PhaseResult } from './types.js';
import { getPhaseOutput } from './types.js';
import type { ParseOutput } from './parse.js';
import { nextjsFileToRouteURL, normalizeFetchURL } from '../route-extractors/nextjs.js';
import { expoFileToRouteURL } from '../route-extractors/expo.js';
import { phpFileToRouteURL } from '../route-extractors/php.js';
import {
  extractResponseShapes,
  extractPHPResponseShapes,
} from '../route-extractors/response-shapes.js';
import {
  extractMiddlewareChain,
  extractNextjsMiddlewareConfig,
  compileMatcher,
  compiledMatcherMatchesRoute,
} from '../route-extractors/middleware.js';
import { processNextjsFetchRoutes } from '../call-processor.js';
import { generateId } from '../../../lib/utils.js';
import { readFileContents } from '../filesystem-walker.js';
import { isDev } from '../utils/env.js';

const EXPO_NAV_PATTERNS = [
  /router\.(push|replace|navigate)\(\s*['"`]([^'"`]+)['"`]/g,
  /<Link\s+[^>]*href=\s*['"`]([^'"`]+)['"`]/g,
];

export interface RouteEntry {
  filePath: string;
  source: string;
}

export interface RoutesOutput {
  routeRegistry: Map<string, RouteEntry>;
}

export const routesPhase: PipelinePhase<RoutesOutput> = {
  name: 'routes',
  deps: ['parse'],

  async execute(
    ctx: PipelineContext,
    deps: ReadonlyMap<string, PhaseResult<unknown>>,
  ): Promise<RoutesOutput> {
    const {
      allPaths,
      allFetchCalls: parseFetchCalls,
      allExtractedRoutes,
      allDecoratorRoutes,
    } = getPhaseOutput<ParseOutput>(deps, 'parse');

    // Local copy — routes phase must not mutate upstream ParseOutput
    const allFetchCalls = [...parseFetchCalls];

    const routeRegistry = new Map<string, RouteEntry>();

    // Detect Expo Router app/ roots vs Next.js app/ roots (monorepo-safe)
    const expoAppRoots = new Set<string>();
    const nextjsAppRoots = new Set<string>();
    const expoAppPaths = new Set<string>();
    for (const p of allPaths) {
      const norm = p.replace(/\\/g, '/');
      const appIdx = norm.lastIndexOf('app/');
      if (appIdx < 0) continue;
      const root = norm.slice(0, appIdx + 4);
      if (/\/_layout\.(tsx?|jsx?)$/.test(norm)) expoAppRoots.add(root);
      if (/\/page\.(tsx?|jsx?)$/.test(norm)) nextjsAppRoots.add(root);
    }
    for (const root of nextjsAppRoots) expoAppRoots.delete(root);
    if (expoAppRoots.size > 0) {
      for (const p of allPaths) {
        const norm = p.replace(/\\/g, '/');
        const appIdx = norm.lastIndexOf('app/');
        if (appIdx >= 0 && expoAppRoots.has(norm.slice(0, appIdx + 4))) expoAppPaths.add(p);
      }
    }

    for (const p of allPaths) {
      if (expoAppPaths.has(p)) {
        const expoURL = expoFileToRouteURL(p);
        if (expoURL && !routeRegistry.has(expoURL)) {
          routeRegistry.set(expoURL, { filePath: p, source: 'expo-filesystem-route' });
          continue;
        }
      }
      const nextjsURL = nextjsFileToRouteURL(p);
      if (nextjsURL && !routeRegistry.has(nextjsURL)) {
        routeRegistry.set(nextjsURL, { filePath: p, source: 'nextjs-filesystem-route' });
        continue;
      }
      if (p.endsWith('.php')) {
        const phpURL = phpFileToRouteURL(p);
        if (phpURL && !routeRegistry.has(phpURL)) {
          routeRegistry.set(phpURL, { filePath: p, source: 'php-file-route' });
        }
      }
    }

    const ensureSlash = (path: string) => (path.startsWith('/') ? path : '/' + path);
    let duplicateRoutes = 0;
    const addRoute = (url: string, entry: RouteEntry) => {
      if (routeRegistry.has(url)) {
        duplicateRoutes++;
        return;
      }
      routeRegistry.set(url, entry);
    };
    for (const route of allExtractedRoutes) {
      if (!route.routePath) continue;
      addRoute(ensureSlash(route.routePath), {
        filePath: route.filePath,
        source: 'framework-route',
      });
    }
    for (const dr of allDecoratorRoutes) {
      addRoute(ensureSlash(dr.routePath), {
        filePath: dr.filePath,
        source: `decorator-${dr.decoratorName}`,
      });
    }

    // ── Java Spring: merge class-level @RequestMapping prefix with method-level routes ──
    // When a file has @RequestMapping("/api") at class level and @GetMapping("/users") at
    // method level, produce a combined route "/api/users" and keep the method-level source.
    {
      const CLASS_LEVEL_ANNOTATIONS = new Set(['RequestMapping']);
      const METHOD_LEVEL_ANNOTATIONS = new Set([
        'GetMapping',
        'PostMapping',
        'PutMapping',
        'DeleteMapping',
        'PatchMapping',
        'RequestMapping',
      ]);

      // Group decorator routes by file
      const routesByFile = new Map<string, typeof allDecoratorRoutes[number][]>();
      for (const dr of allDecoratorRoutes) {
        let list = routesByFile.get(dr.filePath);
        if (!list) {
          list = [];
          routesByFile.set(dr.filePath, list);
        }
        list.push(dr);
      }

      for (const [filePath, fileRoutes] of routesByFile) {
        // Find class-level prefix(es)
        const classPrefixes = fileRoutes.filter(
          (r) =>
            CLASS_LEVEL_ANNOTATIONS.has(r.decoratorName) &&
            r.routePath &&
            r.routePath !== '/',
        );
        if (classPrefixes.length === 0) continue;

        // Use the first class-level prefix as the base
        const classPrefix = ensureSlash(classPrefixes[0].routePath.replace(/\/+$/, ''));

        // Find method-level routes in this file that should be prefixed
        for (const mr of fileRoutes) {
          if (!METHOD_LEVEL_ANNOTATIONS.has(mr.decoratorName)) continue;
          if (mr === classPrefixes[0] && classPrefixes.length === 1) continue;

          const methodPath = ensureSlash(mr.routePath);
          // Skip if already starts with the class prefix (avoid double-prefixing)
          if (methodPath.startsWith(classPrefix + '/') || methodPath === classPrefix) continue;

          const combined = classPrefix + (methodPath === '/' ? '' : methodPath);
          // Remove the un-prefixed version and add the combined one
          if (routeRegistry.has(methodPath)) {
            routeRegistry.delete(methodPath);
          }
          addRoute(combined, {
            filePath,
            source: `decorator-${mr.decoratorName}`,
          });
        }

        // Remove the class-level route itself if it has no method children
        // (it's a prefix, not an actual endpoint unless it has method-level routes)
        const classRoutePath = ensureSlash(classPrefixes[0].routePath);
        if (
          routeRegistry.has(classRoutePath) &&
          !fileRoutes.some(
            (r) =>
              r !== classPrefixes[0] &&
              METHOD_LEVEL_ANNOTATIONS.has(r.decoratorName),
          )
        ) {
          // Keep it — @RequestMapping without method-level sub-routes IS an endpoint
        }
      }
    }

    let handlerContents: Map<string, string> | undefined;
    if (routeRegistry.size > 0) {
      const handlerPaths = [...routeRegistry.values()].map((e) => e.filePath);
      handlerContents = await readFileContents(ctx.repoPath, handlerPaths);

      for (const [routeURL, entry] of routeRegistry) {
        const { filePath: handlerPath, source: routeSource } = entry;
        const content = handlerContents.get(handlerPath);

        const { responseKeys, errorKeys } = content
          ? handlerPath.endsWith('.php')
            ? extractPHPResponseShapes(content)
            : extractResponseShapes(content)
          : { responseKeys: undefined, errorKeys: undefined };

        const mwResult = content ? extractMiddlewareChain(content) : undefined;
        const middleware = mwResult?.chain;

        const routeNodeId = generateId('Route', routeURL);
        ctx.graph.addNode({
          id: routeNodeId,
          label: 'Route',
          properties: {
            name: routeURL,
            filePath: handlerPath,
            ...(responseKeys ? { responseKeys } : {}),
            ...(errorKeys ? { errorKeys } : {}),
            ...(middleware && middleware.length > 0 ? { middleware } : {}),
          },
        });

        const handlerFileId = generateId('File', handlerPath);
        ctx.graph.addRelationship({
          id: generateId('HANDLES_ROUTE', `${handlerFileId}->${routeNodeId}`),
          sourceId: handlerFileId,
          targetId: routeNodeId,
          type: 'HANDLES_ROUTE',
          confidence: 1.0,
          reason: routeSource,
        });
      }

      if (isDev) {
        console.log(
          `🗺️ Route registry: ${routeRegistry.size} routes${duplicateRoutes > 0 ? ` (${duplicateRoutes} duplicate URLs skipped)` : ''}`,
        );
      }
    }

    // ── Link Next.js project-level middleware.ts to routes ──
    if (routeRegistry.size > 0) {
      const middlewareCandidates = allPaths.filter(
        (p) =>
          p === 'middleware.ts' ||
          p === 'middleware.js' ||
          p === 'middleware.tsx' ||
          p === 'middleware.jsx' ||
          p === 'src/middleware.ts' ||
          p === 'src/middleware.js' ||
          p === 'src/middleware.tsx' ||
          p === 'src/middleware.jsx',
      );
      if (middlewareCandidates.length > 0) {
        const mwContents = await readFileContents(ctx.repoPath, middlewareCandidates);
        for (const [mwPath, mwContent] of mwContents) {
          const config = extractNextjsMiddlewareConfig(mwContent);
          if (!config) continue;
          const mwLabel =
            config.wrappedFunctions.length > 0 ? config.wrappedFunctions : [config.exportedName];

          const compiled = config.matchers
            .map(compileMatcher)
            .filter((m): m is NonNullable<typeof m> => m !== null);

          let linkedCount = 0;
          for (const [routeURL] of routeRegistry) {
            const matches =
              compiled.length === 0 ||
              compiled.some((cm) => compiledMatcherMatchesRoute(cm, routeURL));
            if (!matches) continue;

            const routeNodeId = generateId('Route', routeURL);
            const existing = ctx.graph.getNode(routeNodeId);
            if (!existing) continue;

            const currentMw = existing.properties.middleware ?? [];
            existing.properties.middleware = [
              ...mwLabel,
              ...currentMw.filter((m) => !mwLabel.includes(m)),
            ];
            linkedCount++;
          }
          if (isDev && linkedCount > 0) {
            console.log(
              `🛡️ Linked ${mwPath} middleware [${mwLabel.join(', ')}] to ${linkedCount} routes`,
            );
          }
        }
      }
    }

    // Scan HTML/template files for form action and AJAX url patterns
    const htmlCandidates = allPaths.filter(
      (p) =>
        p.endsWith('.html') ||
        p.endsWith('.htm') ||
        p.endsWith('.ejs') ||
        p.endsWith('.hbs') ||
        p.endsWith('.blade.php'),
    );
    if (htmlCandidates.length > 0 && routeRegistry.size > 0) {
      const htmlContents = await readFileContents(ctx.repoPath, htmlCandidates);
      const htmlPatterns = [/action=["']([^"']+)["']/g, /url:\s*["']([^"']+)["']/g];
      for (const [filePath, content] of htmlContents) {
        for (const pattern of htmlPatterns) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const normalized = normalizeFetchURL(match[1]);
            if (normalized) {
              allFetchCalls.push({ filePath, fetchURL: normalized, lineNumber: 0 });
            }
          }
        }
      }
    }

    // ── Extract Expo Router navigation patterns ──
    if (expoAppPaths.size > 0 && routeRegistry.size > 0) {
      const unreadExpoPaths = [...expoAppPaths].filter((p) => !handlerContents?.has(p));
      const extraContents =
        unreadExpoPaths.length > 0
          ? await readFileContents(ctx.repoPath, unreadExpoPaths)
          : new Map<string, string>();
      const allExpoContents = new Map([...(handlerContents ?? new Map()), ...extraContents]);
      for (const [filePath, content] of allExpoContents) {
        if (!expoAppPaths.has(filePath)) continue;
        for (const pattern of EXPO_NAV_PATTERNS) {
          pattern.lastIndex = 0;
          let match;
          while ((match = pattern.exec(content)) !== null) {
            const url = match[2] ?? match[1];
            if (url && url.startsWith('/')) {
              allFetchCalls.push({ filePath, fetchURL: url, lineNumber: 0 });
            }
          }
        }
      }
    }

    if (routeRegistry.size > 0 && allFetchCalls.length > 0) {
      const routeURLToFile = new Map<string, string>();
      for (const [url, entry] of routeRegistry) routeURLToFile.set(url, entry.filePath);

      const consumerPaths = [...new Set(allFetchCalls.map((c) => c.filePath))];
      const consumerContents = await readFileContents(ctx.repoPath, consumerPaths);

      processNextjsFetchRoutes(ctx.graph, allFetchCalls, routeURLToFile, consumerContents);
      if (isDev) {
        console.log(
          `🔗 Processed ${allFetchCalls.length} fetch() calls against ${routeRegistry.size} routes`,
        );
      }
    }

    return { routeRegistry };
  },
};
