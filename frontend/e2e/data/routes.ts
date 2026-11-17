// Route keys and response types for the stubbed API, from the same generated types the app
// uses (src/api/generated, written from backend/openapi/*.json). A stub's key is
// "METHOD /path" with the spec's own placeholders ("GET /children/{id}/kids"), and its body
// must be that route's success response, so a schema change in a service fails the e2e
// typecheck instead of a test at run time.

import type { paths as AuthPaths } from '../../src/api/generated/auth';
import type { paths as ChildrenPaths } from '../../src/api/generated/children';
import type { paths as DiscoverPaths } from '../../src/api/generated/discover';
import type { paths as GrowPaths } from '../../src/api/generated/grow';
import type { paths as OnboardingPaths } from '../../src/api/generated/onboarding';
import type { paths as ReleasePaths } from '../../src/api/generated/release';
import type { paths as SharedPaths } from '../../src/api/generated/shared';
import type { paths as TransformPaths } from '../../src/api/generated/transform';
import type { paths as UsersPaths } from '../../src/api/generated/users';

export type { components as AuthSchemas } from '../../src/api/generated/auth';
export type { components as ChildrenSchemas } from '../../src/api/generated/children';
export type { components as DiscoverSchemas } from '../../src/api/generated/discover';
export type { components as GrowSchemas } from '../../src/api/generated/grow';
export type { components as OnboardingSchemas } from '../../src/api/generated/onboarding';
export type { components as ReleaseSchemas } from '../../src/api/generated/release';
export type { components as SharedSchemas } from '../../src/api/generated/shared';
export type { components as TransformSchemas } from '../../src/api/generated/transform';
export type { components as UsersSchemas } from '../../src/api/generated/users';

type AllPaths = AuthPaths &
  ChildrenPaths &
  DiscoverPaths &
  GrowPaths &
  OnboardingPaths &
  ReleasePaths &
  SharedPaths &
  TransformPaths &
  UsersPaths;

type Method = 'get' | 'put' | 'post' | 'patch' | 'delete';
type ApiPath = Extract<keyof AllPaths, `/api/v1/${string}`>;
type Strip<P> = P extends `/api/v1${infer Rest}` ? Rest : never;

/** Every route the services define, e.g. "GET /children/{id}/kids". */
export type RouteKey = {
  [P in ApiPath]: {
    [M in Method]: AllPaths[P][M] extends { responses: unknown }
      ? `${Uppercase<M>} ${Strip<P>}`
      : never;
  }[Method];
}[ApiPath];

type Operation<K> = K extends `${infer M} ${infer Rest}`
  ? `/api/v1${Rest}` extends ApiPath
    ? Lowercase<M> extends Method
      ? AllPaths[`/api/v1${Rest}`][Lowercase<M>]
      : never
    : never
  : never;

type Json<R> = R extends { content: { 'application/json': infer B } } ? B : null;
type Success<Rs> = Rs extends { 200: infer R }
  ? Json<R>
  : Rs extends { 201: infer R }
    ? Json<R>
    : Rs extends { 202: infer R }
      ? Json<R>
      : null;

/** The success body of a route ("GET /auth/me" → MeResponse; a 204 → null). */
export type BodyOf<K extends RouteKey> =
  Operation<K> extends { responses: infer Rs } ? Success<Rs> : never;

/** The JSON request body a route takes, for asserting what the app sent. */
export type RequestOf<K extends RouteKey> =
  Operation<K> extends {
    requestBody?: { content: { 'application/json': infer B } };
  }
    ? B
    : undefined;
