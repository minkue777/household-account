import fs from 'node:fs';
import path from 'node:path';

describe('Pretendard font delivery contract', () => {
  it('외부 CDN을 기다리지 않고 자체 호스팅 dynamic subset을 사용한다', () => {
    const layout = fs.readFileSync(
      path.join(process.cwd(), 'src/app/layout.tsx'),
      'utf8'
    );
    const globalStyles = fs.readFileSync(
      path.join(process.cwd(), 'src/app/globals.css'),
      'utf8'
    );

    expect(layout).toContain(
      "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css"
    );
    expect(globalStyles).toContain("font-family: 'Pretendard Variable'");
    expect(`${layout}\n${globalStyles}`).not.toContain('cdn.jsdelivr.net');
  });
});
