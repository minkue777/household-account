const { inlineScriptHashes, securityHeaders, validateSecurityHeaders, replaceSecurityHeaderRoutes } = require('../../../scripts/productionSecurityPolicy.cjs');

describe('실제 production header 생성기', () => {
  it('실제 inline bytes만 hash하며 외부 script는 hash 목록에 넣지 않는다', () => {
    const html = '<script>self.__next_f.push([1,"한글"])</script><script src="/app.js"></script>';
    const hashes = inlineScriptHashes(html);
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toMatch(/^'sha256-[a-zA-Z0-9+/]+=*'$/);
    expect(inlineScriptHashes(html.replace('한글', 'changed'))).not.toEqual(hashes);
    expect(() => validateSecurityHeaders(securityHeaders(hashes))).not.toThrow();
  });
  it.each(["script-src 'unsafe-inline'", 'connect-src *', "frame-ancestors *"])("과도한 정책 %s로 artifact 생성을 거부한다", directive => {
    const headers = securityHeaders();
    headers[0].value = headers[0].value.replace(new RegExp(directive.split(' ')[0] + '[^;]*'), directive);
    expect(() => validateSecurityHeaders(headers)).toThrow();
  });
  it('무효 HSTS를 거부한다', () => {
    const headers = securityHeaders();
    headers.find((header: any) => header.key === 'Strict-Transport-Security').value = 'max-age=0';
    expect(() => validateSecurityHeaders(headers)).toThrow('INVALID_HSTS');
  });
  it.each(['false', 'true'])('Emulator 설정 %s에서도 실제 종목 카탈로그 Storage origin을 제한적으로 허용한다', emulatorSuite => {
    const previousSuite = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_SUITE;
    const previousProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    try {
      process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_SUITE = emulatorSuite;
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-household-account-e2e';
      const csp = securityHeaders().find((header: { key: string }) => header.key === 'Content-Security-Policy').value;
      const connectSources = csp.split(';').map((directive: string) => directive.trim().split(/\s+/))
        .find((directive: string[]) => directive[0] === 'connect-src').slice(1);
      expect(connectSources).toContain('https://firebasestorage.googleapis.com');
      expect(connectSources).not.toEqual(expect.arrayContaining(['https:', 'http:', '*']));
      expect(connectSources.some((source: string) => source.includes('*'))).toBe(false);
      expect(() => validateSecurityHeaders(securityHeaders())).not.toThrow();
    } finally {
      if (previousSuite === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_SUITE;
      else process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_SUITE = previousSuite;
      if (previousProject === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      else process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = previousProject;
    }
  });

  it('기존 보안 헤더를 교체할 때 비게 된 라우트를 제거한다', () => {
    const headers = securityHeaders(["'sha256-current'"]);
    const routes = [{ source: '/:path*', regex: '.*', headers: securityHeaders() }];

    const updated = replaceSecurityHeaderRoutes(routes, headers);

    expect(updated).toEqual([{
      source: '/:path*', regex: '^(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))?/?$', headers,
    }]);
    expect(replaceSecurityHeaderRoutes(updated, headers)).toEqual(updated);
    expect(replaceSecurityHeaderRoutes(undefined, headers)).toEqual(updated);
  });

  it('대소문자와 무관하게 보안 헤더만 교체하고 나머지 헤더와 경로 조건은 보존한다', () => {
    const headers = securityHeaders();
    const customHeader = { key: 'Cache-Control', value: 'no-cache' };
    const routes = [{
      source: '/sw.js', regex: '^/sw\\.js$', has: [{ type: 'host', value: 'example.com' }],
      headers: [{ key: 'content-security-policy', value: 'old policy' }, customHeader],
    }, {
      source: '/empty', regex: '^/empty$', headers: [],
    }];
    const original = JSON.parse(JSON.stringify(routes));

    const updated = replaceSecurityHeaderRoutes(routes, headers);

    expect(updated).toHaveLength(2);
    expect(updated[0]).toEqual({ ...routes[0], headers: [customHeader] });
    expect(updated[1].headers).toEqual(headers);
    expect(routes).toEqual(original);
  });
});
