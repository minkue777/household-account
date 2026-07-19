import { parseMiraeFundNavHtml } from '@/lib/server/miraeFundNav';

const HTML_FIXTURE = `
  <table>
    <tbody>
      <tr>
        <td class="title">2026.07.19</td>
        <td>1,001.19</td>
        <td>1,001.11</td>
      </tr>
      <tr>
        <td class="title">2026.07.18</td>
        <td>1,001.19</td>
        <td>1,001.11</td>
      </tr>
      <tr>
        <td class="title">2026.07.17</td>
        <td>1,001.20</td>
        <td>1,001.12</td>
      </tr>
    </tbody>
  </table>
`;

describe('parseMiraeFundNavHtml', () => {
  it('기준일보다 미래인 행을 제외하고 가장 최근 기준가부터 반환한다', () => {
    expect(parseMiraeFundNavHtml(HTML_FIXTURE, '2026-07-18')).toEqual([
      { date: '2026-07-18', nav: 1001.19, taxableNav: 1001.11 },
      { date: '2026-07-17', nav: 1001.2, taxableNav: 1001.12 },
    ]);
  });

  it('유효한 기준가 행이 없으면 빈 배열을 반환한다', () => {
    expect(
      parseMiraeFundNavHtml(
        '<table><tr><td class="title">잘못된 날짜</td><td>-</td></tr></table>',
        '2026-07-19'
      )
    ).toEqual([]);
  });
});
