const { inlineScriptHashes, securityHeaders, validateSecurityHeaders } = require('../../../scripts/productionSecurityPolicy.cjs');

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
});
