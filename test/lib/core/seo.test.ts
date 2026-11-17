import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

import { jsonLdText, landingJsonLd } from '@/lib/core/seo';
import {
  SITE_APPLICATION_CATEGORY,
  SITE_FEATURES,
  SITE_REQUIREMENTS,
} from '@/utils/site';

describe('landingJsonLd', () => {
  const graph = z
    .array(z.record(z.string(), z.unknown()))
    .parse(landingJsonLd()['@graph']);
  const byType = (type: string) => graph.find((n) => n['@type'] === type)!;

  it('describes the organisation, the site and the app', () => {
    expect(graph.map((n) => n['@type'])).toEqual([
      'Organization',
      'WebSite',
      'WebApplication',
    ]);
  });

  it('gives every node a stable id that the others point at', () => {
    const ids = graph.map((n) => n['@id']);
    expect(new Set(ids).size).toBe(3);
    expect(
      z
        .looseObject({ '@id': z.string() })
        .parse(byType('WebSite')['publisher'])['@id'],
    ).toBe(byType('Organization')['@id']);
  });

  it('says the app is free and works anywhere with a browser', () => {
    const app = byType('WebApplication');
    expect(app['isAccessibleForFree']).toBe(true);
    expect(
      z.looseObject({ price: z.string() }).parse(app['offers']).price,
    ).toBe('0');
    expect(app['operatingSystem']).toBe('Any');
  });

  it("takes what is particular to the app from the site's constants", () => {
    const app = byType('WebApplication');
    expect(app['applicationCategory']).toBe(SITE_APPLICATION_CATEGORY);
    expect(app['browserRequirements']).toBe(SITE_REQUIREMENTS);
    expect(app['featureList']).toEqual(SITE_FEATURES);
    expect(SITE_FEATURES.length).toBeGreaterThan(0);
  });
});

describe('jsonLdText', () => {
  it('can never close the script tag it is placed in', () => {
    const text = jsonLdText({ name: '</script><script>alert(1)</script>' });
    expect(text).not.toContain('<');
    expect(
      z.looseObject({ name: z.string() }).parse(JSON.parse(text)).name,
    ).toBe('</script><script>alert(1)</script>');
  });
});
