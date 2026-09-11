import { join } from 'node:path';
import { Test } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyStatic from '@fastify/static';
import { DiscoveryController } from './discovery.controller';

describe('DiscoveryController', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DiscoveryController],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.register(fastifyStatic, {
      root: join(process.cwd(), 'public'),
    });
    await app.register(fastifyStatic, {
      root: join(process.cwd(), 'public'),
      prefix: '/public/',
      decorateReply: false,
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / returns the landing JSON (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json()).toMatchObject({
      name: 'SiteLenz',
      version: '2.0.0',
      endpoints: 10,
      payment: 'x402 on Algorand (USDC)',
      image: 'https://api.sitelenz.online/og-image.png',
      ogImage: 'https://api.sitelenz.online/og-image.png',
    });
  });

  it('GET / with Accept: text/html returns HTML containing Open Graph and Twitter Card tags (200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain(
      '<meta property="og:image" content="https://api.sitelenz.online/og-image.png">',
    );
    expect(res.body).toContain(
      '<meta property="og:image:secure_url" content="https://api.sitelenz.online/og-image.png">',
    );
    expect(res.body).toContain(
      '<meta property="og:title" content="SiteLenz - Website Intelligence API">',
    );
    expect(res.body).toContain(
      '<meta name="twitter:card" content="summary_large_image">',
    );
    expect(res.body).toContain(
      '<meta name="twitter:image" content="https://api.sitelenz.online/og-image.png">',
    );
    expect(res.body).toContain('/og-image.png');
    expect(res.body).toContain('<link rel="icon" type="image/png" href="/logo.png">');
    expect(res.body).toContain('https://sitelenz.online');
    expect(res.body).toContain('/docs');
  });

  it('GET / returns HTML with Open Graph tags for social crawlers (200)', async () => {
    const crawlers = [
      'Twitterbot/1.0',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
      'Discordbot/2.0',
    ];

    for (const crawler of crawlers) {
      const res = await app.inject({
        method: 'GET',
        url: '/',
        headers: { 'user-agent': crawler },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain(
        '<meta property="og:image" content="https://api.sitelenz.online/og-image.png">',
      );
    }
  });

  it('GET /?format=html returns HTML landing page (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/?format=html' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('https://api.sitelenz.online/og-image.png');
  });

  it('GET /llms.txt returns text/plain (200)', async () => {
    const res = await app.inject({ method: 'GET', url: '/llms.txt' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('# SiteLenz - Website Intelligence API');
    expect(res.body).toContain('POST /v1/analyze/full - $0.80');
  });

  it('GET /.well-known/ai-plugin.json returns JSON (200) with none auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/ai-plugin.json',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = res.json<{ auth: { type: string }; name_for_model: string }>();
    expect(body.name_for_model).toBe('sitelenz');
    expect(body.auth.type).toBe('none');
  });

  it('GET /.well-known/agent.json and agent-card.json are identical (200)', async () => {
    const a = await app.inject({
      method: 'GET',
      url: '/.well-known/agent.json',
    });
    const b = await app.inject({
      method: 'GET',
      url: '/.well-known/agent-card.json',
    });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json()).toEqual(b.json());
    expect(a.json()).toMatchObject({
      name: 'SiteLenz',
      image: 'https://api.sitelenz.online/og-image.png',
      icon: 'https://api.sitelenz.online/logo.png',
      payment: { protocol: 'x402', network: 'algorand', asset: 'USDC' },
    });
  });

  it('GET /.well-known/mcp.json lists all 10 tools (200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/.well-known/mcp.json',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ tools: { endpoint: string }[] }>();
    expect(body.tools).toHaveLength(10);
    expect(body.tools.map((t) => t.endpoint)).toContain('/v1/analyze/full');
  });

  it('GET /og-image.png serves the static OG image (200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/og-image.png',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.rawPayload.length).toBeGreaterThan(100_000);
  });

  it('GET /public/og-image.png serves the static OG image under /public/ prefix (200)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/public/og-image.png',
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.rawPayload.length).toBeGreaterThan(100_000);
  });
});
