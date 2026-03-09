/**
 * localStorage 기반 멤버 저장소
 * 현재 기기를 사용하는 멤버 정보를 저장
 * DeviceOwnerStorage를 대체
 */

const KEY_MEMBER_ID = 'currentMemberId';
const KEY_MEMBER_NAME = 'currentMemberName';
const KEY_PARTNER_NAME = 'partnerName';

export const MemberStorage = {
  getMemberId(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(KEY_MEMBER_ID);
  },

  getMemberName(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(KEY_MEMBER_NAME);
  },

  getPartnerName(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(KEY_PARTNER_NAME);
  },

  set(memberId: string, memberName: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(KEY_MEMBER_ID, memberId);
    localStorage.setItem(KEY_MEMBER_NAME, memberName);
  },

  setPartnerName(name: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(KEY_PARTNER_NAME, name);
  },

  remove(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(KEY_MEMBER_ID);
    localStorage.removeItem(KEY_MEMBER_NAME);
    localStorage.removeItem(KEY_PARTNER_NAME);
  },
};
