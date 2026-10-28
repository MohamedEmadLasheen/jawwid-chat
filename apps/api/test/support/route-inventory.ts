/**
 * PD-40: every HTTP route of the API, read from the metadata Nest itself
 * routes by -- controller path, method path and verb -- with its PD-40
 * declaration (route-access.ts) or @Public(), on the handler or its class.
 * Shared by the route specs; imports the controllers, boots nothing.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PUBLIC_ROUTE } from '@platform/auth/auth.guard';
import { ROUTE_ACCESS, type RouteAccess } from '@platform/permissions/route-access';

const SRC = join(__dirname, '..', '..', 'src');

export interface Route {
  method: string;
  path: string;
  controller: string;
  handler: string;
  access: RouteAccess | undefined;
  isPublic: boolean;
}

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return controllerFiles(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

const join2 = (a: string, b: string) => '/' + [a, b].map((s) => s.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');

export function collectRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of controllerFiles(SRC)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      const ctor = exported as { prototype: Record<string, unknown>; name: string };
      const prefix = Reflect.getMetadata(PATH_METADATA, ctor) as string | string[] | undefined;
      if (prefix === undefined) continue;
      const classAccess = Reflect.getMetadata(ROUTE_ACCESS, ctor) as RouteAccess | undefined;
      const classPublic = Reflect.getMetadata(PUBLIC_ROUTE, ctor) === true;
      for (const name of Object.getOwnPropertyNames(ctor.prototype)) {
        if (name === 'constructor') continue;
        const fn = ctor.prototype[name];
        if (typeof fn !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, fn) as RequestMethod | undefined;
        if (verb === undefined) continue;
        const sub = Reflect.getMetadata(PATH_METADATA, fn) as string | string[];
        for (const p of Array.isArray(prefix) ? prefix : [prefix]) {
          for (const s of Array.isArray(sub) ? sub : [sub]) {
            routes.push({
              method: RequestMethod[verb],
              path: join2(p, s),
              controller: `${relative(SRC, file)}#${ctor.name}`,
              handler: name,
              access: (Reflect.getMetadata(ROUTE_ACCESS, fn) as RouteAccess | undefined) ?? classAccess,
              isPublic: Reflect.getMetadata(PUBLIC_ROUTE, fn) === true || classPublic,
            });
          }
        }
      }
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

