import { getPackageRequestName } from './resolve.js';

export interface TrackedDependencyResolveData {
  context?: string;
  contextInfo?: {
    issuer?: string;
  };
  request?: string;
}

interface TrackedDependencyResolver<T> {
  data: T;
  resume: () => void;
}

interface DependencyResolverQueue<T> {
  active: TrackedDependencyResolver<T>;
  pending: Array<TrackedDependencyResolver<T>>;
}

/**
 * Correlates dependency-specific resolvers with factorization requests.
 *
 * @remarks
 * Rspack can factorize identical requests concurrently, so callback order is
 * not a stable correlation key. Identical context, issuer, and request tuples
 * are serialized until the matching factorize tap consumes their resolver.
 *
 * @internal
 */
export class DependencyResolverTracker<
  T extends TrackedDependencyResolveData = TrackedDependencyResolveData,
> {
  private readonly queues = new Map<string, DependencyResolverQueue<T>>();

  add(data: T, resume: () => void): void {
    const { context, request } = data;
    if (!context || !request || !getPackageRequestName(request)) {
      resume();
      return;
    }

    const key = this.getKey(context, request, data.contextInfo?.issuer);
    const queue = this.queues.get(key);
    const trackedResolver = { data, resume };
    if (queue) {
      queue.pending.push(trackedResolver);
      return;
    }

    this.queues.set(key, {
      active: trackedResolver,
      pending: [],
    });
    resume();
  }

  get(context: string, request: string, issuer?: string): T | undefined {
    const key = this.getKey(context, request, issuer);
    return this.queues.get(key)?.active.data;
  }

  release(context: string, request: string, issuer?: string): void {
    const key = this.getKey(context, request, issuer);
    const queue = this.queues.get(key);
    if (!queue) {
      return;
    }

    const next = queue.pending.shift();
    if (!next) {
      this.queues.delete(key);
      return;
    }

    queue.active = next;
    next.resume();
  }

  clear(): void {
    for (const queue of this.queues.values()) {
      for (const resolver of queue.pending) {
        resolver.resume();
      }
    }
    this.queues.clear();
  }

  private getKey(context: string, request: string, issuer = ''): string {
    return `${context}\0${issuer}\0${request}`;
  }
}
