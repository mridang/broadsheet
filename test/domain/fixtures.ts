import type { User } from '@/domain/db/users';
import type { Article } from '@/domain/repository';

/** A signed-in person, with what a test names changed. */
export const fixtureUser = (changes: Partial<User> = {}): User => ({
  id: 1,
  google_sub: 'sub-1',
  email: 'reader@example.test',
  name: null,
  picture: null,
  session_epoch: 0,
  created_at: null,
  ...changes,
});

/** A stored story, with what a test names changed. */
export const fixtureArticle = (changes: Partial<Article> = {}): Article => ({
  id: 1,
  source_id: 1,
  url: 'https://story.example.test/1',
  title: null,
  source: null,
  image: null,
  favicon: null,
  summary: null,
  published_at: null,
  points: 0,
  body_text: null,
  comments_url: null,
  guid: null,
  original_summary: null,
  author: null,
  tags: '[]',
  edition: null,
  cluster_id: null,
  fetched_at: null,
  ...changes,
});

/**
 * A Workers environment holding only the bindings a test names: the type
 * lists every binding, and a test supplies the one or two the code under test
 * reads.
 */
export const fixtureEnv = (
  bindings: Readonly<Record<string, unknown>>,
): CloudflareEnv =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a test double of the Workers environment, which declares dozens of bindings (databases, queues, workflows) that a unit test cannot and need not build
  bindings as unknown as CloudflareEnv;

/**
 * A Workers AI binding whose `run` is the test's own function: the real
 * `run` is overloaded once per model with exact input and output types, which
 * no single test function can satisfy.
 */
export const fixtureAi = (
  run: (
    model: string,
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>,
): Pick<Ai, 'run'> =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the overloaded `Ai.run` cannot be implemented by one function, so the double is asserted once here instead of at every test that fakes a model
  ({ run }) as unknown as Pick<Ai, 'run'>;

/** An execution context that runs no background work and rescues nothing. */
export const fixtureContext = (): ExecutionContext =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the context declares members (`exports`, `tracing`, `abort`) that only the Workers runtime fills in, and the code under test calls just `waitUntil`
  ({
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
  }) as unknown as ExecutionContext;
